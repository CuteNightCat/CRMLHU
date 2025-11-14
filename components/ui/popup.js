'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Popup tái sử dụng
 * - Header luôn hiển thị (truyền vào qua prop `header`)
 * - Footer tùy chọn
 * - Hiệu ứng mở mượt, overlay blur
 * - Panel max-h = 90vh, main luôn scroll
 * - Header/Footer cao bằng nhau (h-14)
 */
export default function Popup({
    open,
    onClose,
    header,
    footer,
    widthClass = 'max-w-lg', // gợi ý mặc định giống demo (có thể truyền 'max-w-3xl' khi cần)
    disableOutsideClose = false,
    children,
}) {
    const [show, setShow] = useState(false);
    const panelRef = useRef(null);

    // mount animation
    useEffect(() => {
        if (open) {
            const t = requestAnimationFrame(() => setShow(true));
            return () => cancelAnimationFrame(t);
        } else {
            setShow(false);
        }
    }, [open]);

    // ESC để đóng
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === 'Escape' && onClose?.();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    // outside click
    const onOverlayClick = (e) => {
        if (disableOutsideClose) return;
        if (panelRef.current && !panelRef.current.contains(e.target)) onClose?.();
    };

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className={`fixed inset-0 z-50 flex items-center justify-center p-4
        bg-black/45 backdrop-blur-[2px]
        transition-opacity duration-200 ease-out
        ${show ? 'opacity-100' : 'opacity-0'}`}
            onMouseDown={onOverlayClick}
            style={{
                width: '100vw',
                height: '100vh',
                transform: 'translate(-50%, -50%)',
                left: '50%',
                top: '50%'
            }}
        >
            <div
                ref={panelRef}
                // Card
                className={`w-full ${widthClass} max-h-[90vh]
          bg-[var(--surface)] text-[var(--text)]
          border rounded-[6px]
          shadow-[0_20px_60px_rgba(0,0,0,0.16)] ring-1 ring-black/5
          flex flex-col
          transform transition duration-200 ease-out will-change-transform
          ${show ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0'}`}
                style={{ borderColor: 'var(--border)' }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    className="h-14 shrink-0 flex items-center justify-between px-6 border-b"
                    style={{ borderColor: 'var(--border)' }}
                >
                    <div className="min-w-0 truncate text-[15px] font-semibold">
                        {header}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-[6px] hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2"
                        style={{ boxShadow: '0 0 0 3px transparent', '--tw-ring-color': 'var(--ring)' }}
                        aria-label="Đóng"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Main (scroll) */}
                <div className="scroll flex-1 overflow-y-auto px-6 py-5">
                    {children}
                </div>

                {/* Footer (tùy chọn) */}
                {footer !== undefined && (
                    <div
                        className="h-14 shrink-0 flex items-center justify-end gap-2 px-6 border-t"
                        style={{ borderColor: 'var(--border)' }}
                    >
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
