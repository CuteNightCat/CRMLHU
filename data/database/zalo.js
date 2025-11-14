import Zalo from '@/models/zalo.model'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataZalo(_id) {
    try {
        await connectDB()
        const query = _id ? { _id } : {}
        const zalo = await Zalo.find(query)
        if (_id && zalo.length === 0) return null
        return JSON.parse(JSON.stringify(zalo))
    } catch (error) {
        console.error('Lỗi trong dataZalo:', error)
        throw new Error('Không thể lấy dữ liệu Zalo.')
    }
}

export async function getZaloAll() {
    try {
        const cachedFunction = cacheData(() => dataZalo(), ['zalo'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong ZaloAll:', error)
        return null
    }
}

export async function getZaloOne(_id) {
    try {
        const cachedFunction = cacheData(() => dataZalo({ _id }), [`zalo:${_id}`])
        return cachedFunction()
    } catch (error) {
        console.error('Lỗi trong ZaloOne:', error)
        return null
    }
}

