import { NextResponse } from 'next/server';
import connectDB from '@/config/connectDB';
import Customer from '@/models/customer.model';
import { revalidateData } from '@/app/actions/customer.actions';
import autoAssignForCustomer from '@/utils/autoAssign';
import mongoose from 'mongoose';

// Chuẩn hóa số điện thoại Việt Nam
function normalizeVNPhone(digits) {
    if (typeof digits !== 'string') return null;
    
    // Loại bỏ tất cả ký tự không phải số và dấu +
    const cleaned = digits.replace(/[^\d+]/g, '');
    
    // Xử lý các trường hợp:
    // +84xxxxxxxxx -> 0xxxxxxxxx
    // 84xxxxxxxxx -> 0xxxxxxxxx  
    // 0xxxxxxxxx -> 0xxxxxxxxx (giữ nguyên)
    if (cleaned.startsWith('+84')) {
        const phone = '0' + cleaned.substring(3);
        return phone.length === 10 ? phone : null;
    } else if (cleaned.startsWith('84') && cleaned.length === 11) {
        return '0' + cleaned.substring(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
        return cleaned;
    }
    
    return null;
}

// Trích xuất số điện thoại từ văn bản
function extractPhones(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const out = new Set();
    
    // Regex linh hoạt để bắt các SĐT có thể có dấu cách, chấm, gạch ngang
    const pattern = /(?:\+?84|0)[\s.\-_]*(?:\d[\s.\-_]*){8,10}\d/g;
    const matches = text.match(pattern) || [];

    for (const raw of matches) {
        const onlyDigits = raw.replace(/[^\d+]/g, '');
        const normalized = normalizeVNPhone(onlyDigits);
        if (normalized) out.add(normalized);
    }
    return [...out];
}

// Source ID mặc định cho "Nhắn tin" (tương tự như trong /api/mes/route.js)
const DEFAULT_SOURCE_ID = '68b5ebb3658a1123798c0ce4';

// Chuyển đổi platform code sang tên hiển thị
function formatPlatformName(platform) {
    const platformMap = {
        'facebook': 'Facebook',
        'instagram_official': 'Instagram',
        'tiktok_business_messaging': 'TikTok',
        'personal_zalo': 'Zalo'
    };
    return platformMap[platform] || platform || 'Facebook';
}

// Tạo sourceDetails theo format: "Tin nhắn - {Platform} - {Page Name}"
function formatSourceDetails(platform, pageName) {
    const platformName = formatPlatformName(platform);
    return `Tin nhắn - ${platformName} - ${pageName || 'Page'}`;
}

export async function POST(req) {
    try {
        await connectDB();
        
        const { customerName, messageContent, conversationId, platform, pageName } = await req.json();
        
        if (!customerName || !messageContent) {
            return NextResponse.json(
                { success: false, message: 'Thiếu thông tin bắt buộc' },
                { status: 400 }
            );
        }

        // Trích xuất số điện thoại từ nội dung tin nhắn
        const detectedPhones = extractPhones(messageContent);
        
        if (detectedPhones.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Không tìm thấy số điện thoại trong tin nhắn' },
                { status: 400 }
            );
        }

        const phoneToRegister = detectedPhones[0]; // Lấy số đầu tiên

        // Kiểm tra xem số điện thoại đã tồn tại chưa
        const existingCustomer = await Customer.findOne({ phone: phoneToRegister });
        
        if (existingCustomer) {
            return NextResponse.json(
                { 
                    success: false, 
                    message: 'Số điện thoại đã tồn tại trong hệ thống',
                    customerId: existingCustomer._id,
                    phone: phoneToRegister
                },
                { status: 409 }
            );
        }

        // Tạo sourceDetails chi tiết với thông tin platform và page name
        const sourceDetails = formatSourceDetails(platform, pageName);

        // Tạo khách hàng mới
        const newCustomerData = {
            name: customerName,
            phone: phoneToRegister,
            email: '',
            area: '',
            source: new mongoose.Types.ObjectId(DEFAULT_SOURCE_ID),
            sourceDetails: sourceDetails,
            pipelineStatus: ['new_unconfirmed_1'],
            care: [{
                content: 'Khách hàng được tạo tự động từ tin nhắn có chứa số điện thoại',
                step: 1,
                createBy: null, // Có thể set user ID nếu có
                createAt: new Date()
            }],
            createAt: new Date()
        };

        const newCustomer = new Customer(newCustomerData);
        await newCustomer.save();
        
        // Gán tự động nhân sự phụ trách cho nhóm Telesale
        try {
            await autoAssignForCustomer(newCustomer._id, { targetGroup: 'telesale' });
        } catch (e) {
            console.error('[Auto Customer] Lỗi khi gán nhân sự:', e?.message || e);
            // Tiếp tục dù có lỗi gán
        }
        
        // Revalidate data để cập nhật UI
        revalidateData();

        console.log(`[Auto Customer] Đã tạo khách hàng mới: ${newCustomer._id} với SĐT: ${phoneToRegister}`);

        return NextResponse.json({
            success: true,
            message: 'Tạo khách hàng thành công',
            customerId: newCustomer._id,
            phone: phoneToRegister,
            customerName: customerName
        });

    } catch (error) {
        console.error('[Auto Customer] Lỗi khi tạo khách hàng:', error);
        return NextResponse.json(
            { success: false, message: 'Lỗi hệ thống khi tạo khách hàng' },
            { status: 500 }
        );
    }
}
