import Area from '@/models/area'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataArea(_id) {
    try {
        await connectDB()
        const query = _id ? { _id } : {}
        const area = await Area.find(query)
        if (_id && area.length === 0) return null
        return JSON.parse(JSON.stringify(area))
    } catch (error) {
        console.error('Lỗi trong dataArea:', error)
        throw new Error('Không thể lấy dữ liệu khu vực.')
    }
}

export async function getAreaAll() {
    try {
        const cachedFunction = cacheData(() => dataArea(), ['areas'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong AreaAll:', error)
        return null
    }
}

export async function getAreaOne(_id) {
    try {
        const cachedFunction = cacheData(() => dataArea({ _id }), [`area:${_id}`])
        return cachedFunction()
    } catch (error) {
        console.error('Lỗi trong AreaOne:', error)
        return null
    }
}

