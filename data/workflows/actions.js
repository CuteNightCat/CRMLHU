// data/workflows/actions.js
'use server';

import mongoose from 'mongoose';
import connectMongo from '@/config/connectDB';
import { revalidateTag } from 'next/cache';
import {
    WorkflowDefinition,
    WorkflowInstance,
} from '@/models/workflow.model';

// Helper
function toObjectId(id) {
    try { return new mongoose.Types.ObjectId(id); } catch { return null; }
}

/* ==========================
 * TAG helpers (dễ quản lý revalidate)
 * ========================== */
const TAG_DEFS = 'wf:defs';
const tagDef = (id) => `wf:def:${String(id)}`;
const tagInstOfDef = (defId) => `wf:instances:def:${String(defId)}`;
const tagInst = (id) => `wf:instance:${String(id)}`;

/* ==========================
 * DEFINITIONS
 * ========================== */

// Tạo workflow definition mới
export async function createWorkflowDefinition(formData) {
    await connectMongo();
    const name = formData.get('name');
    const description = formData.get('description') || '';
    const createdBy = toObjectId(formData.get('createdBy')); // account id
    const ownerId = createdBy;

    const payload = {
        name, description, createdBy, ownerId,
        nodes: [], edges: [],
        version: 1, isActive: true,
        defaultContext: {},
        allowCycles: true,
        tags: [],
        start: null, // sẽ set sau
    };

    const doc = await WorkflowDefinition.create(payload);
    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(doc._id));
    return String(doc._id);
}

// Cập nhật thông tin chung
export async function updateWorkflowDefinition(defId, patch) {
    await connectMongo();
    const _id = toObjectId(defId);
    const update = {};
    const allowed = ['name', 'description', 'isActive', 'allowCycles', 'tags', 'defaultContext'];
    for (const k of allowed) {
        if (k in patch) update[k] = patch[k];
    }
    await WorkflowDefinition.findByIdAndUpdate(_id, update, { new: true });
    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// Thiết lập start trigger
export async function setStartTrigger(defId, startConfig) {
    await connectMongo();
    const _id = toObjectId(defId);
    await WorkflowDefinition.findByIdAndUpdate(_id, { start: startConfig }, { new: true });
    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// Clone một definition
export async function cloneWorkflowDefinition(defId, createdBy) {
    await connectMongo();
    const src = await WorkflowDefinition.findById(toObjectId(defId)).lean();
    if (!src) return null;
    delete src._id;
    src.name = `${src.name} (Bản sao)`;
    src.version = (src.version || 1) + 1;
    src.createdBy = toObjectId(createdBy) || src.createdBy;
    const cloned = await WorkflowDefinition.create(src);
    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(cloned._id));
    return String(cloned._id);
}

/* ==========================
 * NODES
 * ========================== */

// addNode: nhận object hoặc FormData + auto chọn ô trống nếu bị trùng
export async function addNode(defId, data) {
    await connectMongo();
    const _id = toObjectId(defId);

    const get = (k) => (data instanceof FormData ? data.get(k) : data?.[k]);
    const parseJSON = (v, fb) => {
        if (v == null) return fb;
        if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fb; } }
        return v;
    };

    const uiInput = parseJSON(get('ui'), {});          // có thể là object hoặc JSON string
    const wantedGrid = uiInput?.grid;                  // { col, row } hoặc undefined

    // lấy các node hiện có để tính slot trống
    const def = await WorkflowDefinition.findById(_id, { nodes: 1 }).lean();
    const occupied = new Set((def?.nodes || []).map(n => `${n?.ui?.grid?.col ?? 1}:${n?.ui?.grid?.row ?? 1}`));
    const maxCol = Math.max(3, ...(def?.nodes || []).map(n => n?.ui?.grid?.col ?? 1)) + 2;
    const maxRow = Math.max(2, ...(def?.nodes || []).map(n => n?.ui?.grid?.row ?? 1));

    function findFree(pref) {
        if (pref && !occupied.has(`${pref.col}:${pref.row}`)) return pref;
        for (let r = 1; r <= maxRow + 2; r++) {
            for (let c = 1; c <= maxCol; c++) {
                if (!occupied.has(`${c}:${r}`)) return { col: c, row: r };
            }
        }
        return { col: maxCol + 1, row: 1 };
    }

    const finalGrid = findFree(wantedGrid);

    const node = {
        key: get('key') || undefined,
        type: get('type'),
        label: get('label') || '',
        description: get('description') || '',
        config: parseJSON(get('config'), {}),
        reentrant: String(get('reentrant') ?? 'true') === 'true',
        retry: parseJSON(get('retry'), {}),
        repeat: parseJSON(get('repeat'), { mode: 'none' }),
        ui: { ...uiInput, grid: finalGrid },
    };

    await WorkflowDefinition.updateOne({ _id }, { $push: { nodes: node } });

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// updateNode: nếu cập nhật ui.grid vào ô đã có node khác → SWAP vị trí
export async function updateNode(defId, nodeId, patch) {
    await connectMongo();
    const _id = toObjectId(defId);
    const nId = toObjectId(nodeId);

    const newGrid = patch?.ui?.grid;
    if (newGrid) {
        const def = await WorkflowDefinition.findById(_id, { nodes: 1 }).lean();
        const self = def?.nodes?.find(n => String(n._id) === String(nId));
        const other = def?.nodes?.find(n =>
            String(n._id) !== String(nId) &&
            n?.ui?.grid?.col === newGrid.col &&
            n?.ui?.grid?.row === newGrid.row
        );

        if (other) {
            await WorkflowDefinition.updateOne(
                { _id },
                {
                    $set: {
                        "nodes.$[moving].ui.grid": newGrid,
                        "nodes.$[other].ui.grid": self?.ui?.grid || { col: 1, row: 1 },
                    },
                },
                { arrayFilters: [{ "moving._id": nId }, { "other._id": other._id }] }
            );
        } else {
            await WorkflowDefinition.updateOne(
                { _id, "nodes._id": nId },
                { $set: { "nodes.$.ui.grid": newGrid } }
            );
        }

        // tiếp tục update các field khác (nếu có) trừ ui.grid (đã xử lý)
        const prefix = "nodes.$.";
        const setObj = {};
        const allowed = ["key", "type", "label", "description", "config", "reentrant", "retry", "repeat", "ui"];
        for (const k of allowed) {
            if (k === "ui") continue;
            if (k in patch) setObj[prefix + k] = patch[k];
        }
        if (Object.keys(setObj).length) {
            await WorkflowDefinition.updateOne({ _id, "nodes._id": nId }, { $set: setObj });
        }
    } else {
        const prefix = "nodes.$.";
        const setObj = {};
        const allowed = ["key", "type", "label", "description", "config", "reentrant", "retry", "repeat", "ui"];
        for (const k of allowed) if (k in patch) setObj[prefix + k] = patch[k];
        await WorkflowDefinition.updateOne({ _id, "nodes._id": nId }, { $set: setObj });
    }

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

export async function normalizeWorkflowGrid(defId) {
    await connectMongo();
    const _id = toObjectId(defId);
    const def = await WorkflowDefinition.findById(_id, { nodes: 1 }).lean();
    if (!def) return;

    const occupied = new Set();
    const nodes = def.nodes || [];

    const result = [];
    let col = 1, row = 1;
    const nextFree = () => {
        while (occupied.has(`${col}:${row}`)) {
            col++; if (col > 12) { col = 1; row++; }
        }
        return { col, row };
    };

    for (const n of nodes) {
        const cur = n?.ui?.grid;
        const grid = (cur && typeof cur.col === 'number' && typeof cur.row === 'number')
            ? cur
            : nextFree(); // node chưa có grid -> gán slot trống

        occupied.add(`${grid.col}:${grid.row}`);
        result.push({
            ...n,
            ui: { ...(n.ui || {}), grid }, // giữ nguyên position cũ nếu bạn muốn, nhưng builder chỉ dùng grid
        });
    }

    await WorkflowDefinition.updateOne({ _id }, { $set: { nodes: result } });

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// Xóa node + mọi edge liên quan
export async function removeNode(defId, nodeId) {
    await connectMongo();
    const _id = toObjectId(defId);
    const nId = toObjectId(nodeId);

    await WorkflowDefinition.updateOne(
        { _id },
        {
            $pull: { nodes: { _id: nId }, edges: { $or: [{ from: nId }, { to: nId }] } }
        }
    );

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

/* ==========================
 * EDGES (TRANSITIONS)
 * ========================== */

// Thêm edge
export async function addEdge(defId, formData) {
    await connectMongo();
    const _id = toObjectId(defId);
    const edge = {
        from: toObjectId(formData.get('from')),
        to: toObjectId(formData.get('to')),
        priority: Number(formData.get('priority') || 0),
        guard: JSON.parse(formData.get('guard') || 'null'),
        trigger: JSON.parse(formData.get('trigger') || '{"type":"immediate"}'),
        allowLoop: (formData.get('allowLoop') ?? 'true') === 'true',
        allowParallel: (formData.get('allowParallel') ?? 'false') === 'true',
        label: formData.get('label') || '',
    };

    await WorkflowDefinition.updateOne(
        { _id },
        { $push: { edges: edge } }
    );

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// Cập nhật edge
export async function updateEdge(defId, edgeId, patch) {
    await connectMongo();
    const _id = toObjectId(defId);
    const eId = toObjectId(edgeId);
    const prefix = 'edges.$.';
    const setObj = {};
    const allowed = ['from', 'to', 'priority', 'guard', 'trigger', 'allowLoop', 'allowParallel', 'label'];
    for (const k of allowed) if (k in patch) setObj[prefix + k] = patch[k];

    await WorkflowDefinition.updateOne(
        { _id, 'edges._id': eId },
        { $set: setObj }
    );

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

// Xóa edge
export async function removeEdge(defId, edgeId) {
    await connectMongo();
    const _id = toObjectId(defId);
    const eId = toObjectId(edgeId);

    await WorkflowDefinition.updateOne(
        { _id },
        { $pull: { edges: { _id: eId } } }
    );

    revalidateTag(TAG_DEFS);
    revalidateTag(tagDef(_id));
}

/* ==========================
 * INSTANCES
 * ========================== */

// Khởi chạy instance cho 1 đối tượng (ví dụ khách hàng)
export async function startInstance(defId, target) {
    // target: { type: 'customer', id, display }
    await connectMongo();
    const definitionId = toObjectId(defId);

    const payload = {
        definitionId,
        target: {
            type: target?.type || 'customer',
            id: toObjectId(target?.id),
            display: target?.display || '',
        },
        context: target?.context || {},
        status: 'pending',
        activeNodeIds: [],
        history: [],
        waiting: [],
        createdBy: toObjectId(target?.createdBy) || null,
        customerId: toObjectId(target?.id) || null,
        startedAt: new Date(),
    };

    const inst = await WorkflowInstance.create(payload);

    // TODO: tích hợp Agenda runner để enqueue node bắt đầu (engine riêng)
    // ví dụ: await enqueueNodeJob({ instanceId: inst._id })

    // set về running (tùy engine cập nhật), ở đây chỉ demo
    await WorkflowInstance.updateOne({ _id: inst._id }, { $set: { status: 'running' } });

    revalidateTag(tagInstOfDef(definitionId));
    revalidateTag(tagInst(inst._id));
    return String(inst._id);
}

export async function pauseInstance(instanceId) {
    await connectMongo();
    const _id = toObjectId(instanceId);
    await WorkflowInstance.updateOne({ _id }, { $set: { status: 'paused' } });
    revalidateTag(tagInst(_id));
}

export async function resumeInstance(instanceId) {
    await connectMongo();
    const _id = toObjectId(instanceId);
    await WorkflowInstance.updateOne({ _id }, { $set: { status: 'running' } });
    revalidateTag(tagInst(_id));
}

export async function cancelInstance(instanceId) {
    await connectMongo();
    const _id = toObjectId(instanceId);
    await WorkflowInstance.updateOne({ _id }, { $set: { status: 'canceled', finishedAt: new Date() } });
    revalidateTag(tagInst(_id));
}

// Gửi sự kiện vào workflow để kích hoạt các trigger dạng event
export async function ingestEvent(defId, event) {
    await connectMongo();
    const definitionId = toObjectId(defId);

    // Tìm các instance đang chờ event tương ứng
    const key = event?.key;
    if (!key) return;

    const instances = await WorkflowInstance.find({
        definitionId,
        status: { $in: ['running', 'pending'] },
        'waiting.eventKey': key
    }, { _id: 1 }).lean();

    // TODO: với mỗi instance, gọi engine để tiếp tục (ví dụ: continueFromEvent)
    // for (const it of instances) await continueInstanceByEvent(it._id, event)

    // Revalidate danh sách instance của definition
    revalidateTag(tagInstOfDef(definitionId));
}
