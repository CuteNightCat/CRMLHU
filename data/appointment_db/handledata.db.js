// data/db/appointment.db.js

import Appointment from '@/models/appointment.model'
import Customer from '@/models/customer.model'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'
import mongoose from 'mongoose'

/**
 * Hàm gốc để truy vấn dữ liệu lịch hẹn, chưa có cache.
 * @param {object} params - Các tham số truy vấn.
 * @returns {Promise<Array|object>}
 */
export async function dataAppointment(params = {}) {
    try {
        await connectDB()
        const matchStage = {};

        // Lọc theo ID khách hàng
        if (params.customerId) {
            matchStage.customer = new mongoose.Types.ObjectId(params.customerId);
        }
        // Lọc theo người tạo
        if (params.createdBy) {
            matchStage.createdBy = new mongoose.Types.ObjectId(params.createdBy);
        }
        // Lọc theo trạng thái
        if (params.status) {
            matchStage.status = params.status;
        }
        // Lọc theo khoảng thời gian
        if (params.dateRange && params.dateRange.start && params.dateRange.end) {
            matchStage.appointmentDate = {
                $gte: new Date(params.dateRange.start),
                $lte: new Date(params.dateRange.end)
            };
        }
        // Nếu không có dateRange nhưng có year và month, lọc theo tháng cụ thể
        else if (params.year && params.month) {
            const monthIndex = params.month - 1;
            const startDate = new Date(params.year, monthIndex, 1);
            const endDate = new Date(params.year, monthIndex + 1, 0, 23, 59, 59);
            matchStage.appointmentDate = { $gte: startDate, $lte: endDate };
        }

        const aggregationPipeline = [
            { $match: matchStage },
            { $sort: { appointmentDate: -1 } },
            // Populate thông tin Customer
            {
                $lookup: {
                    from: 'customers',
                    localField: 'customer',
                    foreignField: '_id',
                    as: 'customerInfo'
                }
            },
            // Populate thông tin User (người tạo)
            {
                $lookup: {
                    from: 'users',
                    localField: 'createdBy',
                    foreignField: '_id',
                    as: 'creatorInfo'
                }
            },
            // CẬP NHẬT: Populate thông tin Service
            {
                $lookup: {
                    from: 'services', // Tên collection của Service model
                    localField: 'service',
                    foreignField: '_id',
                    as: 'serviceInfo'
                }
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'customerInfo.tags',
                    foreignField: '_id',
                    as: 'interestedServicesInfo'
                }
            },
            { $addFields: { originalCustomerId: '$customer' } },
            // Dùng $unwind để chuyển array thành object
            { $unwind: { path: "$customerInfo", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$creatorInfo", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$serviceInfo", preserveNullAndEmptyArrays: true } }, // CẬP NHẬT
            // Chọn lọc và đổi tên field
            {
                $project: {
                    appointmentDate: 1,
                    notes: 1,
                    status: 1,
                    createdAt: 1,
                    appointmentType: 1,
                    treatmentCourse: 1, // THÊM MỚI
                    customerId: "$originalCustomerId",
                    customer: { _id: "$customerInfo._id", name: "$customerInfo.name", phone: "$customerInfo.phone" },
                    createdBy: { _id: "$creatorInfo._id", name: "$creatorInfo.name", group: "$creatorInfo.group" },
                    // CẬP NHẬT: Thêm thông tin ngành học
                    service: { _id: "$serviceInfo._id", name: "$serviceInfo.name" },
                    interestedServices: "$interestedServicesInfo.name",
                }
            }
        ];

        const appointments = await Appointment.aggregate(aggregationPipeline);

        if (appointments.length > 0) {
            const missingCustomerIds = [
                ...new Set(
                    appointments
                        .filter(app => (!app.customer || !app.customer.name) && app.customerId)
                        .map(app => String(app.customerId))
                )
            ];

            if (missingCustomerIds.length > 0) {
                const customers = await Customer.find({ _id: { $in: missingCustomerIds } })
                    .select('name phone tags')
                    .lean();
                const customerMap = new Map(customers.map(c => [String(c._id), c]));

                appointments.forEach(app => {
                    const key = app.customerId ? String(app.customerId) : null;
                    if (key && (!app.customer || !app.customer.name)) {
                        const info = customerMap.get(key);
                        if (info) {
                            app.customer = {
                                _id: info._id,
                                name: info.name,
                                phone: info.phone,
                                interestedServices: Array.isArray(info.tags) ? info.tags : []
                            };
                        }
                    }
                    delete app.customerId;
                    if (!app.interestedServices || app.interestedServices.length === 0) {
                        app.interestedServices = Array.isArray(app.customer?.interestedServices) ? app.customer.interestedServices : [];
                    }
                });
            } else {
                appointments.forEach(app => {
                    delete app.customerId;
                    if (!app.interestedServices || app.interestedServices.length === 0) {
                        app.interestedServices = Array.isArray(app.customer?.interestedServices) ? app.customer.interestedServices : [];
                    }
                });
            }
        }

        return JSON.parse(JSON.stringify(appointments));
    } catch (error) {
        console.error('Lỗi trong dataAppointment:', error);
        throw new Error('Không thể lấy dữ liệu lịch hẹn.');
    }
}

export async function dataAppointments() {
    try {
        await connectDB()
        // CẬP NHẬT: populate thêm 'service'
        let appointments = await Appointment.find({})
            .populate('customer', 'name phone')
            .populate('createdBy', 'name group')
            .populate('service', 'name') // Thêm populate cho service
            .sort({ appointmentDate: -1 })
            .lean();
        return JSON.parse(JSON.stringify(appointments));
    } catch (error) {
        console.error('Lỗi trong dataAppointments:', error);
        throw new Error('Không thể lấy dữ liệu lịch hẹn.');
    }
}


/**
 * Lấy danh sách lịch hẹn của một khách hàng (có cache).
 * @param {string} customerId - ID của khách hàng
 * @returns {Promise<Array>}
 */
export async function getAppointmentsByCustomer(customerId) {
    try {
        const cachedFunction = cacheData(
            () => dataAppointment({ customerId }),
            ['appointments', customerId]
        );
        return await cachedFunction();
    } catch (error) {
        console.error('Lỗi trong getAppointmentsByCustomer:', error);
        throw new Error('Không thể lấy dữ liệu lịch hẹn theo khách hàng.');
    }
}

/**
 * Lấy danh sách tất cả lịch hẹn trong một tháng cụ thể (có cache).
 * @param {number} year - Năm
 * @param {number} month - Tháng (1-12)
 * @returns {Promise<Array>}
 */
export async function getAppointmentsByMonth(year, month) {
    try {
        const cacheKey = `${year}-${month}`;
        const cachedFunction = cacheData(
            () => dataAppointment({ year, month }),
            ['appointments', cacheKey]
        );
        return await cachedFunction();
    } catch (error) {
        console.error('Lỗi trong getAppointmentsByMonth:', error);
        throw new Error('Không thể lấy dữ liệu lịch hẹn theo tháng.');
    }
}