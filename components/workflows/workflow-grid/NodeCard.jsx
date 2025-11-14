"use client";

import { CirclePlay, Edit3, Trash2, Link2, Star } from "lucide-react";
import { toVNActionType } from "@/lib/i18n/workflow.vi";

export default function NodeCard({
    node,
    isStart,
    connectMode = false,
    isConnectSource = false,
    onClickConnect,
    onEdit,
    onDelete,
    onSetStart,
    draggable = false,
    onDragStart,
}) {
    const title = node.label || toVNActionType(node.type);

    return (
        <div
            className={`h-full w-full rounded-2xl border shadow-sm bg-white/95 backdrop-blur
        ring-1 ring-black/5 hover:shadow-md transition relative group select-none`}
            draggable={draggable}
            onDragStart={onDragStart}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b bg-gradient-to-br from-white to-gray-50 rounded-t-2xl flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">
                        {title?.slice(0, 1)?.toUpperCase()}
                    </div>
                    <div className="truncate text-sm font-semibold">{title}</div>
                </div>
                <div className="flex items-center gap-1">
                    {isStart && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CirclePlay className="w-3 h-3" /> Bắt đầu
                        </span>
                    )}
                    {connectMode && (
                        <button
                            className={`text-[10px] px-2 py-0.5 rounded-md border transition
                ${isConnectSource ? "bg-emerald-600 text-white border-emerald-600" : "hover:bg-gray-50"}`}
                            onClick={onClickConnect}
                            title="Chọn làm nguồn/đích để nối"
                        >
                            <Link2 className="w-3.5 h-3.5 inline-block mr-1" />
                            {isConnectSource ? "Nguồn ✓" : "Chọn"}
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="px-3 py-2 text-xs text-muted-foreground h-[72px] overflow-hidden">
                <div>Loại: <b>{node.type}</b></div>
                {node.description && <div className="mt-1 line-clamp-3">{node.description}</div>}
            </div>

            {/* Actions (hiện khi hover) */}
            {!connectMode && (
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition">
                    <div className="flex items-center gap-1 bg-white border rounded-full shadow-sm px-2 py-1">
                        <button className="p-1 rounded-full hover:bg-gray-50" title="Sửa" onClick={onEdit}>
                            <Edit3 className="w-4 h-4" />
                        </button>
                        <button className="p-1 rounded-full hover:bg-gray-50" title="Đặt làm bắt đầu" onClick={onSetStart}>
                            <Star className="w-4 h-4" />
                        </button>
                        <button className="p-1 rounded-full hover:bg-red-50" title="Xoá" onClick={onDelete}>
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
