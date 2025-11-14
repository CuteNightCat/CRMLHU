'use client'
import { useEffect } from 'react'
import { getSocket } from '@/lib/realtime/socket-client'

export default function RealtimeGate() {
    useEffect(() => {
        getSocket() // kết nối sớm
    }, [])
    return null
}
