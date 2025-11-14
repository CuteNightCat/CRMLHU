// hooks/useActionUI.js
'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Loading from '@/components/(ui)/(loading)/loading'
import Noti from '@/components/(features)/(noti)/noti'
import '@/styles/all.css' // Đảm bảo file này chứa CSS cho .loadingOverlay

// ========================================================================
// === 1. TẠO PORTAL HELPER COMPONENT ===
// ========================================================================
// Component này sẽ "dịch chuyển" các children của nó ra ngoài thẻ <body>.
// Nó xử lý việc chỉ render ở phía client để tương thích với Next.js SSR.

const Portal = ({ children }) => {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        // Cleanup function để xử lý khi component bị unmount
        return () => setMounted(false)
    }, [])

    // Chỉ khi component đã được mount ở client (mounted = true),
    // chúng ta mới tạo portal. Nếu không, trả về null để tránh lỗi ở server.
    return mounted
        ? createPortal(children, document.body)
        : null
}


/**
 * Hook UI cho mọi action server, sử dụng Portal để đảm bảo hiển thị đúng.
 * - Quản lý overlay Loading + Noti (trả về <UI /> để render).
 * - run(fn, options): chạy action với loading/noti.
 */
export default function useActionUI() {
    const router = useRouter()

    const [loading, setLoading] = useState(null) // string | null
    const [notiOpen, setNotiOpen] = useState(false)
    const [notiStatus, setNotiStatus] = useState(true)
    const [notiMes, setNotiMes] = useState('')

    const showNoti = useCallback((ok, mes) => {
        setNotiStatus(!!ok)
        setNotiMes(mes || (ok ? 'Thành công' : 'Thất bại'))
        setNotiOpen(true)
    }, [])

    const hideNoti = useCallback(() => setNotiOpen(false), [])

    const UI = useMemo(() => {
        return function ActionUIFragment() {
            return (
                // ========================================================================
                // === 2. SỬ DỤNG PORTAL ĐỂ BAO BỌC GIAO DIỆN ===
                // ========================================================================
                // Giờ đây, Loading và Noti sẽ được render trực tiếp trong <body>
                // và không bị ảnh hưởng bởi CSS của các component cha.
                <Portal>
                    {loading && (
                        <div className='loadingOverlay'>
                            <Loading content={<h5 style={{ color: 'white' }}>{loading}</h5>} />
                        </div>
                    )}
                    <div data-action-ui-container>
                        <Noti open={notiOpen} onClose={hideNoti} status={notiStatus} mes={notiMes} />
                    </div>
                </Portal>
            )
        }
    }, [loading, notiOpen, notiStatus, notiMes, hideNoti])

    // Phần logic của hàm run không thay đổi
    const run = useCallback(
        async (
            fn,
            {
                loadingText = 'Đang xử lý…',
                successMessage = 'Thành công',
                errorMessage = 'Có lỗi xảy ra',
                silentOnSuccess = true,
                refreshOnSuccess = false,
                onSuccess,
            } = {}
        ) => {
            try {
                setLoading(loadingText)
                const res = await fn()
                setLoading(null)

                if (!res?.ok) {
                    showNoti(false, res?.message || errorMessage)
                } else {
                    if (typeof onSuccess === 'function') {
                        try { onSuccess(res) } catch { }
                    }
                    if (refreshOnSuccess) router.refresh()
                    if (!silentOnSuccess) showNoti(true, res?.message || successMessage)
                }
                return res
            } catch (e) {
                setLoading(null)
                showNoti(false, errorMessage)
                return { ok: false, message: errorMessage }
            }
        },
        [router, showNoti]
    )

    return {
        UI,
        run,
        setLoading,
        showNoti,
        hideNoti,
    }
}