// app/components/ui/CustomSelect.client.jsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export default function CustomSelect({ value, onChange, items, placeholder = 'Chọn một mục' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    const current = items.find((i) => i.value === value) || { value: '', label: placeholder };

    // Đóng dropdown khi click bên ngoài hoặc nhấn Escape
    useEffect(() => {
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, []);

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center justify-between w-full sm:w-auto min-w-[160px] gap-2 rounded-[6px] border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
            >
                <h5>{current.label}</h5>
                <ChevronDown fill="var(--text-primary)" className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown với hiệu ứng trượt */}
            <div
                className={`
          absolute z-20 left-0 mt-2 w-full rounded-[6px] border bg-[var(--bg-primary)] shadow-lg overflow-hidden
          transition-all duration-150 ease-out origin-top
          ${open ? 'opacity-100 translate-y-0 scale-y-100 max-h-60' : 'opacity-0 -translate-y-1 scale-y-95 pointer-events-none max-h-0'}
        `}
                style={{ borderColor: 'var(--border)' }}
                role="listbox"
            >
                {items.map((it) => {
                    const active = it.value === value;
                    return (
                        <button
                            key={it.value}
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                                onChange?.(it.value);
                                setOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer
                ${active ? 'bg-[var(--primary-100)]' : 'hover:bg-[var(--primary-50)]'}
              `}
                        >
                            {it.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}