"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toVNTriggerType } from "@/lib/i18n/workflow.vi";
import {
    addNode,
    updateNode,
    removeNode,
    setStartTrigger,
    removeEdge as removeEdgeAction,
} from "@/data/workflows/actions";

import NodeFormModal from "./modals/NodeFormModal";
import EdgeFormModal from "./modals/EdgeFormModal";
import StartTriggerModal from "./modals/StartTriggerModal";
import NodeCard from "./workflow-grid/NodeCard";
import GridArrows from "./workflow-grid/GridArrows";
import { ZoomIn, ZoomOut, Maximize, Link2, Settings, Plus, CirclePlay } from "lucide-react";

const CELL_W = 260;
const CELL_H = 140;
const GAP = 24;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

export default function WorkflowGridBuilder({ definition }) {
    const router = useRouter();
    const defId = String(definition?._id || "");
    const nodes = useMemo(() => definition?.nodes || [], [definition]);
    const edges = useMemo(() => definition?.edges || [], [definition]);

    // ===== Grid size =====
    const maxCol = Math.max(3, ...(nodes.map(n => n?.ui?.grid?.col || 1))) + 2;
    const maxRow = Math.max(2, ...(nodes.map(n => n?.ui?.grid?.row || 1)));

    // ===== SVG anchors =====
    const wrapperRef = useRef(null);
    const gridRef = useRef(null);
    const nodeRefs = useRef({});
    const [anchorMap, setAnchorMap] = useState({});

    const measure = useCallback(() => {
        if (!wrapperRef.current) return;
        const root = wrapperRef.current.getBoundingClientRect();
        const next = {};
        for (const n of nodes) {
            const el = nodeRefs.current[String(n._id)];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            // tọa độ tương đối so với wrapper (để vẽ path)
            next[String(n._id)] = { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height };
        }
        setAnchorMap(next);
    }, [nodes]);

    // ======= PAN / ZOOM (không scroll) =======
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [spaceDown, setSpaceDown] = useState(false);
    const [panning, setPanning] = useState(false);
    const panStart = useRef({ x: 0, y: 0 });
    const pointerStart = useRef({ x: 0, y: 0 });

    const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

    // Wheel = zoom vào con trỏ
    const onWheel = (e) => {
        e.preventDefault();
        const rect = wrapperRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const ns = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

        // giữ điểm dưới con trỏ cố định
        const ox = (cx - pan.x) / scale;
        const oy = (cy - pan.y) / scale;
        const nx = cx - ox * ns;
        const ny = cy - oy * ns;

        setScale(ns);
        setPan({ x: nx, y: ny });
    };

    // Space = pan
    useEffect(() => {
        const kd = (e) => { if (e.code === "Space") { e.preventDefault(); setSpaceDown(true); } };
        const ku = (e) => { if (e.code === "Space") { e.preventDefault(); setSpaceDown(false); setPanning(false); } };
        window.addEventListener("keydown", kd);
        window.addEventListener("keyup", ku);
        return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
    }, []);

    const onMouseDown = (e) => {
        if (!spaceDown) return;
        setPanning(true);
        panStart.current = pan;
        pointerStart.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e) => {
        if (!panning) return;
        const dx = e.clientX - pointerStart.current.x;
        const dy = e.clientY - pointerStart.current.y;
        setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
    };
    const onMouseUp = () => setPanning(false);
    useEffect(() => { measure(); }, [scale, pan, edges, nodes, measure]);

    // ===== Modal state =====
    const [openNode, setOpenNode] = useState({ open: false, node: null });
    const [openEdge, setOpenEdge] = useState({ open: false, edge: null, prefill: null });
    const [openStart, setOpenStart] = useState(false);

    // ===== Connect mode (nối bước) =====
    const [connectMode, setConnectMode] = useState(false);
    const [connectFromId, setConnectFromId] = useState(null);
    const beginConnect = (nodeId) => {
        if (!connectMode) return;
        if (!connectFromId) { setConnectFromId(nodeId); return; }
        if (connectFromId && nodeId && connectFromId !== nodeId) {
            setOpenEdge({ open: true, edge: null, prefill: { from: connectFromId, to: nodeId } });
            setConnectFromId(null); setConnectMode(false);
        }
    };

    // ===== CRUD Node =====
    const handleAddNode = async () => {
        const occupied = new Set((nodes || []).map(n => `${n?.ui?.grid?.col || 1}:${n?.ui?.grid?.row || 1}`));
        let found = null;
        outer: for (let r = 1; r <= maxRow + 2; r++) {
            for (let c = 1; c <= maxCol; c++) {
                if (!occupied.has(`${c}:${r}`)) { found = { col: c, row: r }; break outer; }
            }
        }
        if (!found) found = { col: maxCol + 1, row: 1 };

        const payload = {
            type: "sendMessage",
            label: "",
            description: "",
            config: {},
            reentrant: true,
            retry: {},
            repeat: { mode: "none" },
            ui: { grid: found },
        };
        await addNode(defId, payload);
        router.refresh();
    };

    const moveNodeTo = async (nodeId, col, row) => {
        const self = nodes.find(n => String(n._id) === String(nodeId));
        if (!self) return;
        const g = self.ui?.grid || { col: 1, row: 1 };
        const nc = Math.max(1, Math.min(maxCol, col));
        const nr = Math.max(1, Math.min(maxRow + 2, row));
        const other = nodes.find(x => x._id !== self._id && x?.ui?.grid?.col === nc && x?.ui?.grid?.row === nr);
        if (other) {
            await updateNode(defId, String(other._id), { ui: { ...(other.ui || {}), grid: { col: g.col, row: g.row } } });
        }
        await updateNode(defId, String(self._id), { ui: { ...(self.ui || {}), grid: { col: nc, row: nr } } });
        router.refresh();
    };

    const setStartFromNode = async (nodeId) => {
        await setStartTrigger(defId, {
            type: definition?.start?.type || "manual",
            startNodeId: nodeId,
            ...(definition?.start?.event ? { event: definition.start.event } : {}),
            ...(definition?.start?.cron ? { cron: definition.start.cron } : {}),
            ...(definition?.start?.datetime ? { datetime: definition.start.datetime } : {}),
        });
        router.refresh();
    };

    // ===== DnD trong grid =====
    const onNodeDragStart = (e, nodeId) => {
        if (spaceDown) return; // đang pan → không cho kéo node
        e.dataTransfer.setData("text/node-id", String(nodeId));
        e.dataTransfer.effectAllowed = "move";
    };
    const onCellDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
    const onCellDrop = async (e, col, row) => {
        e.preventDefault();
        const nodeId = e.dataTransfer.getData("text/node-id");
        if (!nodeId) return;
        await moveNodeTo(nodeId, col, row);
    };

    // ===== Helpers =====
    const gridWidth = maxCol * (CELL_W + GAP) + GAP;
    const gridHeight = (maxRow + 2) * (CELL_H + GAP) + GAP;

    const cellPos = (col, row) => ({
        left: (col - 1) * (CELL_W + GAP) + GAP,
        top: (row - 1) * (CELL_H + GAP) + GAP,
    });

    // ===== Render =====
    return (
        <div className="h-[100%] w-full flex flex-col">
            {/* Toolbar đẹp hơn */}
            <div className="h-14 w-full border-b bg-white/80 backdrop-blur flex items-center gap-2 px-4">
                <div className="text-base font-semibold truncate">{definition?.name}</div>
                <span className="text-xs text-muted-foreground">• Bắt đầu: {definition?.start?.startNodeId ? "Đã đặt" : "Chưa đặt"}</span>
                <div className="flex-1" />
                <button
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition text-sm
            ${connectMode ? "bg-emerald-50 border-emerald-200" : "hover:bg-gray-50"}`}
                    onClick={() => { if (connectMode) { setConnectMode(false); setConnectFromId(null); } else setConnectMode(true); }}
                    title="Chế độ nối bước: click nguồn → click đích"
                >
                    <Link2 className="w-4 h-4" /> {connectMode ? "Đang nối…" : "Nối bước"}
                </button>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border hover:bg-gray-50 text-sm"
                    onClick={() => setOpenStart(true)}>
                    <Settings className="w-4 h-4" /> Bắt đầu
                </button>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border hover:bg-gray-50 text-sm"
                    onClick={handleAddNode}>
                    <Plus className="w-4 h-4" /> Thêm bước
                </button>
                {/* Zoom controls */}
                <div className="ml-2 flex items-center gap-1 rounded-md border px-1">
                    <button className="p-2 hover:bg-gray-50 rounded-md" onClick={() => setScale(s => clamp(s * 1.1, MIN_SCALE, MAX_SCALE))}><ZoomIn className="w-4 h-4" /></button>
                    <div className="px-2 text-xs tabular-nums">{Math.round(scale * 100)}%</div>
                    <button className="p-2 hover:bg-gray-50 rounded-md" onClick={() => setScale(s => clamp(s * 0.9, MIN_SCALE, MAX_SCALE))}><ZoomOut className="w-4 h-4" /></button>
                    <button className="p-2 hover:bg-gray-50 rounded-md" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} title="Đưa về 100%">
                        <Maximize className="w-4 h-4" />
                    </button>
                </div>
                <div className={`ml-2 text-sm rounded-md px-2 py-1.5 border ${spaceDown ? "bg-gray-100" : ""}`} title="Giữ Space để di chuyển">
                    Space = di chuyển
                </div>
            </div>

            {/* Canvas full màn hình, không scroll */}
            <div
                ref={wrapperRef}
                className={`relative flex-1 overflow-hidden bg-white`}
                onWheel={onWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
            >
                {/* SVG arrows overlay */}
                <GridArrows edges={edges} anchorMap={anchorMap} wrapperRef={wrapperRef} />

                {/* Grid content (transform theo pan/zoom) */}
                <div
                    ref={gridRef}
                    className={`absolute left-0 top-0`}
                    style={{
                        width: gridWidth,
                        height: gridHeight,
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                        transformOrigin: "0 0",
                        cursor: spaceDown ? (panning ? "grabbing" : "grab") : "default",
                    }}
                >
                    {/* nền chấm + viền nhẹ */}
                    <div className="absolute inset-0 rounded-lg border bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]" />

                    {/* Vùng cell nhận drop */}
                    {Array.from({ length: maxRow + 2 }).map((_, rIdx) => {
                        const row = rIdx + 1;
                        return Array.from({ length: maxCol }).map((__, cIdx) => {
                            const col = cIdx + 1;
                            const pos = cellPos(col, row);
                            return (
                                <div
                                    key={`cell-${col}-${row}`}
                                    onDragOver={onCellDragOver}
                                    onDrop={(e) => onCellDrop(e, col, row)}
                                    className="absolute rounded-xl"
                                    style={{ left: pos.left, top: pos.top, width: CELL_W, height: CELL_H }}
                                />
                            );
                        });
                    })}

                    {/* Node cards */}
                    {nodes.map((n) => {
                        const g = n.ui?.grid || { col: 1, row: 1 };
                        const pos = cellPos(g.col, g.row);
                        const isStart = String(definition?.start?.startNodeId || "") === String(n._id);
                        return (
                            <div
                                key={n._id}
                                ref={(el) => (nodeRefs.current[String(n._id)] = el)}
                                className="absolute"
                                style={{ left: pos.left, top: pos.top, width: CELL_W, height: CELL_H }}
                            >
                                <NodeCard
                                    node={n}
                                    isStart={isStart}
                                    connectMode={connectMode}
                                    isConnectSource={connectFromId === String(n._id)}
                                    onClickConnect={() => beginConnect(String(n._id))}
                                    onEdit={() => setOpenNode({ open: true, node: n })}
                                    onDelete={async () => { await removeNode(defId, String(n._id)); router.refresh(); }}
                                    onSetStart={() => setStartFromNode(String(n._id))}
                                    draggable={!spaceDown}
                                    onDragStart={(e) => onNodeDragStart(e, String(n._id))}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Modals */}
            {openNode.open && (
                <NodeFormModal
                    defId={defId}
                    node={openNode.node}
                    onClose={() => setOpenNode({ open: false, node: null })}
                    onSaved={() => { setOpenNode({ open: false, node: null }); router.refresh(); }}
                />
            )}
            {openEdge.open && (
                <EdgeFormModal
                    defId={defId}
                    definition={definition}
                    edge={openEdge.edge}
                    prefill={openEdge.prefill}
                    onClose={() => setOpenEdge({ open: false, edge: null, prefill: null })}
                    onSaved={() => { setOpenEdge({ open: false, edge: null, prefill: null }); router.refresh(); }}
                />
            )}
            {openStart && (
                <StartTriggerModal
                    definition={definition}
                    onClose={() => { setOpenStart(false); router.refresh(); }}
                />
            )}
        </div>
    );
}
