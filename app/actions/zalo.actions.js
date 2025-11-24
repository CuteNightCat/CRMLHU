
'use server';

import { google } from 'googleapis';
import connectDB from '@/config/connectDB';
import ZaloAccount from '@/models/zalo.model';
import checkAuthToken from '@/utils/checktoken';
import { reloadUser, reloadZalo } from '@/data/actions/reload';
import User from '@/models/users';

// const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1Opsmg0IrV4OQBCMJXHzUjapEv2PGcuVgNezAOcDqbvcFeerngklkpmuN_vfyXuFbWA/exec';
// appscript để thêm tài khoản zalo vào google sheet giúp chuẩn hóa token
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby3DzdhN7xRQrcAvwfOilqW3-pTFngf1vDjhhPmYmDGYxQlq5RBupg_cNctJEwKqRBo1w/exec';

const SPREADSHEET_ID = '1aZ6w7ZwuqQdg8j2JsIFMmGjimmJN0HQJ8sshNy0O2vY';
const TARGET_SHEET = 'Account';

async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

export async function addZaloAccountAction(previousState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }

    const token = formData.get('token');
    if (!token || typeof token !== 'string') { return { status: false, message: 'Token không hợp lệ hoặc không được cung cấp.' }; }
    try {
        const scriptResponse = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ token }),
            cache: 'no-store',
        })
        const accountData = await scriptResponse.json();
        console.log('accountData', accountData);
        if (!scriptResponse.ok || accountData.error) {
            console.error('Google Apps Script Error:', accountData);
            return { status: false, message: 'Lỗi khi xác thực token với Google Apps Script ở zalo appscript.' };
        }
        const newRowForSheet = [
            accountData.phone || '',
            accountData.userId || '',
            accountData.name || '',
            accountData.avatar || '',
            accountData.token || '',
        ];
        const dataForMongo = {
            uid: accountData.userId,
            name: accountData.name,
            phone: accountData.phone,
            avt: accountData.avatar,
        };
        await connectDB();
        const sheets = await getGoogleSheetsClient();
        await Promise.all([
            sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${TARGET_SHEET}!A1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [newRowForSheet],
                },
            }),
            ZaloAccount.findOneAndUpdate(
                { uid: dataForMongo.uid },
                dataForMongo,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            )
        ]);
        reloadZalo();
        return { status: true, message: 'Thêm tài khoản thành công!' };
    } catch (error) {
        console.error('Add Zalo Account Action Error:', error);
        return { status: false, message: 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.' };
    }
}

export async function selectZaloAccountAction(previousState, formData) {
    try {
        const user = await checkAuthToken();
        if (!user || !user.id) {
            return { status: false, message: 'Xác thực không thành công.' };
        }
        const roleList = Array.isArray(user.role) ? user.role : [user.role];
        if (!roleList.some((role) => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
            return { status: false, message: 'Bạn không có quyền thực hiện chức năng này.' };
        }

        const zaloAccountId = formData.get('zaloAccountId');
        await connectDB();

        // Trường hợp 1: Thoát/Bỏ chọn tài khoản (ID rỗng)
        if (!zaloAccountId) {
            await User.findByIdAndUpdate(user.id, { $set: { zalo: null } });
            reloadUser(user.id);
            return { status: true, message: 'Đã hủy chọn tài khoản Zalo.' };
        }

        // Trường hợp 2: Chọn tài khoản mới (ID hợp lệ)
        if (zaloAccountId.length !== 24) {
            return { status: false, message: 'ID tài khoản Zalo không hợp lệ.' };
        }

        const accountToSelect = await ZaloAccount.findById(zaloAccountId);
        if (!accountToSelect) {
            return { status: false, message: 'Không tìm thấy tài khoản Zalo này.' };
        }

        await User.findByIdAndUpdate(user.id, { $set: { zalo: zaloAccountId } });
        reloadUser(user.id);
        return { status: true, message: `Đã chọn tài khoản ${accountToSelect.name}.` };

    } catch (error) {
        console.error('Select Zalo Account Error:', error);
        return { status: false, message: 'Đã xảy ra lỗi không xác định.' };
    }
}

export async function updateZaloRolesAction(previousState, formData) {
    // 1. Xác thực và kiểm tra quyền người dùng
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    }
    // Chỉ Admin mới có quyền phân quyền
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này.', status: false };
    }

    try {
        // 2. Lấy và kiểm tra dữ liệu từ form
        const zaloAccountId = formData.get('zaloAccountId');
        const userIdsJSON = formData.get('userIds');

        if (!zaloAccountId || !userIdsJSON) {
            return { message: 'Dữ liệu không hợp lệ.', status: false };
        }

        let userIds;
        try {
            userIds = JSON.parse(userIdsJSON);
            if (!Array.isArray(userIds)) throw new Error();
        } catch (e) {
            return { message: 'Định dạng danh sách người dùng không chính xác.', status: false };
        }

        // 3. Kết nối DB và cập nhật
        await connectDB();

        const updatedAccount = await ZaloAccount.findByIdAndUpdate(
            zaloAccountId,
            { $set: { roles: userIds } },
            { new: true } // Trả về document sau khi đã cập nhật
        );
        if (!updatedAccount) {
            return { message: 'Không tìm thấy tài khoản Zalo để cập nhật.', status: false };
        }
        reloadZalo();
        return { status: true, message: `Cập nhật quyền cho tài khoản ${updatedAccount.name} thành công!` };
    } catch (error) {
        console.error('Update Zalo Roles Action Error:', error);
        return { status: false, message: 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.' };
    }
}

export async function deleteZaloAccountAction(previousState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }

    const zaloAccountId = formData.get('zaloAccountId');
    if (!zaloAccountId) {
        return { status: false, message: 'Thiếu ID tài khoản Zalo để xóa.' };
    }

    try {
        await connectDB();
        const zaloAccount = await ZaloAccount.findById(zaloAccountId);
        if (!zaloAccount) {
            return { status: false, message: 'Không tìm thấy tài khoản Zalo để xóa.' };
        }

        // Xóa khỏi Google Sheets
        const sheets = await getGoogleSheetsClient();
        
        // Lấy metadata của spreadsheet để tìm sheetId
        const spreadsheetMetadata = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });
        
        const targetSheet = spreadsheetMetadata.data.sheets?.find(
            sheet => sheet.properties.title === TARGET_SHEET
        );
        
        if (targetSheet) {
            const sheetId = targetSheet.properties.sheetId;
            const sheetData = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${TARGET_SHEET}!A:E`,
            });
            
            const rows = sheetData.data.values || [];
            const rowIndex = rows.findIndex(row => row[4] === zaloAccount.uid);
            
            if (rowIndex !== -1) {
                // Xóa hàng (rowIndex + 1 vì Google Sheets bắt đầu từ 1)
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: 'ROWS',
                                    startIndex: rowIndex + 1,
                                    endIndex: rowIndex + 2
                                }
                            }
                        }]
                    }
                });
            }
        }

        // Xóa khỏi MongoDB
        await ZaloAccount.findByIdAndDelete(zaloAccountId);

        // Xóa khỏi User nếu có người dùng đang sử dụng tài khoản này
        await User.updateMany(
            { zalo: zaloAccountId },
            { $set: { zalo: null } }
        );

        reloadZalo();
        return { status: true, message: `Đã xóa tài khoản ${zaloAccount.name} thành công!` };
    } catch (error) {
        console.error('Delete Zalo Account Action Error:', error);
        return { status: false, message: 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.' };
    }
}