// app/api/import-sheet/route.js

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import mongoose from 'mongoose'; // Vẫn cần mongoose để dùng mongoose.Types.ObjectId

// 🚨 Thay thế bằng đường dẫn thực tế trong project của bạn
import connectDB from '@/config/connectDB';
import Cus from '@/models/customer.model';
// Cus là model Customer đã được export từ file models/customer.model.js

// =================================================================
// ⚙️ [KHAI BÁO CẤU HÌNH CỐ ĐỊNH]
// =================================================================

const SHEET_ID = '1QOHqG1wvV-oDoPAxSDw37hfP0AHctPYpHxyJlHenZJY';
const SOURCE_ID = '68e70a88e178c4646ddf9298';

// =================================================================
// 🛠️ [HÀM KẾT NỐI GOOGLE SHEETS]
// =================================================================

/**
 * Lấy Google Sheets Client
 */
async function getSheetsClient() {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    const { GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
        console.error('GOOGLE_CLIENT_EMAIL hoặc GOOGLE_PRIVATE_KEY bị thiếu!');
        throw new Error('Thiếu cấu hình Google Service Account.');
    }

    let auth;
    try {
        auth = new google.auth.GoogleAuth({
            projectId: GOOGLE_PROJECT_ID,
            credentials: {
                client_email: GOOGLE_CLIENT_EMAIL,
                // Thay thế \n đã escape thành ký tự xuống dòng thực tế
                private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: scopes,
        });
    } catch (err) {
        console.error('[sheets] GoogleAuth error:', err?.message, err);
        throw err;
    }

    let sheets;
    try {
        sheets = google.sheets({ version: 'v4', auth });
    } catch (err) {
        console.error('[sheets] google.sheets init error:', err?.message, err);
        throw err;
    }
    return sheets;
}

// =================================================================
// 🚀 [HÀM XỬ LÝ GET]
// =================================================================

/**
 * Xử lý yêu cầu GET để import dữ liệu từ Google Sheet.
 */
export async function GET(request) {
    console.log('--- Bắt đầu Import Google Sheet ---');

    try {
        // 1. Kết nối MongoDB (Sử dụng hàm đã import)
        await connectDB();

        // 2. Lấy Sheets Client và Dữ liệu
        const sheets = await getSheetsClient();
        // Lấy từ dòng 2, cột A đến E
        const range = 'Data!A2:E';

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return NextResponse.json({ message: 'No data found in Google Sheet.', count: 0 }, { status: 200 });
        }

        console.log(`Tìm thấy ${rows.length} dòng dữ liệu.`);

        // 3. Xử lý và Chuẩn bị Bulk Write
        const bulkOps = [];
        let skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowIndex = i + 2;

            // A: row[0], B: row[1], C: row[2], E: row[4]
            const colA = (row[0] || '').trim();
            const colB_name = (row[1] || '').trim(); // Name
            const colC_phone = (row[2] || '').trim(); // Phone
            const colE_dob = (row[4] || '').trim(); // Ngày sinh

            // 3.1. Lọc lần 1: Có đủ A, B, C (cột 0, 1, 2)
            if (!colA || !colB_name || !colC_phone) {
                skippedCount++;
                console.log(`Dòng ${rowIndex} bị bỏ qua: Thiếu dữ liệu ở cột A, B hoặc C.`);
                continue;
            }

            // 3.2. Xử lý Phone
            let phone = colC_phone.replace(/\D/g, '');
            if (phone.startsWith('84')) {
                phone = '0' + phone.substring(2);
            }
            // Kiểm tra SĐT hợp lệ
            if (!/^0\d{9}$/.test(phone)) {
                console.warn(`Dòng ${rowIndex} bị bỏ qua: Số điện thoại không hợp lệ sau khi chuẩn hóa: ${colC_phone} -> ${phone}.`);
                skippedCount++;
                continue;
            }

            // 3.3. Xử lý Ngày sinh (Cột E) - Nếu đủ ngày tháng năm
            let dob = null;
            if (colE_dob) {
                const dateParts = colE_dob.split(/[\/\-]/);
                if (dateParts.length === 3) {
                    // Giả định DD/MM/YYYY
                    const [day, month, year] = dateParts.map(p => parseInt(p, 10));
                    const dateObj = new Date(year, month - 1, day);

                    // Kiểm tra tính hợp lệ của ngày tháng năm
                    if (dateObj.getFullYear() === year && dateObj.getMonth() === month - 1 && dateObj.getDate() === day) {
                        dob = dateObj;
                    }
                }
            }


            // 3.4. Chuẩn bị dữ liệu và Bulk Write Operation
            const customerData = {
                name: colB_name,
                phone: phone,
                // Chuyển string ID sang ObjectId
                source: new mongoose.Types.ObjectId(SOURCE_ID),
                // Thêm dob nếu nó không null (nghĩa là đủ ngày tháng năm hợp lệ)
                ...(dob && { dob: dob }),
            };

            bulkOps.push({
                updateOne: {
                    filter: { phone: phone },
                    update: { $set: customerData },
                    upsert: true, // Nếu SĐT chưa tồn tại thì tạo mới
                }
            });
        }

        // 4. Thực hiện Bulk Write
        let successCount = 0;
        if (bulkOps.length > 0) {
            console.log(`Thực hiện Bulk Write cho ${bulkOps.length} bản ghi...`);
            const bulkWriteResult = await Cus.bulkWrite(bulkOps);
            successCount = bulkWriteResult.upsertedCount + bulkWriteResult.modifiedCount;
        }

        return NextResponse.json({
            message: 'Import from Google Sheet completed.',
            totalRows: rows.length,
            processedCount: bulkOps.length,
            successCount: successCount,
            skippedCount: skippedCount,
        }, { status: 200 });

    } catch (error) {
        console.error('LỖI import Google Sheet:', error);

        return NextResponse.json({
            message: 'Error during Google Sheet import.',
            error: error.message,
            detail: error.response?.data?.error || null,
        }, { status: 500 });
    }
}