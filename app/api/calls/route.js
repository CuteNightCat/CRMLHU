import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/config/connectDB';
import checkAuthToken from '@/utils/checktoken';
import Call from '@/models/call.model';
import Customer from '@/models/customer.model';

// Helper function để upload file lên Google Drive
async function uploadFileToDrive(file, folderId) {
    try {
        // Placeholder - bạn cần implement Google Drive upload
        // Trong thực tế, bạn sẽ sử dụng Google Drive API
        const fileName = file.name;
        const fileId = `temp_file_id_${Date.now()}`;
        
        return {
            id: fileId,
            name: fileName,
            webViewLink: `https://drive.google.com/file/d/${fileId}/view`
        };
    } catch (error) {
        console.error('Upload to Drive error:', error);
        throw new Error('Failed to upload file to Drive');
    }
}

export async function POST(request) {
    try {
        // Kiểm tra authentication
        const session = await checkAuthToken();
        if (!session?.id) {
            return NextResponse.json({ 
                success: false, 
                error: 'Yêu cầu đăng nhập.' 
            }, { status: 401 });
        }

        const formData = await request.formData();
        
        // Lấy dữ liệu từ form
        const customerId = formData.get('customerId');
        const userId = formData.get('userId');
        const crmStatus = formData.get('crmStatus') || '';
        const callStatus = formData.get('callStatus') || '';
        const duration = Number(formData.get('duration') || 0);
        const startTime = formData.get('startTime') ? new Date(formData.get('startTime')) : new Date();
        const sipStatusCode = Number(formData.get('sipStatusCode') || 0);
        const recordingFile = formData.get('recordingFile');
        const recordingFileName = formData.get('recordingFileName') || '';

        // Validation
        if (!customerId || !userId) {
            return NextResponse.json({ 
                success: false, 
                error: 'Thiếu customerId hoặc userId.' 
            }, { status: 400 });
        }

        if (!recordingFile || recordingFile.size === 0) {
            return NextResponse.json({ 
                success: false, 
                error: 'Thiếu file ghi âm cuộc gọi.' 
            }, { status: 400 });
        }

        await connectDB();

        // 1. Upload file lên Google Drive
        const folderId = 'YOUR_GOOGLE_DRIVE_FOLDER_ID'; // Thay bằng folder ID thực tế
        const uploadedFile = await uploadFileToDrive(recordingFile, folderId);
        
        if (!uploadedFile?.id) {
            throw new Error('Tải file ghi âm lên Drive thất bại.');
        }

        // 2. Map SIP status code to call status
        let finalCallStatus = callStatus;
        if (!finalCallStatus) {
            if (duration > 0) {
                finalCallStatus = 'completed';
            } else {
                const code = sipStatusCode;
                if (code === 486) finalCallStatus = 'busy';
                else if (code === 603) finalCallStatus = 'rejected';
                else if (code === 480 || code === 408) finalCallStatus = 'no_answer';
                else if (code === 487) finalCallStatus = 'missed';
                else finalCallStatus = 'failed';
            }
        }

        // 3. Tạo Call record
        const newCall = await Call.create({
            customer: new mongoose.Types.ObjectId(customerId),
            user: new mongoose.Types.ObjectId(userId),
            file: uploadedFile.id,
            createdAt: startTime,
            duration,
            status: finalCallStatus
        });

        // 4. Cập nhật Customer care
        const callTimeStr = startTime.toLocaleString('vi-VN');
        const audioLink = uploadedFile.webViewLink || '';
        const lines = [
            `Cuộc gọi lúc ${callTimeStr}`,
            `• Trạng thái cuộc gọi: ${finalCallStatus}`,
            `• Thời lượng: ${duration}s`,
            `• Ghi âm: ${audioLink || `fileId=${uploadedFile.id}`}`,
        ];
        
        if (crmStatus) {
            lines.unshift(`KQ sau gọi (Step 4): ${crmStatus}`);
        }
        
        const careNote = {
            content: lines.join(' — '),
            createBy: session.id,
            createAt: new Date(),
            step: 4
        };
        
        await Customer.findByIdAndUpdate(customerId, { 
            $push: { care: careNote } 
        });

        return NextResponse.json({
            success: true,
            message: 'Lưu cuộc gọi thành công!',
            callId: String(newCall._id),
            driveFileId: uploadedFile.id,
            webViewLink: uploadedFile.webViewLink || null,
            fileName: recordingFileName || null
        });

    } catch (error) {
        console.error('Lỗi khi lưu cuộc gọi:', error);
        return NextResponse.json({ 
            success: false, 
            error: `Đã xảy ra lỗi phía máy chủ: ${error.message}` 
        }, { status: 500 });
    }
}

// GET endpoint để lấy lịch sử cuộc gọi
export async function GET(request) {
    try {
        const session = await checkAuthToken();
        if (!session?.id) {
            return NextResponse.json({ 
                success: false, 
                error: 'Yêu cầu đăng nhập.' 
            }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const customerId = searchParams.get('customerId');

        if (!customerId) {
            return NextResponse.json({ 
                success: false, 
                error: 'Thiếu customerId.' 
            }, { status: 400 });
        }

        await connectDB();

        // Lấy lịch sử cuộc gọi của customer
        const calls = await Call.find({ customer: customerId })
            .populate('user', 'name')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return NextResponse.json({
            success: true,
            calls: calls
        });

    } catch (error) {
        console.error('Lỗi khi lấy lịch sử cuộc gọi:', error);
        return NextResponse.json({ 
            success: false, 
            error: `Đã xảy ra lỗi phía máy chủ: ${error.message}` 
        }, { status: 500 });
    }
}


