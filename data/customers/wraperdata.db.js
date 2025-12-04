'use server';

import { revalidateTag } from 'next/cache';
import mongoose from 'mongoose';
import Customer from '@/models/customer.model';
import Service from '@/models/services.model';
import Zalo from '@/models/zalo.model';
import Logs from '@/models/log.model';
import Form from '@/models/formclient';
import Variant from '@/models/variant.model';
import { uploadFileToDrive } from '@/function/drive/image';
import { actionZalo } from '@/function/drive/appscript';
import checkAuthToken from '@/utils/checktoken';
import connectDB from '@/config/connectDB';
import { getCustomersAll } from '@/data/customers/handledata.db';
import { revalidateData } from '@/app/actions/customer.actions';

/* ============================================================
 * Helpers
 * ============================================================ */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const allowedServiceStatus = new Set(['new', 'in_progress', 'completed']);

function pipelineFromServiceStatus(st) {
    return st === 'completed' ? 'serviced_completed_6' : 'serviced_in_progress_6';
}


async function pushCareLog(customerId, content, userId, step = 6) {
    await Customer.updateOne(
        { _id: customerId },
        {
            $push: {
                care: { content, step, createBy: userId, createAt: new Date() },
            },
        }
    );
}

/**
 * Xử lý một chuỗi tin nhắn thô, thay thế các placeholder (ví dụ: {name}) bằng dữ liệu thực tế của khách hàng.
 * @param {string} rawMessage - Chuỗi tin nhắn gốc chứa placeholder.
 * @param {object} customer - Đối tượng khách hàng từ MongoDB.
 * @returns {Promise<string>} Chuỗi tin nhắn đã được xử lý.
 */
async function processMessage(rawMessage, customer) {
    if (!rawMessage || !customer) return '';
    const placeholders = rawMessage.match(/{([^}]+)}/g);
    if (!placeholders) return rawMessage;

    const placeholderNames = [...new Set(placeholders.map(p => p.slice(1, -1)))];
    const staticNames = ['name', 'phone', 'email', 'formname'];
    const variantNames = placeholderNames.filter(name => !staticNames.includes(name));

    const [formResult, variantsResult] = await Promise.all([
        placeholderNames.includes('formname') && customer.source
            ? Form.findById(customer.source).select('name').lean()
            : Promise.resolve(null),
        variantNames.length > 0
            ? Variant.find({ name: { $in: variantNames } }).lean()
            : Promise.resolve([])
    ]);

    const replacementMap = {
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        formname: formResult?.name || 'phòng khám',
    };

    variantsResult.forEach(variant => {
        if (variant.phrases && variant.phrases.length > 0) {
            replacementMap[variant.name] = variant.phrases[Math.floor(Math.random() * variant.phrases.length)];
        }
    });

    return rawMessage.replace(/{([^}]+)}/g, (match, key) => replacementMap[key] !== undefined ? replacementMap[key] : match);
}

/**
 * Hàm helper để gửi tin nhắn Zalo tự động sau khi chốt đăng ký thành công
 * @param {string} customerId - ID khách hàng
 * @param {object} serviceDoc - Service document đã populate
 * @param {string} selectedCourseName - Tên chương trình được chọn
 * @param {object} customerDoc - Customer document
 * @param {string} userId - ID người dùng thực hiện chốt đăng ký
 */
async function sendEnrollmentZaloMessage(customerId, serviceDoc, selectedCourseName, customerDoc, userId) {
    try {
        console.log(`[sendEnrollmentZaloMessage] Bắt đầu gửi tin nhắn Zalo cho KH ${customerId}, chương trình: ${selectedCourseName}`);
        
        // 1. Reload customer để đảm bảo có thông tin uid mới nhất
        const customer = await Customer.findById(customerId).lean();
        if (!customer) {
            console.log(`[sendEnrollmentZaloMessage] Không tìm thấy khách hàng ${customerId}. Bỏ qua.`);
            return;
        }
        
        // 2. Tìm tin nhắn phù hợp với chương trình được chọn
        if (!serviceDoc.preSurgeryMessages || !Array.isArray(serviceDoc.preSurgeryMessages) || serviceDoc.preSurgeryMessages.length === 0) {
            console.log(`[sendEnrollmentZaloMessage] Không có tin nhắn preSurgeryMessages cho ngành học "${serviceDoc.name}". Bỏ qua.`);
            return;
        }

        const messageTemplate = serviceDoc.preSurgeryMessages.find(
            msg => msg.appliesToCourse === selectedCourseName
        );

        if (!messageTemplate || !messageTemplate.content) {
            console.log(`[sendEnrollmentZaloMessage] Không tìm thấy tin nhắn cho chương trình "${selectedCourseName}". Bỏ qua.`);
            return;
        }

        // 3. Xử lý tin nhắn (thay placeholder)
        const messageContent = await processMessage(messageTemplate.content, customer);

        // 4. Chọn tài khoản Zalo
        // Ưu tiên: tài khoản Zalo đã tìm thấy UID của khách hàng
        let selectedZalo = null;
        if (customer.uid?.[0]?.zalo) {
            selectedZalo = await Zalo.findById(customer.uid[0].zalo).lean();
        }
        
        // Fallback: chọn bất kỳ tài khoản Zalo nào có sẵn
        if (!selectedZalo) {
            selectedZalo = await Zalo.findOne().sort({ _id: -1 }).lean();
        }

        if (!selectedZalo) {
            console.log(`[sendEnrollmentZaloMessage] Không tìm thấy tài khoản Zalo để gửi tin. Bỏ qua.`);
            return;
        }

        console.log(`[sendEnrollmentZaloMessage] Đã chọn tài khoản Zalo: ${selectedZalo.name}, UID: ${selectedZalo.uid}`);

        // 5. Gửi tin nhắn qua Zalo
        const response = await actionZalo({
            phone: customer.phone,
            uidPerson: customer.uid?.[0]?.uid || '',
            actionType: 'sendMessage',
            message: messageContent,
            uid: selectedZalo.uid
        });

        // 6. Ghi log
        await Logs.create({
            status: {
                status: response?.status || false,
                message: messageContent,
                data: {
                    error_code: response?.content?.error_code || null,
                    error_message: response?.content?.error_message || (response?.status ? '' : 'Invalid response from AppScript')
                }
            },
            type: 'sendMessage',
            createBy: userId || customerId, // Sử dụng người chốt đơn hoặc customerId
            customer: customerId,
            zalo: selectedZalo._id,
        });

        if (!response?.status) {
            console.error(`[sendEnrollmentZaloMessage] Gửi tin nhắn thất bại:`, response?.content?.error_message || response?.message);
            await pushCareLog(
                customerId,
                `[Gửi tin nhắn Zalo tự động sau chốt đăng ký] Thất bại: ${response?.content?.error_message || response?.message || 'Lỗi không xác định'}`,
                userId || customerId,
                6
            );
            return;
        }

        // 6. Ghi care log thành công
        await pushCareLog(
            customerId,
            `[Gửi tin nhắn Zalo tự động sau chốt đăng ký] Đã gửi tin nhắn cho chương trình "${selectedCourseName}" thành công.`,
            userId || customerId,
            6
        );

        console.log(`[sendEnrollmentZaloMessage] ✅ Đã gửi tin nhắn Zalo thành công cho KH ${customerId}`);

    } catch (error) {
        console.error(`[sendEnrollmentZaloMessage] ❌ Lỗi khi gửi tin nhắn Zalo:`, error);
        // Không throw error để không ảnh hưởng đến việc chốt đăng ký
        // Chỉ ghi log lỗi
        try {
            await pushCareLog(
                customerId,
                `[Gửi tin nhắn Zalo tự động sau chốt đăng ký] Lỗi: ${error.message}`,
                userId || customerId,
                6
            );
        } catch (logError) {
            console.error(`[sendEnrollmentZaloMessage] Lỗi khi ghi care log:`, logError);
        }
    }
}

/* ============================================================
 * DATA BRIDGE (Giữ nguyên hành vi)
 * ============================================================ */
export async function customer_data(params = {}) {
    // Giữ nguyên hàm này
    return await getCustomersAll();
}

export async function reloadCustomers() {
    // Giữ nguyên hàm này
    revalidateTag('customers');
}

/* ============================================================
 * ACTION CHO BƯỚC 6 - CHỐT ĐĂNG KÝ (Chờ duyệt)
 * ============================================================ */
export async function closeServiceAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) {
        return { success: false, error: 'Yêu cầu đăng nhập.' };
    }

    // 1. Lấy dữ liệu từ FormData
    const customerId = String(formData.get('customerId') || '');
    const status = String(formData.get('status') || 'completed');
    const notes = String(formData.get('notes') || '');
    const invoiceImages = formData.getAll('invoiceImage');
    const customerPhotos = formData.getAll('customerPhotos');
    const selectedServiceId = String(formData.get('selectedService') || '');
    const selectedCourseName = String(formData.get('selectedCourseName') || '');
    const discountType = String(formData.get('discountType') || 'none');
    const discountValue = Number(formData.get('discountValue') || 0);
    const adjustmentType = String(formData.get('adjustmentType') || 'none');
    const adjustmentValue = Number(formData.get('adjustmentValue') || 0);

    // 2. Validation cơ bản
    if (!customerId || !isValidObjectId(customerId)) {
        return { success: false, error: 'ID khách hàng không hợp lệ.' };
    }
    if (!['completed', 'in_progress', 'rejected'].includes(status)) {
        return { success: false, error: 'Trạng thái không hợp lệ.' };
    }

    // Validation cho các trường hợp không phải "Từ chối"
    if (status !== 'rejected') {
        if (!invoiceImages || invoiceImages.length === 0 || invoiceImages[0].size === 0) {
            return { success: false, error: 'Ảnh hóa đơn/hợp đồng là bắt buộc.' };
        }
        if (!selectedServiceId || !isValidObjectId(selectedServiceId)) {
            return { success: false, error: 'Vui lòng chọn ngành học hợp lệ.' };
        }
        if (!selectedCourseName) {
            return { success: false, error: 'Vui lòng chọn một chương trình để chốt.' };
        }
    }

    try {
        await connectDB();

        let listPrice = 0;
        let finalPrice = 0;
        let courseSnapshot = null;

        // 3. Tìm chương trình và tính toán giá (nếu cần)
        let serviceDoc = null;
        if (status !== 'rejected') {
            serviceDoc = await Service.findById(selectedServiceId).lean();
            if (!serviceDoc) {
                return { success: false, error: 'Không tìm thấy ngành học đã chọn.' };
            }

            const course = serviceDoc.treatmentCourses.find(c => c.name === selectedCourseName);
            if (!course) {
                return { success: false, error: 'Không tìm thấy chương trình trong ngành học đã chọn.' };
            }

            const costs = course.costs || {};
            listPrice = (costs.basePrice || 0) + (costs.fullMedication || 0) + (costs.partialMedication || 0) + (costs.otherFees || 0);

            // Tính giá cuối cùng dựa trên điều chỉnh
            if (adjustmentType === 'discount') {
                if (discountType === 'amount') {
                    finalPrice = Math.max(0, listPrice - discountValue);
                } else if (discountType === 'percent') {
                    finalPrice = Math.max(0, Math.round(listPrice * (1 - discountValue / 100)));
                } else {
                    finalPrice = listPrice;
                }
            } else if (adjustmentType === 'increase') {
                if (discountType === 'amount') {
                    finalPrice = Math.max(0, listPrice + adjustmentValue);
                } else if (discountType === 'percent') {
                    finalPrice = Math.max(0, Math.round(listPrice * (1 + adjustmentValue / 100)));
                } else {
                    finalPrice = listPrice;
                }
            } else {
                finalPrice = listPrice;
            }

            courseSnapshot = {
                name: course.name,
                description: course.description,
                costs: course.costs,
            };
        }

        // 4. Upload nhiều ảnh lên Drive
        const uploadedFileIds = [];
        if (invoiceImages.length > 0 && invoiceImages[0].size > 0) {
            const folderId = '1M-lSX-URoyvX-IU7e-TK-nhgkl7ptda3'; // Thay bằng ID folder Drive của bạn
            for (const image of invoiceImages) {
                const uploadedFile = await uploadFileToDrive(image, folderId);
                if (uploadedFile?.id) {
                    uploadedFileIds.push(uploadedFile.id);
                }
            }
            // Nếu có file nhưng không upload được file nào thì báo lỗi
            if (uploadedFileIds.length === 0) {
                return { success: false, error: 'Tải ảnh lên không thành công, vui lòng thử lại.' };
            }
        }

        // Upload ảnh khách hàng
        const uploadedCustomerPhotoIds = [];
        if (customerPhotos.length > 0 && customerPhotos[0].size > 0) {
            const folderId = '1M-lSX-URoyvX-IU7e-TK-nhgkl7ptda3';
            for (const photo of customerPhotos) {
                const uploadedFile = await uploadFileToDrive(photo, folderId);
                if (uploadedFile?.id) {
                    uploadedCustomerPhotoIds.push(uploadedFile.id);
                }
            }
        }

        // 5. Nạp thông tin khách hàng
        const customerDoc = await Customer.findById(customerId);
        if (!customerDoc) return { success: false, error: 'Không tìm thấy khách hàng.' };

        if (!Array.isArray(customerDoc.serviceDetails)) {
            customerDoc.serviceDetails = [];
        }

        // 6. Tạo object service detail mới
        const newServiceDetail = {
            approvalStatus: 'pending',
            status: status,
            revenue: finalPrice, // Doanh thu chính là giá cuối cùng
            invoiceDriveIds: uploadedFileIds, // Lưu mảng ID ảnh
            customerPhotosDriveIds: uploadedCustomerPhotoIds, // Lưu mảng ID ảnh khách hàng
            notes: notes || '',
            closedAt: new Date(),
            closedBy: session.id,
            selectedService: selectedServiceId || null,
            selectedCourse: courseSnapshot,
            pricing: {
                listPrice: listPrice,
                discountType: discountType,
                discountValue: discountValue,
                adjustmentType: adjustmentType,
                adjustmentValue: adjustmentValue,
                finalPrice: finalPrice,
            },
        };

        customerDoc.serviceDetails.push(newServiceDetail);

        // 7. Cập nhật pipeline
        const newPipelineStatus = pipelineFromServiceStatus(status);
        if (newPipelineStatus) {
            customerDoc.pipelineStatus = customerDoc.pipelineStatus || [];
            customerDoc.pipelineStatus[6] = newPipelineStatus; // Giả sử step 6
            console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus[6]=${newPipelineStatus} (closeServiceAction)`);
        }

        // 8. Ghi care log
        const logContent = `[Chốt đăng ký] Trạng thái: ${status}. ${selectedCourseName ? `Chương trình: ${selectedCourseName}. ` : ''}Ghi chú: ${notes || 'Không có'}`;
        customerDoc.care = customerDoc.care || [];
        customerDoc.care.push({ content: logContent, createBy: session.id, createAt: new Date(), step: 6 });

        // 9. Lưu vào DB
        await customerDoc.save();

        // 10. Gửi tin nhắn Zalo tự động sau khi chốt đăng ký thành công (chỉ khi status không phải rejected)
        if (status !== 'rejected' && serviceDoc && selectedCourseName && customerDoc) {
            // Chạy nền (không await) để không làm chậm response
            sendEnrollmentZaloMessage(customerId, serviceDoc, selectedCourseName, customerDoc, session.id).catch(err => {
                console.error('[closeServiceAction] Lỗi ngầm khi gửi tin nhắn Zalo tự động:', err);
            });
        }

        revalidateData(); // Hàm revalidate của bạn
        return { success: true, message: 'Chốt đăng ký thành công! Đơn đang chờ duyệt.' };
    } catch (error) {
        console.error('Lỗi khi chốt đăng ký: ', error);
        return { success: false, error: 'Đã xảy ra lỗi phía máy chủ.' };
    }
}
/* ============================================================
 * ACTION CHO BƯỚC 4 - LƯU KẾT QUẢ CUỘC GỌI (Đã cập nhật)
 * ============================================================ */
export async function saveCallResultAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) {
        return { success: false, error: 'Yêu cầu đăng nhập.' };
    }

    const customerId = formData.get('customerId');
    const newStatus = formData.get('status');
    const callDuration = formData.get('callDuration');
    const callStartTime = formData.get('callStartTime');
    const recordingFile = formData.get('recordingFile');
    const recordingFileName = formData.get('recordingFileName'); // Giữ lại để trả về cho UI nếu cần

    if (!customerId || !newStatus || !recordingFile || recordingFile.size === 0) {
        return { success: false, error: 'Thiếu thông tin khách hàng, trạng thái hoặc file ghi âm.' };
    }

    try {
        await connectDB();

        // SỬ DỤNG HÀM MỚI: Tải file ghi âm lên 
        // ?? id folder này là id của folder ảnh?
        const folderId = '1vNTcGy_oYM9phqutlvt-Fc5td8bFTkSm'; // Cần thêm biến này
        const uploadedFile = await uploadFileToDrive(recordingFile, folderId);

        if (!uploadedFile?.id) {
            throw new Error('Tải file ghi âm lên Drive thất bại.');
        }

        // CẬP NHẬT: Lấy link trực tiếp từ kết quả trả về của hàm upload
        const callStartFormatted = new Date(callStartTime).toLocaleTimeString('vi-VN');
        const logContent = `Đã gọi ${callDuration} lúc ${callStartFormatted}. Trạng thái: ${newStatus}. Ghi âm: ${uploadedFile.webViewLink || 'đã lưu'
            }`;

        const careNote = {
            content: logContent,
            createBy: session.id,
            createAt: new Date(),
            step: 4,
        };

        await Customer.findByIdAndUpdate(customerId, {
            $set: {
                'pipelineStatus.0': newStatus,
                'pipelineStatus.3': newStatus,
            },
            $push: { care: careNote },
        });
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newStatus}, pipelineStatus.3=${newStatus} (saveCallResultAction)`);

        revalidateData();
        return {
            success: true,
            message: 'Đã lưu kết quả cuộc gọi thành công!',
            newRecording: {
                name: recordingFileName,
                driveLink: uploadedFile.webViewLink,
                status: 'uploaded',
            },
        };
    } catch (error) {
        console.error('Lỗi khi lưu kết quả cuộc gọi: ', error);
        return { success: false, error: `Đã xảy ra lỗi phía máy chủ: ${error.message}` };
    }
}

/* ============================================================
 * SỬA serviceDetails (CHỈ KHI PENDING)
 * - Cập nhật: status, notes, selectedService, pricing (nếu có), invoice
 * - Không cho sửa nếu approvalStatus='approved'
 * ============================================================ */
export async function updateServiceDetailAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) return { success: false, error: 'Yêu cầu đăng nhập.' };

    const customerId = String(formData.get('customerId') || '');
    const serviceDetailId = String(formData.get('serviceDetailId') || '');

    const statusRaw = formData.get('status') != null ? String(formData.get('status')) : undefined;
    const notes = formData.get('notes') != null ? String(formData.get('notes')) : undefined;
    const selectedService =
        formData.get('selectedService') != null ? String(formData.get('selectedService')) : undefined;

    const listPrice = formData.get('listPrice') != null ? Number(formData.get('listPrice')) : undefined;
    const discountType =
        formData.get('discountType') != null ? String(formData.get('discountType')) : undefined; // none|amount|percent
    const discountValue =
        formData.get('discountValue') != null ? Number(formData.get('discountValue')) : undefined;
    const adjustmentType =
        formData.get('adjustmentType') != null ? String(formData.get('adjustmentType')) : undefined; // none|discount|increase
    const adjustmentValue =
        formData.get('adjustmentValue') != null ? Number(formData.get('adjustmentValue')) : undefined;
    const finalPrice = formData.get('finalPrice') != null ? Number(formData.get('finalPrice')) : undefined;

    // 🧩 ĐỌC MẢNG FILES ĐÚNG CÁCH
    const invoiceImagesRaw = formData.getAll('invoiceImage') || [];
    const invoiceImages = invoiceImagesRaw.filter(
        (f) => f && typeof f === 'object' && 'size' in f && Number(f.size) > 0
    );

    const customerPhotosRaw = formData.getAll('customerPhotos') || [];
    const customerPhotos = customerPhotosRaw.filter(
        (f) => f && typeof f === 'object' && 'size' in f && Number(f.size) > 0
    );

    if (!isValidObjectId(customerId) || !isValidObjectId(serviceDetailId)) {
        return { success: false, error: 'customerId/serviceDetailId không hợp lệ.' };
    }
    if (statusRaw && !allowedServiceStatus.has(statusRaw)) {
        return { success: false, error: 'Trạng thái không hợp lệ (new|in_progress|completed).' };
    }
    if (selectedService && !isValidObjectId(selectedService)) {
        return { success: false, error: 'Ngành học chốt không hợp lệ.' };
    }

    try {
        await connectDB();

        const customer = await Customer.findById(customerId);
        if (!customer) return { success: false, error: 'Không tìm thấy khách hàng.' };

        const detail = customer.serviceDetails?.id(serviceDetailId);
        if (!detail) return { success: false, error: 'Không tìm thấy đơn đăng ký.' };
        if (detail.approvalStatus === 'approved') {
            return { success: false, error: 'Đơn đã duyệt. Không thể chỉnh sửa.' };
        }

        // Cập nhật các field cơ bản
        if (typeof statusRaw !== 'undefined') detail.status = statusRaw;
        if (typeof notes !== 'undefined') detail.notes = notes;
        if (typeof selectedService !== 'undefined') detail.selectedService = selectedService;

        // Cập nhật pricing nếu có
        if (
            typeof listPrice !== 'undefined' ||
            typeof discountType !== 'undefined' ||
            typeof discountValue !== 'undefined' ||
            typeof adjustmentType !== 'undefined' ||
            typeof adjustmentValue !== 'undefined' ||
            typeof finalPrice !== 'undefined'
        ) {
            const current = detail.pricing || {};
            const next = { ...current };

            if (typeof listPrice === 'number' && Number.isFinite(listPrice)) next.listPrice = listPrice;

            if (typeof discountType !== 'undefined') {
                next.discountType = ['none', 'amount', 'percent'].includes(discountType)
                    ? discountType
                    : current.discountType || 'none';
            }

            if (typeof discountValue === 'number' && Number.isFinite(discountValue))
                next.discountValue = discountValue;

            if (typeof adjustmentType !== 'undefined') {
                next.adjustmentType = ['none', 'discount', 'increase'].includes(adjustmentType)
                    ? adjustmentType
                    : current.adjustmentType || 'none';
            }

            if (typeof adjustmentValue === 'number' && Number.isFinite(adjustmentValue))
                next.adjustmentValue = adjustmentValue;

            if (typeof finalPrice === 'number' && Number.isFinite(finalPrice)) next.finalPrice = finalPrice;

            detail.pricing = next;
        }

        // 📸 Xử lý xóa ảnh và cập nhật danh sách ảnh
        const deletedImageIdsRaw = formData.getAll('deletedImageIds') || [];
        const deletedImageIds = Array.isArray(deletedImageIdsRaw) ? deletedImageIdsRaw.filter(id => id) : [];
        
        // Lấy existingImageIds từ formData (ảnh đã lưu theo thứ tự mới từ unified state)
        const existingIdsRaw = formData.getAll('existingImageIds') || [];
        let existingIds = Array.isArray(existingIdsRaw) ? existingIdsRaw.filter(id => id) : [];
        
        // Xóa các ID đã chọn xóa khỏi existingIds trước khi xử lý
        if (deletedImageIds.length > 0) {
            existingIds = existingIds.filter(id => !deletedImageIds.includes(id));
        }

        // 📸 Upload thêm invoice (nếu có file mới)
        if (invoiceImages.length > 0) {
            const folderId = '1vNTcGy_oYM9phqutlvt-Fc5td8bFTkSm';
            const uploaded = [];
            for (const f of invoiceImages) {
                const up = await uploadFileToDrive(f, folderId);
                if (up?.id) uploaded.push(up.id);
            }
            if (uploaded.length === 0) {
                return { success: false, error: 'Tải ảnh lên không thành công. Vui lòng thử lại.' };
            }
            
            // Gán lại với existingIds đã được lọc (đã xóa ID cần xóa) + ảnh mới
            if (existingIds.length > 0) {
                detail.invoiceDriveIds = [...existingIds, ...uploaded];
            } else {
                // Nếu không có existingIds, lấy từ detail hiện tại và lọc bỏ ID đã xóa
                const currentIds = (detail.invoiceDriveIds || []).filter(id => !deletedImageIds.includes(id));
                detail.invoiceDriveIds = [...currentIds, ...uploaded];
            }
        } else {
            // Chỉ sắp xếp lại mà không thêm ảnh mới
            if (existingIds.length > 0) {
                // Có existingIds: dùng danh sách đã được lọc (đã xóa ID cần xóa)
                detail.invoiceDriveIds = existingIds;
            } else if (deletedImageIds.length > 0) {
                // Không có existingIds nhưng có ID cần xóa: xóa khỏi danh sách hiện tại
                detail.invoiceDriveIds = (detail.invoiceDriveIds || []).filter(id => !deletedImageIds.includes(id));
            }
            // Nếu không có existingIds và không có ID cần xóa: giữ nguyên
        }

        // 📸 Xử lý xóa ảnh khách hàng và cập nhật danh sách ảnh
        const deletedCustomerPhotoIdsRaw = formData.getAll('deletedCustomerPhotoIds') || [];
        const deletedCustomerPhotoIds = Array.isArray(deletedCustomerPhotoIdsRaw) ? deletedCustomerPhotoIdsRaw.filter(id => id) : [];
        
        // Lấy existingCustomerPhotoIds từ formData (ảnh đã lưu theo thứ tự mới từ unified state)
        const existingCustomerPhotoIdsRaw = formData.getAll('existingCustomerPhotoIds') || [];
        let existingCustomerPhotoIds = Array.isArray(existingCustomerPhotoIdsRaw) ? existingCustomerPhotoIdsRaw.filter(id => id) : [];
        
        // Xóa các ID đã chọn xóa khỏi existingCustomerPhotoIds trước khi xử lý
        if (deletedCustomerPhotoIds.length > 0) {
            existingCustomerPhotoIds = existingCustomerPhotoIds.filter(id => !deletedCustomerPhotoIds.includes(id));
        }

        // Xử lý ảnh khách hàng
        if (customerPhotos.length > 0) {
            const folderId = '1M-lSX-URoyvX-IU7e-TK-nhgkl7ptda3';
            const uploaded = [];
            for (const f of customerPhotos) {
                const up = await uploadFileToDrive(f, folderId);
                if (up?.id) uploaded.push(up.id);
            }
            if (uploaded.length > 0) {
                // Gán lại với existingCustomerPhotoIds đã được lọc (đã xóa ID cần xóa) + ảnh mới
                if (existingCustomerPhotoIds.length > 0) {
                    detail.customerPhotosDriveIds = [...existingCustomerPhotoIds, ...uploaded];
                } else {
                    // Nếu không có existingCustomerPhotoIds, lấy từ detail hiện tại và lọc bỏ ID đã xóa
                    const currentIds = (detail.customerPhotosDriveIds || []).filter(id => !deletedCustomerPhotoIds.includes(id));
                    detail.customerPhotosDriveIds = [...currentIds, ...uploaded];
                }
            }
        } else {
            // Chỉ sắp xếp lại mà không thêm ảnh mới
            if (existingCustomerPhotoIds.length > 0) {
                // Có existingCustomerPhotoIds: dùng danh sách đã được lọc (đã xóa ID cần xóa)
                detail.customerPhotosDriveIds = existingCustomerPhotoIds;
            } else if (deletedCustomerPhotoIds.length > 0) {
                // Không có existingCustomerPhotoIds nhưng có ID cần xóa: xóa khỏi danh sách hiện tại
                detail.customerPhotosDriveIds = (detail.customerPhotosDriveIds || []).filter(id => !deletedCustomerPhotoIds.includes(id));
            }
            // Nếu không có existingCustomerPhotoIds và không có ID cần xóa: giữ nguyên
        }

        // Lưu subdoc
        await customer.save();

        // Cập nhật pipeline theo status hiện tại của detail
        const finalStatus = detail.status;
        const newPipeline = pipelineFromServiceStatus(finalStatus);
        await Customer.updateOne(
            { _id: customerId },
            {
                $set: {
                    'pipelineStatus.0': newPipeline,
                    'pipelineStatus.6': newPipeline,
                },
            }
        );
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newPipeline}, pipelineStatus.6=${newPipeline} (updateServiceDetailAction)`);

        await pushCareLog(
            customerId,
            `[Sửa đơn chốt] #${serviceDetailId} ${statusRaw ? `(status → ${finalStatus})` : ''}${notes ? ` | Ghi chú: ${notes}` : ''
            }`,
            session.id
        );

        revalidateData();
        return { success: true, message: 'Đã cập nhật đơn chốt (pending).' };
    } catch (error) {
        console.error('[updateServiceDetailAction] error:', error);
        return { success: false, error: 'Lỗi server khi cập nhật đơn chốt.' };
    }
}

/* ============================================================
 * XÓA serviceDetails (CHỈ KHI PENDING)
 * ============================================================ */
export async function deleteServiceDetailAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) return { success: false, error: 'Yêu cầu đăng nhập.' };

    const customerId = String(formData.get('customerId') || '');
    const serviceDetailId = String(formData.get('serviceDetailId') || '');

    if (!isValidObjectId(customerId) || !isValidObjectId(serviceDetailId)) {
        return { success: false, error: 'customerId/serviceDetailId không hợp lệ.' };
    }

    try {
        await connectDB();

        // Chỉ xóa khi approvalStatus = 'pending'
        const res = await Customer.updateOne(
            { _id: customerId },
            {
                $pull: {
                    serviceDetails: {
                        _id: new mongoose.Types.ObjectId(serviceDetailId),
                        approvalStatus: 'pending',
                    },
                },
            }
        );

        if (res.modifiedCount === 0) {
            return {
                success: false,
                error: 'Không thể xóa: đơn không ở trạng thái pending hoặc không tồn tại.',
            };
        }

        await pushCareLog(customerId, `[Xóa đơn chốt] #${serviceDetailId}`, session.id);

        revalidateData();
        return { success: true, message: 'Đã xóa đơn chốt (pending).' };
    } catch (error) {
        console.error('[deleteServiceDetailAction] error:', error);
        return { success: false, error: 'Lỗi server khi xóa đơn chốt.' };
    }
}

/* ============================================================
 * DUYỆT serviceDetails (PENDING → APPROVED; khóa sửa/xóa)
 * ============================================================ */
export async function approveServiceDetailAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) return { success: false, error: 'Yêu cầu đăng nhập.' };

    const customerId = String(formData.get('customerId') || '');
    const serviceDetailId = String(formData.get('serviceDetailId') || '');

    if (!isValidObjectId(customerId) || !isValidObjectId(serviceDetailId)) {
        return { success: false, error: 'customerId/serviceDetailId không hợp lệ.' };
    }

    try {
        await connectDB();
        const customer = await Customer.findById(customerId);
        if (!customer) return { success: false, error: 'Không tìm thấy khách hàng.' };

        const detail = customer.serviceDetails?.id(serviceDetailId);
        if (!detail) return { success: false, error: 'Không tìm thấy đơn đăng ký.' };
        if (detail.approvalStatus === 'approved')
            return { success: false, error: 'Đơn đã duyệt trước đó.' };

        detail.approvalStatus = 'approved';
        detail.approvedBy = session.id;
        detail.approvedAt = new Date();

        await customer.save();

        const newPipeline = pipelineFromServiceStatus(detail.status);
        await Customer.updateOne(
            { _id: customerId },
            {
                $set: {
                    'pipelineStatus.0': newPipeline,
                    'pipelineStatus.6': newPipeline,
                },
            }
        );
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newPipeline}, pipelineStatus.6=${newPipeline} (approveServiceDetailAction)`);

        await pushCareLog(
            customerId,
            `[Duyệt đơn chốt] #${serviceDetailId} (status: ${detail.status})`,
            session.id
        );

        revalidateData();
        return { success: true, message: 'Đã duyệt đơn thành công.' };
    } catch (e) {
        console.error('[approveServiceDetailAction] error:', e);
        return { success: false, error: 'Lỗi server khi duyệt đơn.' };
    }
}

/* ============================================================
 * APPROVE DEAL (legacy-compatible): dùng serviceDetailId
 * ============================================================ */
export async function approveServiceDealAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) return { success: false, error: 'Yêu cầu đăng nhập.' };

    const customerId = String(formData.get('customerId') || '');
    const serviceDetailId = String(formData.get('serviceDetailId') || '');

    const listPrice = Number(formData.get('listPrice') || 0);
    const discountType = String(formData.get('discountType') || 'none');
    const discountValue = Number(formData.get('discountValue') || 0);
    const finalPrice = Number(formData.get('finalPrice') || 0);
    const revenue = Number(formData.get('revenue') || 0);
    const notes = String(formData.get('notes') || '');

    let commissions = [];
    let costs = [];
    try {
        commissions = JSON.parse(formData.get('commissions') || '[]');
        costs = JSON.parse(formData.get('costs') || '[]');
    } catch (_) { }

    if (!isValidObjectId(customerId) || !isValidObjectId(serviceDetailId)) {
        return { success: false, error: 'Thiếu hoặc sai customerId/serviceDetailId.' };
    }

    try {
        await connectDB();
        const customer = await Customer.findById(customerId);
        if (!customer) return { success: false, error: 'Không tìm thấy khách hàng.' };

        const detail = customer.serviceDetails?.id(serviceDetailId);
        if (!detail) return { success: false, error: 'Không tìm thấy đơn đăng ký.' };
        if (detail.approvalStatus === 'approved')
            return { success: false, error: 'Đơn đã duyệt trước đó.' };

        // cập nhật pricing theo form duyệt
        detail.notes = notes;
        detail.revenue = Number.isFinite(revenue) ? revenue : 0;
        detail.pricing = {
            listPrice,
            discountType: ['none', 'amount', 'percent'].includes(discountType) ? discountType : 'none',
            discountValue,
            finalPrice,
        };
        detail.commissions = (Array.isArray(commissions) ? commissions : []).map((x) => ({
            user: x.user,
            role: x.role,
            percent: Number(x.percent) || 0,
            amount: Number(x.amount) || 0,
        }));
        detail.costs = (Array.isArray(costs) ? costs : []).map((x) => ({
            label: x.label,
            amount: Number(x.amount) || 0,
        }));

        // Approve
        detail.approvalStatus = 'approved';
        detail.approvedBy = session.id;
        detail.approvedAt = new Date();

        await customer.save();

        const newPipeline = pipelineFromServiceStatus(detail.status);
        customer.pipelineStatus = customer.pipelineStatus || [];
        customer.pipelineStatus[0] = newPipeline;
        customer.pipelineStatus[6] = newPipeline;
        await customer.save();
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus[0]=${newPipeline}, pipelineStatus[6]=${newPipeline} (approveServiceDealAction)`);

        await pushCareLog(
            customerId,
            `Admin duyệt đơn chốt #${serviceDetailId} (revenue: ${Number(revenue).toLocaleString('vi-VN')}đ).`,
            session.id
        );

        revalidateData();
        return { success: true, message: 'Đã duyệt đơn thành công.' };
    } catch (e) {
        console.error('[approveServiceDealAction] error:', e);
        return { success: false, error: 'Lỗi server khi duyệt đơn.' };
    }
}


// ============= REJECT DEAL (legacy-compatible) =============
export async function rejectServiceDealAction(prevState, formData) {
    const session = await checkAuthToken();
    if (!session?.id) return { success: false, error: 'Yêu cầu đăng nhập.' };

    const customerId = String(formData.get('customerId') || '');
    const serviceDetailId = String(formData.get('serviceDetailId') || '');
    const reason = String(formData.get('reason') || '');

    if (!isValidObjectId(customerId) || !isValidObjectId(serviceDetailId)) {
        return { success: false, error: 'Thiếu hoặc sai customerId/serviceDetailId.' };
    }

    try {
        await connectDB();

        // Hành vi reject theo yêu cầu mới:
        // - Không có trạng thái "rejected" trong approvalStatus
        // - Ta coi reject là HỦY đơn pending (xóa item) + cập nhật pipeline rejected
        const res = await Customer.updateOne(
            { _id: customerId },
            {
                $pull: {
                    serviceDetails: {
                        _id: new mongoose.Types.ObjectId(serviceDetailId),
                        approvalStatus: 'pending',
                    },
                },
                $set: {
                    'pipelineStatus.0': 'rejected_after_consult_6',
                    'pipelineStatus.6': 'rejected_after_consult_6',
                },
            }
        );
        if (res.modifiedCount > 0) {
            console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=rejected_after_consult_6, pipelineStatus.6=rejected_after_consult_6 (rejectServiceDealAction)`);
        }

        if (res.modifiedCount === 0) {
            return {
                success: false,
                error:
                    'Không thể từ chối: đơn không ở trạng thái pending hoặc không tồn tại.',
            };
        }

        await pushCareLog(
            customerId,
            `Admin từ chối đơn chốt #${serviceDetailId}${reason ? `: ${reason}` : ''}.`,
            session.id
        );

        revalidateData();
        return { success: true, message: 'Đã từ chối đơn.' };
    } catch (e) {
        console.error('[rejectServiceDealAction] error:', e);
        return { success: false, error: 'Lỗi server khi từ chối đơn.' };
    }
}
