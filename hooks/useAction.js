'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';

/**
 * useActionFeedback — hook chuẩn hoá gọi async action cho toàn dự án.
 * - run(actionFn, args?, options?) -> res
 * - loading: boolean
 * - status: 'idle' | 'loading' | 'success' | 'error'
 * - message: chuỗi message cuối cùng
 *
 * options:
 *  - autoRefresh: boolean (default: true) -> router.refresh() khi success
 *  - successMessage: string | (res) => string
 *  - errorMessage: string | (err|res) => string
 *  - onSuccess: (res) => void
 *  - onError: (err|res) => void
 *  - silent: boolean -> không tự tạo message
 *  - toast: boolean (default: true) -> hiện toast
 *  - overlay: boolean (default: true) -> phủ loading toàn màn hình
 *  - duration: number (ms, default: 2500) -> thời gian auto dismiss toast
 */

const OVERLAY_ID = 'action-overlay-root';
const TOAST_ROOT_ID = 'action-toast-root';

// ====== Singleton overlay counter để xử lý nhiều action song song ======
let _overlayCounter = 0;

function ensureOverlayRoot() {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className =
        'fixed inset-0 z-[10000] grid place-items-center bg-black/40 backdrop-blur-[2px] ' +
        'transition-opacity duration-150 opacity-0 pointer-events-none';
    el.setAttribute('aria-hidden', 'true');

    // Nội dung spinner
    const panel = document.createElement('div');
    panel.className =
        'rounded-xl border shadow-xl bg-[var(--surface)]/85 p-5 ' +
        'flex items-center justify-center';
    panel.style.borderColor = 'var(--border)';
    panel.innerHTML = `
    <div class="flex items-center gap-3">
      <svg class="animate-spin h-7 w-7 text-[var(--primary-600)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"/>
        <path class="opacity-75" d="M4 12a8 8 0 018-8" stroke-width="4" stroke-linecap="round"/>
      </svg>
    </div>
  `;
    el.appendChild(panel);
    document.body.appendChild(el);
    return el;
}

function showOverlay() {
    const root = ensureOverlayRoot();
    _overlayCounter++;
    // bật
    root.classList.remove('pointer-events-none', 'opacity-0');
    root.classList.add('opacity-100');
}

function hideOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    if (!root) return;
    _overlayCounter = Math.max(0, _overlayCounter - 1);
    if (_overlayCounter === 0) {
        // tắt
        root.classList.add('pointer-events-none', 'opacity-0');
        root.classList.remove('opacity-100');
    }
}

// ====== Toaster tối giản (kiểu Sonner) ======
function ensureToastRoot() {
    let el = document.getElementById(TOAST_ROOT_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = TOAST_ROOT_ID;
    el.className =
        'fixed top-3 right-3 z-[10001] flex flex-col items-end gap-2 pointer-events-none';
    document.body.appendChild(el);
    return el;
}

function iconFor(type) {
    const base = 'w-5 h-5';
    if (type === 'success')
        return `<svg class="${base}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke-width="2"/></svg>`;
    if (type === 'error')
        return `<svg class="${base}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke-width="2" stroke-linecap="round"/></svg>`;
    return `<svg class="${base}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="2"/><path d="M12 8v4m0 4h.01" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function showToastDom({ message, type = 'success', duration = 2500 }) {
    const root = ensureToastRoot();

    const color =
        type === 'success'
            ? 'text-[var(--success-600)]'
            : type === 'error'
                ? 'text-[var(--danger-700)]'
                : 'text-[var(--primary-700)]';

    const toast = document.createElement('div');
    toast.className =
        'pointer-events-auto min-w-[260px] max-w-[420px] overflow-hidden ' +
        'rounded-[10px] border bg-[var(--surface)] text-[var(--text)] shadow-lg ' +
        'opacity-0 translate-y-2 transition-all duration-150';
    toast.style.borderColor = 'var(--border)';

    toast.innerHTML = `
    <div class="flex items-start gap-3 p-3">
      <div class="${color}">${iconFor(type)}</div>
      <div class="flex-1 text-sm">${message ?? ''}</div>
      <button class="ml-2 rounded-[6px] border px-1.5 py-1 text-xs hover:bg-[var(--surface-2)]"
              style="border-color: var(--border)">Đóng</button>
    </div>
  `;

    const close = () => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 160);
    };

    toast.querySelector('button')?.addEventListener('click', close);
    root.appendChild(toast);

    // animate in
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
    });

    if (duration > 0) setTimeout(close, duration);
}

// ====== Hook ======
export function useActionFeedback(defaults = {}) {
    const router = useRouter();
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [isPending, startTransition] = useTransition();
    const [loading, setLoading] = useState(false);

    // khởi tạo root (client side)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        ensureOverlayRoot();
        ensureToastRoot();
    }, []);

    const run = useCallback(
        async (actionFn, args = [], options = {}) => {
            const {
                autoRefresh = defaults.autoRefresh ?? true,
                successMessage = defaults.successMessage,
                errorMessage = defaults.errorMessage,
                onSuccess = defaults.onSuccess,
                onError = defaults.onError,
                silent = false,
                toast = options.toast ?? true,
                overlay = options.overlay ?? true,
                duration = options.duration ?? 2500,
            } = options;

            setStatus('loading');
            setLoading(true);
            setMessage('');

            if (overlay) showOverlay();

            try {
                const res = await actionFn(...(Array.isArray(args) ? args : [args]));
                const ok = res?.success !== false;

                if (ok) {
                    setStatus('success');
                    const msg =
                        typeof successMessage === 'function'
                            ? successMessage(res)
                            : successMessage || 'Thao tác thành công.';
                    if (!silent) setMessage(msg);
                    onSuccess?.(res);

                    if (toast && !silent) showToastDom({ message: msg, type: 'success', duration });

                    if (autoRefresh) startTransition(() => router.refresh());
                } else {
                    setStatus('error');
                    const msg =
                        typeof errorMessage === 'function'
                            ? errorMessage(res)
                            : res?.error || errorMessage || 'Thao tác thất bại.';
                    if (!silent) setMessage(msg);
                    onError?.(res);

                    if (toast && !silent) showToastDom({ message: msg, type: 'error', duration });
                }

                return res;
            } catch (err) {
                setStatus('error');
                const msg =
                    typeof options.errorMessage === 'function'
                        ? options.errorMessage(err)
                        : err?.message || defaults.errorMessage || 'Có lỗi xảy ra.';
                if (!silent) setMessage(msg);
                onError?.(err);

                if (toast && !silent) showToastDom({ message: msg, type: 'error', duration });

                return { success: false, error: msg };
            } finally {
                setLoading(false);
                if (overlay) hideOverlay();
            }
        },
        [defaults, router]
    );

    return useMemo(
        () => ({
            run,
            loading: loading || isPending,
            status,
            message,
            clearMessage: () => setMessage(''),
            // tiện ích: show toast thủ công nếu cần
            toast: (msg, type = 'info', duration = 2500) => showToastDom({ message: msg, type, duration }),
            showOverlay,
            hideOverlay,
        }),
        [run, loading, isPending, status, message]
    );
}
