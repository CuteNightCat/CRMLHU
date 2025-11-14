"use client";

import { useMemo, useState } from "react";
import Popup from "@/components/ui/popup";
import { setStartTrigger } from "@/data/workflows/actions";

export default function StartTriggerModal({ definition, onClose }) {
    const defId = String(definition?._id || "");
    const nodes = useMemo(() => definition?.nodes || [], [definition]);

    const [type, setType] = useState(definition?.start?.type || "manual");
    const [startNodeId, setStartNodeId] = useState(
        definition?.start?.startNodeId ? String(definition.start.startNodeId) : (nodes[0]?._id ? String(nodes[0]._id) : "")
    );
    const [eventKey, setEventKey] = useState(definition?.start?.event?.key || "");
    const [cron, setCron] = useState(definition?.start?.cron || "");
    const [datetime, setDatetime] = useState(definition?.start?.datetime || "");

    const onSubmit = async () => {
        const payload = { type, startNodeId };
        if (type === "event") payload.event = { key: eventKey };
        if (type === "cron") payload.cron = cron;
        if (type === "datetime") payload.datetime = new Date(datetime);
        await setStartTrigger(defId, payload);
        onClose?.();
    };

    return (
        <Popup
            open
            onClose={onClose}
            header="Cấu hình điều kiện bắt đầu"
            widthClass="max-w-xl"
            footer={
                <>
                    <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClose}>Huỷ</button>
                    <button className="px-3 py-2 rounded bg-black text-white hover:opacity-90" onClick={onSubmit}>Lưu</button>
                </>
            }
        >
            <div className="grid gap-4">
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Loại kích hoạt</label>
                    <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border rounded px-3 py-2">
                        <option value="manual">Thủ công</option>
                        <option value="event">Sự kiện (event)</option>
                        <option value="cron">Lịch cron</option>
                        <option value="datetime">Thời điểm cố định</option>
                    </select>
                </div>

                {type === "event" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Event key</label>
                        <input className="w-full border rounded px-3 py-2" value={eventKey}
                            onChange={(e) => setEventKey(e.target.value)} placeholder="appointment.created" />
                    </div>
                )}
                {type === "cron" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Cron</label>
                        <input className="w-full border rounded px-3 py-2" value={cron}
                            onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" />
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

                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Bước bắt đầu</label>
                    <select value={startNodeId} onChange={(e) => setStartNodeId(e.target.value)} className="w-full border rounded px-3 py-2">
                        {nodes.map(n => <option key={n._id} value={String(n._id)}>{n.label || n.type}</option>)}
                    </select>
                </div>
            </div>
        </Popup>
    );
}
