"use client";

import { useEffect, useMemo, useState } from "react";
import Popup from "@/components/ui/popup";
import { addEdge as addEdgeAction, updateEdge } from "@/data/workflows/actions";
import { toVNTriggerType } from "@/lib/i18n/workflow.vi";

const TRIGGERS = ["immediate", "delay", "datetime", "cron", "event", "condition", "manual"];

export default function EdgeFormModal({ defId, definition, edge, prefill, onClose, onSaved }) {
    const editMode = !!edge;
    const nodes = useMemo(() => definition?.nodes || [], [definition]);

    const base = editMode ? edge : (prefill || {});
    const [from, setFrom] = useState(base.from ? String(base.from) : "");
    const [to, setTo] = useState(base.to ? String(base.to) : "");
    const [label, setLabel] = useState(base.label || "");
    const [type, setType] = useState(base.trigger?.type || "immediate");
    const [delayMs, setDelayMs] = useState(base.trigger?.delay?.ms || "");
    const [datetime, setDatetime] = useState(base.trigger?.datetime || "");
    const [cron, setCron] = useState(base.trigger?.cron || "");
    const [eventKey, setEventKey] = useState(base.trigger?.event?.key || "");
    const [guardJSON, setGuardJSON] = useState(JSON.stringify(base.guard || null, null, 2));
    const [priority, setPriority] = useState(base.priority ?? 0);
    const [allowParallel, setAllowParallel] = useState(base.allowParallel ?? false);
    const [allowLoop, setAllowLoop] = useState(base.allowLoop ?? true);

    useEffect(() => {
        const r = editMode ? (edge || {}) : (prefill || {});
        setFrom(r.from ? String(r.from) : "");
        setTo(r.to ? String(r.to) : "");
        setLabel(r.label || "");
        setType(r.trigger?.type || "immediate");
        setDelayMs(r.trigger?.delay?.ms || "");
        setDatetime(r.trigger?.datetime || "");
        setCron(r.trigger?.cron || "");
        setEventKey(r.trigger?.event?.key || "");
        setGuardJSON(JSON.stringify(r.guard || null, null, 2));
        setPriority(r.priority ?? 0);
        setAllowParallel(r.allowParallel ?? false);
        setAllowLoop(r.allowLoop ?? true);
    }, [edge, prefill, editMode]);

    const handleSubmit = async () => {
        if (!from || !to) { alert("Vui lòng chọn bước Từ/Đến"); return; }
        let guard = null;
        try { guard = JSON.parse(guardJSON || "null"); } catch { alert("Guard JSON không hợp lệ"); return; }

        const trigger = { type };
        if (type === "delay" && delayMs) trigger.delay = { ms: Number(delayMs) };
        if (type === "datetime" && datetime) trigger.datetime = new Date(datetime);
        if (type === "cron" && cron) trigger.cron = cron;
        if (type === "event" && eventKey) trigger.event = { key: eventKey };

        if (editMode) {
            await updateEdge(defId, String(edge._id), {
                from, to, label, guard, trigger,
                priority: Number(priority || 0),
                allowParallel, allowLoop,
            });
        } else {
            const fd = new FormData();
            fd.append("from", from);
            fd.append("to", to);
            fd.append("priority", String(priority || 0));
            fd.append("guard", JSON.stringify(guard));
            fd.append("trigger", JSON.stringify(trigger));
            fd.append("allowLoop", String(allowLoop));
            fd.append("allowParallel", String(allowParallel));
            fd.append("label", label || "");
            await addEdgeAction(defId, fd);
        }
        onSaved?.();
    };

    return (
        <Popup
            open
            onClose={onClose}
            header={editMode ? "Sửa liên kết" : "Thêm liên kết"}
            widthClass="max-w-3xl"
            footer={
                <>
                    <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClose}>Huỷ</button>
                    <button className="px-3 py-2 rounded bg-black text-white hover:opacity-90" onClick={handleSubmit}>
                        {editMode ? "Lưu thay đổi" : "Thêm liên kết"}
                    </button>
                </>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Từ bước</label>
                    <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border rounded px-3 py-2">
                        <option value="">-- Chọn --</option>
                        {nodes.map(n => <option key={n._id} value={String(n._id)}>{n.label || n.type}</option>)}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Đến bước</label>
                    <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full border rounded px-3 py-2">
                        <option value="">-- Chọn --</option>
                        {nodes.map(n => <option key={n._id} value={String(n._id)}>{n.label || n.type}</option>)}
                    </select>
                </div>

                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Trigger</label>
                    <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border rounded px-3 py-2">
                        {TRIGGERS.map(t => <option key={t} value={t}>{toVNTriggerType(t)}</option>)}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Nhãn (tuỳ chọn)</label>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full border rounded px-3 py-2" />
                </div>

                {type === "delay" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Delay (ms)</label>
                        <input type="number" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} className="w-full border rounded px-3 py-2" />
                    </div>
                )}
                {type === "datetime" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Thời điểm</label>
                        <input type="datetime-local"
                            value={datetime ? new Date(datetime).toISOString().slice(0, 16) : ""}
                            onChange={(e) => setDatetime(e.target.value)}
                            className="w-full border rounded px-3 py-2" />
                    </div>
                )}
                {type === "cron" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Cron</label>
                        <input value={cron} onChange={(e) => setCron(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="0 9 * * *" />
                    </div>
                )}
                {type === "event" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Event key</label>
                        <input value={eventKey} onChange={(e) => setEventKey(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="appointment.canceled" />
                    </div>
                )}

                <div className="md:col-span-2 grid md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Guard (JSON)</label>
                        <textarea value={guardJSON} onChange={(e) => setGuardJSON(e.target.value)} className="w-full border rounded px-3 py-2 font-mono text-xs h-28" />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Tùy chọn</label>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" className="border rounded px-3 py-2" value={priority}
                                onChange={(e) => setPriority(e.target.value)} placeholder="Ưu tiên" />
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={allowParallel} onChange={(e) => setAllowParallel(e.target.checked)} />
                                Cho phép song song
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={allowLoop} onChange={(e) => setAllowLoop(e.target.checked)} />
                                Cho phép vòng lặp
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </Popup>
    );
}
