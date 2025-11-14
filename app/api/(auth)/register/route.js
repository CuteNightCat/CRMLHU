// File: /api/register/route.js

import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import connectDB from '@/config/connectDB';
import PostUser from '@/models/users'; // Đảm bảo bạn import đúng model users
import { reloadUser } from '@/data/actions/reload';
import checkAuthToken from '@/utils/checktoken';

export async function POST(req) {
    const user = await checkAuthToken();
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some(role => ['Admin', 'Manager', 'Admin Sale'].includes(role))) {
        return jsonRes(403, { error: 'Bạn không có quyền thực hiện hành động này' });
    }

    try {
        await connectDB();
        const {
            name,
            address = '',
            avt = '',
            role = ["Telesale"],
            phone = '',
            email,
            password,
            group // MỚI: Nhận trường 'group' từ request
        } = await req.json();

        // CẬP NHẬT: Thêm 'group' vào điều kiện bắt buộc
        if (!email || !password || !group) {
            return jsonRes(400, { error: 'Email, mật khẩu và nhóm là bắt buộc' });
        }

        // CẬP NHẬT: Kiểm tra giá trị của group có hợp lệ không
        if (!['telesale', 'care'].includes(group)) {
            return jsonRes(400, { error: 'Giá trị của nhóm không hợp lệ.' });
        }

        const exists = await PostUser.exists({ email });
        if (exists) {
            return jsonRes(409, { error: 'Email đã tồn tại' });
        }

        const hash = await bcrypt.hash(password, 10);

        // CẬP NHẬT: Thêm 'group' khi tạo user mới
        await PostUser.create({
            name,
            address,
            avt,
            role,
            phone,
            email,
            uid: hash,
            group // MỚI
        });
        reloadUser()
        return jsonRes(201, { message: 'Tạo tài khoản thành công' });
    } catch (err) {
        console.error(err);
        return jsonRes(500, { error: 'Lỗi máy chủ' });
    }
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
}
function jsonRes(status, body) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
}