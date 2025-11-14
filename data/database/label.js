import Label from '@/models/label'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataLabel() {
    try {
        await connectDB()
        const label = await Label.find()
        return JSON.parse(JSON.stringify(label))
    } catch (error) {
        console.error('Lỗi trong dataLabel:', error)
        throw new Error('Không thể lấy dữ liệu khu vực.')
    }
}

export async function getLabelAll() {
    try {
        const cachedFunction = cacheData(() => dataLabel(), ['labels'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong getLabelAll:', error)
        throw new Error('Không thể lấy dữ liệu khu vực.')
    }
}



