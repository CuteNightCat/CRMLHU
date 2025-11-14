import User from '@/models/users'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataUser(_id) {
    try {
        await connectDB()
        let query = _id ? { _id } : {}
        let data = {}
        if (_id) {
            data = await User.find(query).populate({
                path: 'zalo',
                select: 'name _id phone avt action',
                populate: {
                    path: 'action',
                    populate: [
                        {
                            path: 'zaloAccount',
                            select: 'name _id phone avt',
                        },
                        {
                            path: 'createdBy',
                            select: 'name _id phone avt',
                        },
                    ],
                }
            }).lean();
        } else {
            data = await User.find({
                ...query,
                uid: { $exists: true, $ne: null }
            }, { uid: 0 }).lean().exec();
        }
        return JSON.parse(JSON.stringify(data))
    } catch (error) {
        console.error('Lỗi trong dataUser:', error)
        throw new Error('Không thể lấy dữ liệu người dùng.')
    }
}

export async function getUserAll() {
    try {
        const cachedFunction = cacheData(() => dataUser(), ['users'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong UserAll:', error)
        return null
    }
}

export async function getUserOne(_id) {
    try {
        const cachedFunction = cacheData(() => dataUser(_id), [`user:${_id}`])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong UserAll:', error)
        return null
    }
}

