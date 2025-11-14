// socket-client.js
// Tạo singleton Socket.IO client + gắn LOG chi tiết vòng đời kết nối.
// Sử dụng getSocket() ở mọi nơi để tránh tạo nhiều kết nối.

import { io } from 'socket.io-client'

let socket = null

export function getSocket() {
    if (socket) return socket

    const url = process.env.NEXT_PUBLIC_REALTIME_URL
    const DEBUG = (process.env.NEXT_PUBLIC_SOCKET_DEBUG || 'true') === 'true'

    if (DEBUG) {
        console.log('[socket:init] URL =', url)
    }

    socket = io(url, {
        path: '/socket.io',
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 3000,
        withCredentials: true,
    })

    // ====== LOG lifecycle ======
    socket.on('connect', () => {
        console.log('[socket] connected:', socket.id)
    })
    socket.on('disconnect', (reason) => {
        console.warn('[socket] disconnected:', reason)
    })
    socket.on('connect_error', (err) => {
        console.error('[socket] connect_error:', err?.message || err)
    })
    socket.io.on('reconnect_attempt', (attempt) => {
        console.log('[socket] reconnect_attempt:', attempt)
    })
    socket.io.on('reconnect_error', (err) => {
        console.warn('[socket] reconnect_error:', err?.message || err)
    })
    socket.io.on('reconnect_failed', () => {
        console.error('[socket] reconnect_failed')
    })
    socket.on('error', (err) => {
        console.error('[socket] error:', err)
    })

    // Theo dõi visibility để chủ động reconnect
    if (typeof window !== 'undefined') {
        const onVis = () => {
            if (document.visibilityState === 'visible') {
                console.log('[socket] page visible -> ensure connected; current:', socket.connected)
                if (!socket.connected) socket.connect()
            }
        }
        document.addEventListener('visibilitychange', onVis)
        // cleanup khi Next.js hot-reload
        socket.once('disconnect', () => {
            document.removeEventListener('visibilitychange', onVis)
        })
    }

    return socket
}

export function disconnectSocket() {
    if (socket) {
        console.log('[socket] manual disconnect')
        socket.disconnect()
    }
    socket = null
}
