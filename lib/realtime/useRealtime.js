'use client'
import { useEffect, useMemo, useState } from 'react'
import { getSocket } from './socket-client'

// Patch siêu gọn cho danh sách hội thoại
function applyPatch(prev, patch) {
    if (!patch || !patch.type) return prev
    if (patch.type === 'replace' && Array.isArray(patch.items)) return patch.items
    if (patch.type === 'upsert' && Array.isArray(patch.items)) {
        const map = new Map(prev.map(c => [c.conversationId, c]))
        for (const it of patch.items) map.set(it.conversationId, { ...(map.get(it.conversationId) || {}), ...it })
        return Array.from(map.values())
    }
    if (patch.type === 'remove' && Array.isArray(patch.ids)) {
        const set = new Set(patch.ids)
        return prev.filter(c => !set.has(c.conversationId))
    }
    return prev
}

export function useRealtime() {
    const [conversations, setConversations] = useState([])
    const [messages, setMessages] = useState([]) // tuỳ chọn: feed tin nhắn

    useEffect(() => {
        const s = getSocket()

        // Nhận toàn bộ danh sách ban đầu (server broadcast 'conv:init')
        const onInit = (data) => {
            if (data && Array.isArray(data.items)) setConversations(data.items)
        }
        // Nhận cập nhật incremental (server broadcast 'conv:patch')
        const onPatch = (patch) => setConversations(prev => applyPatch(prev, patch))
        // Nhận tin nhắn mới (server broadcast 'msg:new')
        const onMsg = (msg) => setMessages(prev => [...prev, msg])

        s.on('conv:init', onInit)
        s.on('conv:patch', onPatch)
        s.on('msg:new', onMsg)

        // (Tuỳ chọn) yêu cầu server gửi dữ liệu ban đầu qua ACK
        s.emit('conv:get', (res) => {
            if (res?.ok && Array.isArray(res.items)) setConversations(res.items)
        })

        return () => {
            s.off('conv:init', onInit)
            s.off('conv:patch', onPatch)
            s.off('msg:new', onMsg)
        }
    }, [])

    return useMemo(() => ({ conversations, messages }), [conversations, messages])
}
