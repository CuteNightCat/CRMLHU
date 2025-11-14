'use server'

import { getAppointmentsByCustomer, getAppointmentsByMonth, dataAppointments } from './handledata.db'
import { revalidateTag } from 'next/cache'

/**
 * Hàm tổng hợp để lấy dữ liệu lịch hẹn.
 * Sẽ tự động gọi hàm tương ứng dựa vào tham số đầu vào.
 * @param {object} params - Tham số truy vấn
 * @param {string} [params.customerId] - Lấy theo ID khách hàng.
 * @param {string} [params.createdBy] - Lấy theo ID người tạo.
 * @param {string} [params.status] - Lấy theo trạng thái.
 * @param {object} [params.dateRange] - Khoảng thời gian để lọc.
 * @param {Date} [params.dateRange.start] - Thời gian bắt đầu.
 * @param {Date} [params.dateRange.end] - Thời gian kết thúc.
 * @param {number} [params.year] - Lấy theo năm (phải đi kèm tháng).
 * @param {number} [params.month] - Lấy theo tháng (phải đi kèm năm).
 * @returns {Promise<Array>}
 */
export async function appointment_data(params = {}) {
    // Nếu chỉ có customerId và không có bất kỳ tham số nào khác, sử dụng hàm chuyên biệt
    if (params.customerId && !params.createdBy && !params.status && !params.dateRange && !params.year && !params.month) {
        return await getAppointmentsByCustomer(params.customerId);
    }
    
    // Nếu chỉ có year và month và không có tham số nào khác, sử dụng hàm chuyên biệt
    if (params.year && params.month && !params.customerId && !params.createdBy && !params.status && !params.dateRange) {
        return await getAppointmentsByMonth(params.year, params.month);
    }
    
    // Trường hợp còn lại, sử dụng hàm truy vấn chung với tất cả tham số
    const { dataAppointment } = await import('./handledata.db');
    return await dataAppointment(params);
}

export async function appointment_data_all() {
    return await dataAppointments();
}

/**
 * Xóa cache cho tất cả các truy vấn lịch hẹn.
 * Gọi hàm này sau khi thêm, sửa, hoặc xóa một lịch hẹn.
 */
export async function reloadAppointments() {
    revalidateTag('appointments');
}