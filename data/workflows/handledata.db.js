// data/workflows/handledata.db.js
import mongoose from 'mongoose';
import connectMongo from '@/config/connectDB';
import { cacheData } from '@/lib/cache';
import {
    WorkflowDefinition,
    WorkflowInstance,
} from '@/models/workflow.model';

import {
    presentNodeLabel,
    presentEdgeLabel,
    toVNInstanceStatus,
    toVNStepStatus,
    formatDate,
} from '@/lib/i18n/workflow.vi';

function toObjectId(id) {
    try { return new mongoose.Types.ObjectId(id); } catch { return null; }
}

/* ==========================
 * WORKFLOW DEFINITIONS
 * ========================== */

async function _defAggregateOneOrMany(defId) {
    await connectMongo();

    const matchStage = defId ? [{ $match: { _id: toObjectId(defId) } }] : [];

    const pipeline = [
        ...matchStage,
        // Tổng hợp số lượng node/edge
        {
            $addFields: {
                nodeCount: { $size: { $ifNull: ['$nodes', []] } },
                edgeCount: { $size: { $ifNull: ['$edges', []] } },
            }
        },
        // Thống kê instance theo trạng thái
        {
            $lookup: {
                from: 'workflow_instances',
                let: { did: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$definitionId', '$$did'] } } },
                    {
                        $group: {
                            _id: '$status',
                            c: { $sum: 1 },
                            latestStartedAt: { $max: '$startedAt' },
                            latestFinishedAt: { $max: '$finishedAt' },
                        }
                    }
                ],
                as: 'instStats'
            }
        },
        {
            $addFields: {
                statsByStatus: {
                    $map: {
                        input: '$instStats',
                        as: 's',
                        in: { status: '$$s._id', count: '$$s.c', latestStartedAt: '$$s.latestStartedAt', latestFinishedAt: '$$s.latestFinishedAt' }
                    }
                }
            }
        },
        { $project: { instStats: 0 } },
        { $sort: { updatedAt: -1, createdAt: -1 } },
    ];

    const docs = await WorkflowDefinition.aggregate(pipeline);
    return defId ? (docs?.[0] || null) : docs;
}

function _decorateDefForUI(def) {
    if (!def) return null;
    const nodes = (def.nodes || []).map(n => ({
        ...n,
        uiLabel: presentNodeLabel(n),
    }));
    const edges = (def.edges || []).map(e => ({
        ...e,
        uiLabel: presentEdgeLabel(e),
    }));
    const stats = {};
    for (const s of (def.statsByStatus || [])) {
        stats[toVNInstanceStatus(s.status)] = {
            count: s.count,
            latestStartedAt: formatDate(s.latestStartedAt),
            latestFinishedAt: formatDate(s.latestFinishedAt),
        };
    }
    return { ...def, nodes, edges, statsVN: stats };
}

async function dataWorkflowDefs(defId) {
    const raw = await _defAggregateOneOrMany(defId);
    if (Array.isArray(raw)) return raw.map(_decorateDefForUI);
    return _decorateDefForUI(raw);
}

/** PUBLIC (cached) */
export function getWorkflowDefsAll() {
    const cached = cacheData(() => dataWorkflowDefs(), ['wf:defs']);
    return cached();
}

export function getWorkflowDefOne(defId) {
    const tag = `wf:def:${String(defId)}`;
    const cached = cacheData(() => dataWorkflowDefs(defId), ['wf:defs', tag]);
    return cached();
}

/* ==========================
 * INSTANCES
 * ========================== */

async function _instAggregateOneOrMany({ instanceId, definitionId, status } = {}) {
    await connectMongo();

    const match = {};
    if (instanceId) match._id = toObjectId(instanceId);
    if (definitionId) match.definitionId = toObjectId(definitionId);
    if (status) match.status = status;

    const pipeline = [
        { $match: match },
        // Join definition để lấy tên/phiên bản
        {
            $lookup: {
                from: 'workflow_definitions',
                localField: 'definitionId',
                foreignField: '_id',
                as: 'def'
            }
        },
        { $addFields: { def: { $arrayElemAt: ['$def', 0] } } },
        // Tạo field tiện lợi
        {
            $addFields: {
                definitionName: '$def.name',
                definitionVersion: '$def.version',
                // dựng danh sách active node label (nếu có)
                activeNodesInfo: {
                    $map: {
                        input: { $ifNull: ['$activeNodeIds', []] },
                        as: 'nid',
                        in: {
                            $let: {
                                vars: {
                                    node: {
                                        $first: {
                                            $filter: {
                                                input: { $ifNull: ['$def.nodes', []] },
                                                as: 'n',
                                                cond: { $eq: ['$$n._id', '$$nid'] }
                                            }
                                        }
                                    }
                                },
                                in: { _id: '$$node._id', label: '$$node.label', type: '$$node.type' }
                            }
                        }
                    }
                },
            }
        },
        { $project: { def: 0 } },
        { $sort: { updatedAt: -1, createdAt: -1 } },
    ];

    const docs = await WorkflowInstance.aggregate(pipeline);
    return instanceId ? (docs?.[0] || null) : docs;
}

function _decorateInstanceForUI(inst) {
    if (!inst) return null;
    // map VN status
    const statusVN = toVNInstanceStatus(inst.status);
    // decorate active nodes VN
    const activeNodes = (inst.activeNodesInfo || []).map(n => ({
        ...n,
        uiLabel: n?.label ? `${n.label} (${n.type})` : n?.type || '',
    }));
    // decorate history (nếu available vì history là mảng raw trong doc Instance)
    const historyVN = (inst.history || []).map(h => ({
        nodeId: h.nodeId,
        nodeType: h.nodeType,
        status: h.status,
        statusVN: toVNStepStatus(h.status),
        attempt: h.attempt,
        repeatCount: h.repeatCount,
        startedAt: formatDate(h.startedAt),
        finishedAt: formatDate(h.finishedAt),
        error: h.error?.message || null,
    }));

    return {
        ...inst,
        statusVN,
        activeNodes,
        historyVN,
        startedAtVN: formatDate(inst.startedAt),
        finishedAtVN: formatDate(inst.finishedAt),
    };
}

async function dataWorkflowInstances({ instanceId, definitionId, status } = {}) {
    const raw = await _instAggregateOneOrMany({ instanceId, definitionId, status });
    if (Array.isArray(raw)) return raw.map(_decorateInstanceForUI);
    return _decorateInstanceForUI(raw);
}

/** PUBLIC (cached) */
export function getInstancesByDefinition(definitionId, status) {
    const tagDef = `wf:def:${String(definitionId)}`;
    const tagList = `wf:instances:def:${String(definitionId)}`;
    const tags = ['wf:defs', tagDef, tagList];
    if (status) tags.push(`wf:instances:def:${String(definitionId)}:${status}`);
    const cached = cacheData(
        () => dataWorkflowInstances({ definitionId, status }),
        tags
    );
    return cached();
}

export function getInstanceOne(instanceId) {
    const tag = `wf:instance:${String(instanceId)}`;
    const cached = cacheData(
        () => dataWorkflowInstances({ instanceId }),
        [tag]
    );
    return cached();
}
