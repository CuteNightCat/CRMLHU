"use client";

import { useMemo } from "react";

function edgePath(from, to) {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const dx = Math.max(40, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export default function GridArrows({ edges, anchorMap, wrapperRef, stroke = "#bdbdbd" }) {
    const lines = useMemo(() => {
        const arr = [];
        for (const e of edges || []) {
            const f = anchorMap[String(e.from)];
            const t = anchorMap[String(e.to)];
            if (!f || !t) continue;
            arr.push({ id: String(e._id), d: edgePath(f, t) });
        }
        return arr;
    }, [edges, anchorMap]);

    const w = wrapperRef?.current?.clientWidth || 1200;
    const h = wrapperRef?.current?.clientHeight || 700;

    return (
        <svg className="absolute left-0 top-0 pointer-events-none" width={w} height={h} aria-hidden>
            <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
                </marker>
            </defs>
            {lines.map((l) => (
                <path key={l.id} d={l.d} fill="none" stroke={stroke} strokeWidth="2" markerEnd="url(#arrow)" />
            ))}
        </svg>
    );
}
