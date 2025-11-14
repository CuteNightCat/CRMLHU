import Form from '@/models/formclient'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'

async function dataForm() {
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
        const forms = await Form.aggregate(aggregationPipeline)
        await Form.populate(forms, { path: 'createdBy', select: 'name' })
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



