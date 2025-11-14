'use server'

import { getAreaOne, getAreaAll } from '@/data/database/area'
import { getUserAll, getUserOne } from '@/data/database/user'
import { getLabelAll } from '../database/label'
import { getFormAll } from '../database/form'
import { getZaloAll, getZaloOne } from '../database/zalo'
import Logs from '@/models/log.model'
import Customer from '@/models/customer.model'
import Zalo from '@/models/zalo.model'
import connectDB from '@/config/connectDB'
import mongoose from "mongoose";

export async function area_data(_id) {
    let data = _id ? await getAreaOne(_id) : await getAreaAll()
    return _id && data ? data[0] || null : data || null
}

// Lấy tài khoản zalo
export async function zalo_data(_id) {
    let data = _id ? await getZaloOne(_id) : await getZaloAll()
    return data || null
}
// lấy thông tin user
export async function user_data({ _id = null }) {
    if (_id) {
        return await getUserOne(_id)
    } else {
        return await getUserAll()
    }
}
// lấy nhãn
export async function label_data() {
    return await getLabelAll()
}
// lấy nguồn
export async function form_data() {
    return await getFormAll()
}
// Lịch sử chăm sóc

export async function history_data(id, type) {
    try {
        await connectDB();

        // Tạo filter
        const filter = {};

        // Nếu có id thì lọc theo customer
        if (id) {
            if (!mongoose.isValidObjectId(id)) {
                return { success: false, error: "customer id không hợp lệ." };
            }
            filter.customer = new mongoose.Types.ObjectId(id);
        }

        // Nếu có type thì lọc thêm
        if (type) {
            filter.type = type;
        }

        // Tính hạn mức từ tất cả tài khoản Zalo
        const zaloAccounts = await Zalo.find({}).lean();
        const zaloLimits = {
            hourly: zaloAccounts.reduce(
                (sum, acc) => sum + (acc.rateLimit?.hourly ?? acc.rateLimitPerHour ?? 0),
                0
            ),
            daily: zaloAccounts.reduce(
                (sum, acc) => sum + (acc.rateLimit?.daily ?? acc.rateLimitPerDay ?? 0),
                0
            ),
        };
        // Lấy lịch sử log theo filter
        const history = await Logs.find(filter)
            .populate("zalo", "name avt")
            .populate("createBy", "name")
            .populate('customer', 'name')
            .sort({ createdAt: -1 })
            .lean();
        const plainHistory = JSON.parse(JSON.stringify(history));

        return {
            success: true,
            data: plainHistory,
            zaloLimits,
        };
    } catch (err) {
        console.error("Error getting history:", err);
        return { success: false, error: "Lỗi máy chủ khi lấy lịch sử." };
    }
}

export async function customer_data_all() {
    try {
        await connectDB();
        const customers = await Customer.find({}).lean();
        return JSON.parse(JSON.stringify(customers));
    } catch (err) {
        console.error("Error getting all customers:", err);
        return [];
    }
}