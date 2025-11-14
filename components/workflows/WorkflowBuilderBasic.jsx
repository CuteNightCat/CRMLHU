"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toVNActionType, toVNTriggerType } from "@/lib/i18n/workflow.vi";
import {
    removeNode,
    removeEdge as removeEdgeAction,
    setStartTrigger,
} from "@/data/workflows/actions";
import NodeFormModal from "./modals/NodeFormModal";
import EdgeFormModal from "./modals/EdgeFormModal";
import StartTriggerModal from "./modals/StartTriggerModal";

export default function WorkflowBuilderBasic({ definition }) {
    const router = useRouter();
    const defId = String(definition?._id || "");
    const nodes = useMemo(() => definition?.nodes || [], [definition]);
    const edges = useMemo(() => definition?.edges || [], [definition]);

    const [openNode, setOpenNode] = useState({ open: false, node: null });
    const [openEdge, setOpenEdge] = useState({ open: false, edge: null });
    const [openStart, setOpenStart] = useState(false);

    const handleDeleteNode = async (nodeId) => {
        await removeNode(defId, nodeId);
        router.refresh();
    };
    const handleDeleteEdge = async (edgeId) => {
        await removeEdgeAction(defId, edgeId);
        router.refresh();
    };
    const handleSetStartNode = async (nodeId) => {
        // giữ nguyên kiểu start hiện tại, chỉ thay node bắt đầu
        await setStartTrigger(defId, {
            type: definition?.start?.type || "manual",
            startNodeId: nodeId,
            ...(definition?.start?.event ? { event: definition.start.event } : {}),
            ...(definition?.start?.cron ? { cron: definition.start.cron } : {}),
            ...(definition?.start?.datetime ? { datetime: definition.start.datetime } : {}),
        });
        router.refresh();
    };

    return (
        <div className="p-4 space-y-6">
            {/* Thanh tiêu đề / thao tác */}
            <div className="flex items-center gap-2">
                <h4>Builder: {definition?.name}</h4>
                <span className="text-sm text-muted-foreground">
                    (Bắt đầu: {definition?.start?.startNodeId ? "Đã đặt" : "Chưa đặt"})
                </span>
                <div className="flex-1" />
                <button
                    className="px-3 py-1.5 rounded border hover:bg-gray-50"
                    onClick={() => setOpenStart(true)}
                >
                    Cấu hình điều kiện bắt đầu
                </button>
            </div>

            {/* Lưới 2 cột: Bước (trái) & Liên kết (phải) */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* Cột Bước */}
                <section className="rounded-md border">
                    <div className="flex items-center justify-between p-3 border-b">
                        <div className="font-medium">Các bước (hành động)</div>
                        <button
                            className="px-3 py-1.5 rounded border hover:bg-gray-50"
                            onClick={() => setOpenNode({ open: true, node: null })}
                        >
                            + Thêm bước
                        </button>
                    </div>

                    <div className="divide-y">
                        {nodes.length === 0 && (
                            <div className="p-4 text-sm text-muted-foreground">Chưa có bước.</div>
                        )}
                        {nodes.map((n, idx) => (
                            <div key={n._id} className="p-4 flex items-start gap-3">
                                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm">
                                    {idx + 1}
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium">
                                        {n.label || toVNActionType(n.type)}{" "}
                                        <span className="text-xs text-muted-foreground">(type: {n.type})</span>
                                    </div>
                                    {n.description && (
                                        <div className="text-sm text-muted-foreground mt-0.5">
                                            {n.description}
                                        </div>
                                    )}
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <button
                                            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                                            onClick={() => setOpenNode({ open: true, node: n })}
                                        >
                                            Sửa
                                        </button>
                                        <button
                                            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                                            onClick={() => handleSetStartNode(String(n._id))}
                                        >
                                            Đặt làm bắt đầu
                                        </button>
                                        <button
                                            className="px-2 py-1 rounded border text-sm hover:bg-red-50"
                                            onClick={() => handleDeleteNode(String(n._id))}
                                        >
                                            Xoá
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Cột Liên kết */}
                <section className="rounded-md border">
                    <div className="flex items-center justify-between p-3 border-b">
                        <div className="font-medium">Các liên kết (Trigger → bước tiếp theo)</div>
                        <button
                            className="px-3 py-1.5 rounded border hover:bg-gray-50"
                            onClick={() => setOpenEdge({ open: true, edge: null })}
                        >
                            + Thêm liên kết
                        </button>
                    </div>

                    <div className="divide-y">
                        {edges.length === 0 && (
                            <div className="p-4 text-sm text-muted-foreground">Chưa có liên kết.</div>
                        )}
                        {edges.map((e) => (
                            <div key={e._id} className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                        <div className="font-medium">
                                            {e.uiLabel || e.label || toVNTriggerType(e?.trigger?.type)}
                                        </div>
                                        <div className="text-sm text-muted-foreground mt-0.5">
                                            Từ: <b>{nodes.find((n) => String(n._id) === String(e.from))?.label || e.from}</b>
                                            {"  "}→{"  "}
                                            Đến: <b>{nodes.find((n) => String(n._id) === String(e.to))?.label || e.to}</b>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Ưu tiên: {e.priority ?? 0} • Parallel: {String(e.allowParallel)} • Loop: {String(e.allowLoop)}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                                            onClick={() => setOpenEdge({ open: true, edge: e })}
                                        >
                                            Sửa
                                        </button>
                                        <button
                                            className="px-2 py-1 rounded border text-sm hover:bg-red-50"
                                            onClick={() => handleDeleteEdge(String(e._id))}
                                        >
                                            Xoá
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {/* Modals */}
            {openNode.open && (
                <NodeFormModal
                    defId={defId}
                    node={openNode.node}
                    onClose={() => setOpenNode({ open: false, node: null })}
                    onSaved={() => {
                        setOpenNode({ open: false, node: null });
                        router.refresh();
                    }}
                />
            )}
            {openEdge.open && (
                <EdgeFormModal
                    defId={defId}
                    definition={definition}
                    edge={openEdge.edge}
                    onClose={() => setOpenEdge({ open: false, edge: null })}
                    onSaved={() => {
                        setOpenEdge({ open: false, edge: null });
                        router.refresh();
                    }}
                />
            )}
            {openStart && (
                <StartTriggerModal
                    definition={definition}
                    onClose={() => {
                        setOpenStart(false);
                        router.refresh();
                    }}
                />
            )}
        </div>
    );
}
