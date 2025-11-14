import Form from '@/models/formclient'
import '@/models/users'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataForm(id) {
    try {
        await connectDB()
        const aggregationPipeline = [
            { $sort: { createdAt: -1 } },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: 'source',
                    as: 'customers'
                }
            },
            {
                $addFields: {
                    customerCount: { $size: '$customers' },
                    customerTimes: {
                        $map: { input: '$customers', as: 'customer', in: '$$customer.createAt' }
                    }
                }
            },
            { $project: { customers: 0 } }
        ]
        let forms;
        if (id) {
            forms = await Form.findById(id).lean()
        } else {
            forms = await Form.aggregate(aggregationPipeline)
            await Form.populate(forms, { path: 'createdBy', select: 'name' })
        }
        return JSON.parse(JSON.stringify(forms))
    } catch (error) {
        console.error('Lỗi trong dataForm:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}

export async function getFormAll() {
    try {
        const cachedFunction = cacheData(() => dataForm(), ['forms'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong getFormAll:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}

export async function getFormOne(id) {
    try {
        const cachedFunction = cacheData(() => dataForm(id), ['forms', id])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong getFormOne:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}
