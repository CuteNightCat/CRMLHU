// emit-to-all.js
// Server Action tiện để bắn broadcast từ web-app tới Socket server (nếu cần).
'use server'

export async function emitToAll(event, payload) {
    const url = process.env.INTERNAL_REALTIME_API_URL
    const key = process.env.ADMIN_API_KEY

    console.log('[emitToAll] POST', url, 'event=', event, 'hasKey=', Boolean(key))
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(key ? { 'x-api-key': key } : {}),
        },
        body: JSON.stringify({ event, payload }),
    })

    if (!res.ok) {
        const text = await res.text()
        console.error('[emitToAll] failed:', res.status, text)
        throw new Error(`Emit failed: ${res.status} ${text}`)
    }

    console.log('[emitToAll] OK')
}
