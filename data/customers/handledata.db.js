import Customer from '@/models/customer.model'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'
import '@/models/formclient'

/**
 * Hàm gốc để truy vấn tất cả dữ liệu khách hàng, chưa có cache.
 * KHÔNG export ra ngoài.
 */
async function dataCustomer() {
    try {
        await connectDB();

        const customers = await Customer.find({})
            .populate({ path: 'source', select: 'name' })
            .populate({ path: 'roles', select: 'name avt' })
            // ==== Populate đầy đủ các tham chiếu trong serviceDetails (mảng) ====
            .populate([
                { path: 'serviceDetails.selectedService', select: 'name code price' },
                { path: 'serviceDetails.approvedBy', select: 'name avt' },
                { path: 'serviceDetails.payments.receivedBy', select: 'name avt' },
                { path: 'serviceDetails.commissions.user', select: 'name avt' },
                { path: 'serviceDetails.costs.createdBy', select: 'name avt' },
            ])
            .sort({ createAt: -1 })
            .lean();

        // Trả về bản sao JSON-safe
        return JSON.parse(JSON.stringify(customers));
    } catch (error) {
        console.error('Lỗi trong dataCustomer:', error);
        throw new Error('Không thể lấy dữ liệu khách hàng.');
    }
}

/**
 * Lấy danh sách TẤT CẢ khách hàng (có cache).
 */
export async function getCustomersAll() {
    try {
        const cachedFunction = cacheData(() => dataCustomer(), ['customers']);
        return await cachedFunction();
    } catch (error) {
        console.error('Lỗi trong getCustomersAll:', error);
        throw new Error('Không thể lấy danh sách tất cả khách hàng.');
    }
}
