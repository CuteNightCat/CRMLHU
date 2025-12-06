'use server';

import dbConnect from "@/config/connectDB";
import Form from "@/models/formclient";
import checkAuthToken from '@/utils/checktoken';
import { reloadForm } from '@/data/form_database/wraperdata.db.js'
import Customer from '@/models/customer.model';
import initAgenda from '@/config/agenda';
import mongoose from 'mongoose';
import { revalidateData } from '@/app/actions/customer.actions';
import { sendGP, actionZalo } from "@/function/drive/appscript";
import { service_data } from '@/data/services/wraperdata.db'
import { se } from "date-fns/locale";
import autoAssignForCustomer from '@/utils/autoAssign';
import User from '@/models/users';
import ZaloAccount from '@/models/zalo.model';
import Setting from '@/models/setting.model';
import Logs from '@/models/log.model';
import Variant from '@/models/variant.model';
import { WorkflowTemplate } from '@/models/workflows.model';

// Helper function để lấy workflow ID từ database dựa trên tên
async function getWorkflowIdByName(namePattern) {
    try {
        await dbConnect();
        const workflow = await WorkflowTemplate.findOne({ 
            name: { $regex: namePattern, $options: 'i' } 
        }).select('_id').lean();
        return workflow ? workflow._id.toString() : null;
    } catch (error) {
        console.error(`[getWorkflowIdByName] Lỗi khi tìm workflow với pattern "${namePattern}":`, error);
        return null;
    }
}

export async function createAreaAction(_previousState, formData) {
    await dbConnect();
    const name = formData.get('name');
    const user = await checkAuthToken();

    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    // console.log(user.role);

    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }
    const formInputValues = formData.getAll('formInput');
    const formInput = formInputValues.map(Number);
    const describe = formData.get('describe');
    if (!name) return { message: 'Tên form là bắt buộc.', status: false };
    if (name.length > 50) return { message: 'Tên form phải ít hơn 50 kí tự', status: false };
    if (describe.length > 1000) return { message: 'Mô tả phải ít hơn 1000 kí tự', status: false };
    const processedName = name.toString().toLowerCase().trim();
    try {
        const existingArea = await Form.findOne({ name: processedName });
        if (existingArea) {
            return { message: 'Lỗi: Tên form này đã tồn tại.', status: false };
        }
        const newArea = new Form({
            name: processedName,
            describe: describe?.toString().trim(),
            createdBy: user.id,
            formInput: formInput,
        });
        await newArea.save();
        reloadForm();
        return { message: `Đã tạo thành công form "${name}".`, status: true };
    } catch (error) {
        console.error("Lỗi tạo form:", error);
        return { message: 'Lỗi hệ thống, không thể tạo form.', status: false };
    }
}

export async function updateAreaAction(_previousState, formData) {
    const id = formData.get('id');
    const name = formData.get('name');
    const describe = formData.get('describe');
    const formInputValues = formData.getAll('formInput');
    const formInput = formInputValues.map(Number);
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }
    if (!id || !name) {
        return { message: 'Dữ liệu không hợp lệ (thiếu ID hoặc tên).', status: false };
    }
    if (name.length > 50) {
        return { message: 'Tên form phải ít hơn 50 kí tự', status: false };
    }
    const processedName = name.toString().toLowerCase().trim();
    try {
        await dbConnect();
        const existingArea = await Form.findOne({
            name: processedName,
            _id: { $ne: id }
        });

        if (existingArea) {
            return { message: 'Lỗi: Tên form này đã được sử dụng ở một khu vực khác.', status: false };
        }

        const updatedArea = await Form.findByIdAndUpdate(
            id,
            {
                name: processedName,
                describe: describe?.toString().trim(),
                formInput: formInput,
            },
            { new: true }
        );

        if (!updatedArea) {
            return { message: 'Không tìm thấy khu vực để cập nhật.', status: false };
        }
        reloadForm();
        return { message: `Đã cập nhật thành công form "${name}".`, status: true };

    } catch (error) {
        console.error("Lỗi cập nhật form:", error);
        return { message: 'Lỗi hệ thống, không thể cập nhật form.', status: false };
    }
}

export async function deleteAreaAction(_previousState, formData) {
    const id = formData.get('id');
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }
    try {
        await dbConnect();
        const areaToDelete = await Form.findById(id);
        if (!areaToDelete) { return { status: false, message: 'Không tìm thấy khu vực để xóa.' }; }
        await Form.findByIdAndDelete(id);
        reloadForm();
        return { status: true, message: 'Xóa khu vực thành công!' };
    } catch (error) {
        console.error('Lỗi khi xóa khu vực:', error);
        return { status: false, message: 'Đã xảy ra lỗi. Không thể xóa khu vực.' };
    }
}

/**
 * Action đa năng: Xử lý đăng ký và thêm mới khách hàng.
 */
export async function addRegistrationToAction(_previousState, inputData) {
    try {
        const isFormData = inputData instanceof FormData;
        const isManualEntry = !isFormData;

        // Chuẩn hóa dữ liệu đầu vào
        const rawData = {
            name: isFormData ? inputData.get('name')?.trim() : inputData.fullName?.trim(),
            address: isFormData ? inputData.get('address')?.trim() : inputData.address?.trim(),
            phone: isFormData ? inputData.get('phone')?.trim() : inputData.phone?.trim(),
            email: isFormData ? inputData.get('email')?.trim() : inputData.email?.trim(),
            bd: isFormData ? inputData.get('bd') : inputData.dob,
            service: isFormData ? inputData.get('service')?.trim() : inputData.service?.trim(),
            source: isFormData ? inputData.get('source')?.trim() : '68b5ebb3658a1123798c0ce4',
            sourceName: isFormData ? inputData.get('sourceName')?.trim() : 'Trực tiếp',
        };

        let user = null;
        if (isManualEntry) {
            user = await checkAuthToken();
            if (!user || !user.id) {
                return { ok: false, message: 'Bạn cần đăng nhập để thêm khách hàng.' };
            }
        }

        // Validate dữ liệu
        if (!rawData.name) return { ok: false, message: 'Vui lòng nhập họ và tên.' };
        if (!rawData.phone) return { ok: false, message: 'Vui lòng nhập số điện thoại.' };

        const normalizedPhone = normalizePhone(rawData.phone);
        if (!/^0\d{9}$/.test(normalizedPhone)) {
            return { ok: false, message: 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).' };
        }

        let birthDate = rawData.bd ? new Date(rawData.bd) : null;
        if (birthDate && isNaN(birthDate.getTime())) {
            return { ok: false, message: 'Ngày sinh không hợp lệ.' };
        }

        if (rawData.source && !mongoose.Types.ObjectId.isValid(rawData.source)) {
            return { ok: false, message: 'Nguồn dữ liệu không hợp lệ.' };
        }

        // Xử lý logic chính
        await dbConnect();
        const existingCustomer = await Customer.findOne({ phone: normalizedPhone });

        // TRƯỜNG HỢP 1: KHÁCH HÀNG ĐÃ TỒN TẠI -> CẬP NHẬT
        if (existingCustomer) {
            if (rawData.name && existingCustomer.name !== rawData.name) existingCustomer.name = rawData.name;
            if (rawData.address && existingCustomer.area !== rawData.address) existingCustomer.area = rawData.address;
            if (rawData.email && existingCustomer.email !== rawData.email) existingCustomer.email = rawData.email;
            if (birthDate && (!existingCustomer.bd || existingCustomer.bd.getTime() !== birthDate.getTime())) existingCustomer.bd = birthDate;

            existingCustomer.tags = [...new Set([...existingCustomer.tags, rawData.service].filter(Boolean))];
            existingCustomer.care.push({
                content: `Data trùng từ ${isManualEntry ? 'nhập liệu thủ công' : `form "${rawData.sourceName}"`}. Gộp và cập nhật hồ sơ.`,
                createBy: user?.id || '68b0af5cf58b8340827174e0',
                step: 1
            });
            existingCustomer.pipelineStatus[0] = 'duplicate_merged_1';
            existingCustomer.pipelineStatus[1] = 'duplicate_merged_1';
            await existingCustomer.save();
            // console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${existingCustomer._id}: pipelineStatus[0]=duplicate_merged_1, pipelineStatus[1]=duplicate_merged_1`);
            
            try {
                if (!Array.isArray(existingCustomer.assignees) || existingCustomer.assignees.length === 0) {
                    const svcId = rawData.service || (existingCustomer.tags?.[0] || null);
                    await autoAssignForCustomer(existingCustomer._id, { serviceId: svcId });
                }
            } catch (e) {
                console.error('[Action] Duplicate merge - auto-assign error:', e?.message || e);
            }
            
            revalidateData();
            sendUpdateNotification(existingCustomer, rawData, 'updated', isManualEntry).catch(err => {
                console.error('[addRegistrationToAction] Lỗi ngầm khi gửi thông báo cập nhật:', err);
            });
            return { ok: true, message: 'Số điện thoại đã tồn tại. Hồ sơ đã được cập nhật với thông tin mới.', type: 'merged' };
        }

        // TRƯỜNG HỢP 2: TẠO KHÁCH HÀNG MỚI
        const newCustomerData = {
            name: rawData.name,
            phone: normalizedPhone,
            email: rawData.email || '',
            area: rawData.address || '',
            tags: rawData.service ? [rawData.service] : [],
            bd: birthDate,
            pipelineStatus: ['new_unconfirmed_1', 'new_unconfirmed_1'],
            care: [{ content: 'Khách hàng được nhận hồ sơ vào hệ thống', createBy: user?.id || '68b0af5cf58b8340827174e0', step: 1 }],
            source: rawData.source,
            sourceDetails: rawData.sourceName,
            ...(user && { createdBy: user.id }),
        };

        const newCustomer = new Customer(newCustomerData);
        await newCustomer.save();
        // console.log(`[pipelineStatus] Tạo customer mới ${newCustomer._id} với pipelineStatus: pipelineStatus[0]=new_unconfirmed_1, pipelineStatus[1]=new_unconfirmed_1 (addRegistrationToAction)`);
        
        try {
        await autoAssignForCustomer(newCustomer._id, { serviceId: rawData.service || null });
    } catch (e) {
        console.error('[Action] Auto-assign theo ngành học lỗi:', e?.message || e);
        }
        
        revalidateData();
        
        // Chạy ngầm các tác vụ phụ:
        // 1. Gửi thông báo Zalo cho team (thông báo có khách hàng mới)
        sendUpdateNotification(newCustomer, rawData, 'created', isManualEntry).catch(err => {
            console.error('[addRegistrationToAction] Lỗi ngầm khi gửi thông báo tạo mới:', err);
        });
        
        // 2. Tìm UID và gửi tin nhắn xác nhận đến khách hàng
        processFindUidAndSendMessage(newCustomer).catch(err => {
            console.error('[addRegistrationToAction] Lỗi trong tác vụ nền (findUid & sendMessage):', err);
        });
        
        return { ok: true, message: 'Thêm khách hàng mới thành công!', type: 'created' };

    } catch (error) {
        console.error('[Action] Lỗi nghiêm trọng khi xử lý:', error);
        return { ok: false, message: 'Lỗi hệ thống, không thể xử lý yêu cầu.' };
    }
}

// Map để track các customer đã gửi thông báo (tránh gửi trùng)
const notificationSentMap = new Map(); // key: customerId, value: timestamp

/**
 * Hàm helper để gửi thông báo qua Google Apps Script.
 */
async function sendUpdateNotification(customer, rawData, type, isManualEntry) {
    try {
        const customerId = customer._id.toString();
        const now = Date.now();
        const DEBOUNCE_TIME = 30000; // 30 giây - tránh gửi trùng trong 30s
        
        // Kiểm tra xem đã gửi thông báo cho customer này trong 30s gần đây chưa
        const lastSentTime = notificationSentMap.get(customerId);
        if (lastSentTime && (now - lastSentTime) < DEBOUNCE_TIME) {
            // console.log(`[sendUpdateNotification] ⚠️ Bỏ qua vì đã gửi thông báo cho KH ${customerId} trong ${Math.round((now - lastSentTime) / 1000)}s gần đây`);
            return;
        }
        
        // Đánh dấu đã gửi thông báo
        notificationSentMap.set(customerId, now);
        
        // Cleanup map sau 1 phút để tránh memory leak
        setTimeout(() => {
            notificationSentMap.delete(customerId);
        }, 60000);
        
        // 1. Lấy thông tin ngành học
        let service = await service_data();
        service = service.find(item => item._id === rawData.service);

        // 2. Format thời gian
        const createAt = new Date();
        const formattedCreateAt = createAt.toLocaleString('vi-VN', { 
            timeZone: 'Asia/Ho_Chi_Minh' 
        });

        // 3. Tạo title (tiêu đề)
        const title = type === 'created'
            ? `📅 Đăng ký mới từ ${isManualEntry ? 'nhập liệu thủ công' : `Form "${rawData.sourceName}"`}`
            : `🔄 Cập nhật hồ sơ từ ${isManualEntry ? 'nhập liệu thủ công' : `Form "${rawData.sourceName}"`}`;

        // 4. Format tin nhắn hoàn chỉnh
        const message = `${title}
-----------------------------------
Họ và tên: ${customer.name}
Liên hệ: ${customer.phone}
Ngành học quan tâm: ${service?.name || 'Không có'}
Thời gian: ${formattedCreateAt}`;

        // 5. Gửi qua Google Apps Script
        await sendGP(message);
        console.log(`[sendUpdateNotification] ✅ Đã gửi thông báo Apps Script cho KH ${customerId} (Loại: ${type})`);
    } catch (err) {
        const customerId = customer._id?.toString() || 'unknown';
        console.error(`[sendUpdateNotification] ❌ Lỗi gửi Apps Script cho KH ${customerId}:`, err);
        // Xóa khỏi map nếu có lỗi để có thể retry
        notificationSentMap.delete(customerId);
        throw err; // Re-throw để caller có thể handle
    }
}

/**
 * Hàm helper để chuẩn hóa số điện thoại.
 */
function normalizePhone(phone) {
    const t = (phone ?? '').trim().replace(/\D/g, ''); // Chỉ giữ số
    if (!t) return '';
    if (t.length === 9 && ['3', '5', '7', '8', '9'].includes(t[0])) return '0' + t;
    if (t.startsWith('84')) return '0' + t.substring(2);
    return t.startsWith('0') ? t : '0' + t;
}

/**
 * Hàm helper để chuẩn hóa UID Zalo.
 */
function normalizeUid(u) {
    const s = String(u ?? '').trim();
    const digits = s.replace(/\D/g, '');
    return digits;
}

/**
 * Hàm helper để format message với các placeholder.
 */
async function formatMessage(template, targetDoc, zaloAccountDoc) {
    if (!template) return "";
    let message = template;

    message = message.replace(/{name}/g, targetDoc.name || "");
    message = message.replace(/{nameparent}/g, targetDoc.nameparent || "");
    message = message.replace(/{namezalo}/g, targetDoc.zaloname || "");

    const variantPlaceholders = message.match(/{[^{}]+}/g) || [];
    for (const placeholder of variantPlaceholders) {
        const variantName = placeholder.slice(1, -1);
        const variant = await Variant.findOne({ name: variantName }).lean();
        if (variant && variant.phrases && variant.phrases.length > 0) {
            const randomPhrase = variant.phrases[Math.floor(Math.random() * variant.phrases.length)];
            message = message.replace(placeholder, randomPhrase);
        }
    }

    return message;
}

/**
 * Hàm helper để tìm tài khoản Zalo khả dụng.
 */
async function findNextAvailableZaloAccount() {
    // Pick newest accounts first (last rows)
    const allAccounts = await ZaloAccount.find({}).sort({ _id: -1 }).lean();
    
    if (allAccounts.length === 0) {
        console.warn('[findNextAvailableZaloAccount] Không có bất kỳ tài khoản Zalo nào trong hệ thống.');
        return null;
    }
    
    // Tìm tài khoản có rate limit > 0
    for (const account of allAccounts) {
        if (account.rateLimitPerHour > 0 && account.rateLimitPerDay > 0) {
            return account;
        }
    }
    
    console.error('[findNextAvailableZaloAccount] Không tìm thấy tài khoản Zalo hợp lệ.');
    return null;
}

/**
 * Hàm xử lý nền: Tìm UID Zalo và gửi tin nhắn xác nhận.
 */
async function processFindUidAndSendMessage(newCustomer) {
    console.log('[processFindUidAndSendMessage] ====================================');
    console.log('[processFindUidAndSendMessage] Bắt đầu xử lý tìm UID và gửi tin nhắn cho KH:', newCustomer._id);
    console.log('[processFindUidAndSendMessage] Customer name:', newCustomer.name);
    console.log('[processFindUidAndSendMessage] Customer phone:', newCustomer.phone);
    
    const customerId = newCustomer._id;
    const phone = newCustomer.phone;
    let findUidStatus = "thất bại";
    let renameStatus = "không thực hiện";
    let messageStatus = "không thực hiện";
    
    // Lấy workflow ID từ database thay vì hardcode
    const findUidWorkflowId = await getWorkflowIdByName('B1.*Tiếp nhận');
    if (!findUidWorkflowId) {
        console.error('[processFindUidAndSendMessage] Không tìm thấy workflow "B1: Tiếp nhận & xử lý Data từ quảng cáo và nguồn ngoài"');
    }
    
    // Lưu workflow đầu tiên (WF1) với success: null (đang chạy)
    if (findUidWorkflowId) {
        try {
            const customer = await Customer.findById(customerId);
            if (customer) {
                // Kiểm tra và khởi tạo workflowTemplates nếu cần
                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                    customer.workflowTemplates = {};
                }
                customer.workflowTemplates[findUidWorkflowId] = { success: null };
                customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                await customer.save();
                // console.log('[processFindUidAndSendMessage] Đã lưu workflow đầu tiên (WF1) với success: null, workflowTemplates:', JSON.stringify(customer.workflowTemplates));
            } else {
                console.error('[processFindUidAndSendMessage] Không tìm thấy customer với ID:', customerId);
            }
        } catch (error) {
            console.error('[processFindUidAndSendMessage] Lỗi khi lưu workflow đầu tiên:', error);
            console.error('[processFindUidAndSendMessage] Error stack:', error.stack);
        }
    }
    
    try {
        await dbConnect();
        
        // 1. Tìm tài khoản Zalo khả dụng
        let selectedZalo = await findNextAvailableZaloAccount();
        if (!selectedZalo) {
            console.error('[processFindUidAndSendMessage] ❌ Không tìm thấy tài khoản Zalo khả dụng');
            return;
        }
        
        // console.log('[processFindUidAndSendMessage] ✅ Đã chọn tài khoản Zalo:', selectedZalo.name, 'UID:', selectedZalo.uid);
        
        // 2. Format phone number (đảm bảo có +84)
        let formattedPhone = phone.toString().trim();
        if (formattedPhone.startsWith('+84')) {
            // Giữ nguyên
        } else if (formattedPhone.startsWith('0')) {
            formattedPhone = `+84${formattedPhone.substring(1)}`;
        } else {
            formattedPhone = `+84${formattedPhone}`;
        }
        
        // 3. Tìm UID Zalo
        // console.log('[processFindUidAndSendMessage] Đang tìm UID Zalo cho số điện thoại:', formattedPhone);
        let findUidResponse = await actionZalo({
            phone: formattedPhone,
            uid: selectedZalo.uid,
            actionType: "findUid",
        });
        
        // Lưu ID của log đầu tiên để có thể xóa nếu retry thành công
        let firstLogId = null;
        
        // Log kết quả findUid
        const firstLog = await Logs.create({
            status: {
                status: findUidResponse.status,
                message: findUidResponse.content?.error_message || findUidResponse.message || '',
                data: {
                    error_code: findUidResponse.content?.error_code,
                    error_message: findUidResponse.content?.error_message,
                },
            },
            type: "findUid",
            createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
            customer: customerId,
            zalo: selectedZalo._id,
        });
        firstLogId = firstLog._id;
        
        // Xử lý retry nếu tài khoản Zalo ngừng hoạt động
        if (!findUidResponse.status && findUidResponse.message?.includes('ngừng hoạt động')) {
            // console.log('[processFindUidAndSendMessage] ⚠️ Tài khoản Zalo đã ngừng hoạt động. Đang thử với tài khoản khác...');
            const allAccounts = await ZaloAccount.find({ _id: { $ne: selectedZalo._id } }).sort({ _id: -1 }).lean();
            
            for (const retryZalo of allAccounts) {
                if (retryZalo.rateLimitPerHour > 0 && retryZalo.rateLimitPerDay > 0) {
                    // console.log('[processFindUidAndSendMessage] Đang retry với tài khoản:', retryZalo.name);
                    selectedZalo = retryZalo;
                    
                    findUidResponse = await actionZalo({
                        phone: formattedPhone,
                        uid: retryZalo.uid,
                        actionType: "findUid",
                    });
                    
                    if (findUidResponse.status) {
                        // Retry thành công - XÓA LOG ĐẦU TIÊN (thất bại) và chỉ giữ log thành công
                        if (firstLogId) {
                            await Logs.deleteOne({ _id: firstLogId });
                            // console.log('[processFindUidAndSendMessage] 🗑️ Đã xóa log thất bại đầu tiên (ID: ' + firstLogId + ') vì retry thành công');
                        }
                        
                        // Log retry thành công
                        await Logs.create({
                            status: {
                                status: true,
                                message: `✅ Tìm thành công UID Zalo (retry với tài khoản khác)`,
                                data: {
                                    error_code: findUidResponse.content?.error_code || 0,
                                    error_message: findUidResponse.content?.error_message || 'Thành công',
                                },
                            },
                            type: "findUid",
                            createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                            customer: customerId,
                            zalo: retryZalo._id,
                        });
                        
                        findUidStatus = "thành công (retry)";
                        console.log('[processFindUidAndSendMessage] ✅ Retry thành công với tài khoản:', retryZalo.name);
                        break;
                    } else {
                        // Retry thất bại - log lại nhưng không xóa log đầu tiên
                        await Logs.create({
                            status: {
                                status: false,
                                message: `Retry thất bại với tài khoản ${retryZalo.name}: ${findUidResponse.content?.error_message || findUidResponse.message || ''}`,
                                data: {
                                    error_code: findUidResponse.content?.error_code,
                                    error_message: findUidResponse.content?.error_message,
                                },
                            },
                            type: "findUid",
                            createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                            customer: customerId,
                            zalo: retryZalo._id,
                        });
                    }
                }
            }
        }
        
        // 4. Lưu UID vào Customer nếu tìm thành công
        const raw = findUidResponse?.content ?? null;
        const rawUid = raw?.data?.uid ?? null;
        const normalizedUid = normalizeUid(rawUid);
        
        if (findUidResponse.status === true && normalizedUid) {
            if (findUidStatus !== "thành công (retry)") {
                findUidStatus = "thành công";
            }
            
            // Cập nhật rate limit
            await ZaloAccount.updateOne(
                { _id: selectedZalo._id },
                { $inc: { rateLimitPerHour: -1, rateLimitPerDay: -1 } }
            );
            
            // Lưu UID và thông tin Zalo vào Customer
            await Customer.updateOne(
                { _id: customerId },
                {
                    $set: {
                        zaloavt: raw?.data?.avatar || null,
                        zaloname: raw?.data?.zalo_name || null,
                    },
                    $push: {
                        uid: {
                            zalo: selectedZalo._id,
                            uid: normalizedUid
                        },
                        care: {
                            content: `✅ Tìm thành công UID Zalo: ${normalizedUid}`,
                            createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                            step: 1,
                            createAt: new Date()
                        }
                    }
                }
            );
            
            // console.log('[processFindUidAndSendMessage] ✅ Đã cập nhật UID (' + normalizedUid + ') và thêm care log cho KH:', customerId);
            
            // Revalidate để cập nhật UI ngay lập tức
            revalidateData();
            
            // 5. Tag (đổi tên gợi nhớ) - Optional
            try {
                const form = await Form.findById(newCustomer.source).select('name').lean();
                const srcName = form ? form.name : String(newCustomer.source || 'Unknown');
                const newZaloName = `${newCustomer.name}_${srcName}`;
                
                const renameResponse = await actionZalo({
                    uid: selectedZalo.uid,
                    uidPerson: normalizedUid,
                    actionType: 'tag',
                    message: newZaloName,
                    phone: formattedPhone
                });
                
                await Logs.create({
                    message: newZaloName,
                    status: {
                        status: renameResponse.status,
                        message: renameResponse.content?.error_message || renameResponse.message || '',
                        data: {
                            error_code: renameResponse.content?.error_code,
                            error_message: renameResponse.content?.error_message,
                        },
                    },
                    type: "tag",
                    createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                    customer: customerId,
                    zalo: selectedZalo._id,
                });
                
                if (renameResponse.status) {
                    renameStatus = "thành công";
                } else {
                    renameStatus = "thất bại";
                }
            } catch (renameError) {
                console.error('[processFindUidAndSendMessage] Lỗi trong lúc đổi tên gợi nhớ:', renameError.message);
                renameStatus = "thất bại";
            }
            
            // 6. Gửi tin nhắn xác nhận
            try {
                const messageSetting = await Setting.findOne({ _id: '68b0c30b3c4e62132237be77' }).lean();
                
                if (messageSetting && messageSetting.content) {
                    let template = messageSetting.content;
                    
                    // Xử lý placeholder {nameform}
                    if (template.includes("{nameform}")) {
                        const form = await Form.findById(newCustomer.source).select('name').lean();
                        template = template.replace(/{nameform}/g, form ? form.name : "");
                    }
                    
                    // Format message với các placeholder khác
                    const doc = await Customer.findById(customerId).lean();
                    const finalMessageToSend = await formatMessage(template, doc, selectedZalo);
                    
                    if (finalMessageToSend) {
                        // console.log('[processFindUidAndSendMessage] Đang gửi tin nhắn xác nhận...');
                        const sendMessageResponse = await actionZalo({
                            uid: selectedZalo.uid,
                            uidPerson: normalizedUid,
                            actionType: "sendMessage",
                            message: finalMessageToSend,
                            phone: formattedPhone
                        });
                        
                        // Log kết quả gửi tin nhắn
                        await Logs.create({
                            status: {
                                status: sendMessageResponse.status,
                                message: finalMessageToSend || 'Không có tin nhắn gửi đi',
                                data: {
                                    error_code: sendMessageResponse.content?.error_code,
                                    error_message: sendMessageResponse.content?.error_message,
                                },
                            },
                            type: "sendMessage",
                            createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                            customer: customerId,
                            zalo: selectedZalo._id,
                        });
                        
                        // Kiểm tra cả status và error_code để xác định thành công
                        const isSuccess = sendMessageResponse.status === true || sendMessageResponse.content?.error_code === 0;
                        
                        if (isSuccess) {
                            messageStatus = "thành công";
                            // console.log('[processFindUidAndSendMessage] ✅ Đã gửi tin nhắn xác nhận thành công');
                            // console.log('[processFindUidAndSendMessage] Response details:', {
                            //     status: sendMessageResponse.status,
                            //     error_code: sendMessageResponse.content?.error_code,
                            //     error_message: sendMessageResponse.content?.error_message
                            // });
                            
                            // Cập nhật care log và pipelineStatus khi thành công
                            const customer = await Customer.findById(customerId);
                            if (customer) {
                                customer.care.push({
                                    content: `✅ [Gửi tin nhắn Zalo] đã hoàn thành thành công: ${finalMessageToSend.substring(0, 100)}${finalMessageToSend.length > 100 ? '...' : ''}`,
                                    createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                                    step: 2,
                                    createAt: new Date()
                                });
                                customer.pipelineStatus[0] = 'msg_success_2';
                                customer.pipelineStatus[2] = 'msg_success_2';
                                console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus[0]=msg_success_2, pipelineStatus[2]=msg_success_2`);
                                
                                // Lưu workflow WF2 (B2: Gửi tin nhắn) vào workflowTemplates
                                const messageWorkflowId = await getWorkflowIdByName('B2.*Gửi tin nhắn');
                                if (messageWorkflowId) {
                                    if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                                        customer.workflowTemplates = {};
                                    }
                                    if (!customer.workflowTemplates[messageWorkflowId]) {
                                        customer.workflowTemplates[messageWorkflowId] = { success: null };
                                    }
                                    customer.workflowTemplates[messageWorkflowId].success = true;
                                    customer.markModified('workflowTemplates');
                                    // console.log(`[processFindUidAndSendMessage] Đã lưu workflow WF2 vào workflowTemplates: ${messageWorkflowId}, success: true`);
                                }
                                
                                await customer.save();
                            }
                        } else {
                            messageStatus = "thất bại";
                            const errorMsg = sendMessageResponse.content?.error_message || sendMessageResponse.message || 'Không xác định';
                            console.error('[processFindUidAndSendMessage] ❌ Gửi tin nhắn thất bại:', {
                                status: sendMessageResponse.status,
                                error_code: sendMessageResponse.content?.error_code,
                                error_message: errorMsg
                            });
                            
                            // Cập nhật care log và pipelineStatus khi thất bại
                            const customer = await Customer.findById(customerId);
                            if (customer) {
                                customer.care.push({
                                    content: `❌ [Gửi tin nhắn Zalo] thất bại: ${errorMsg}`,
                                    createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                                    step: 2,
                                    createAt: new Date()
                                });
                                customer.pipelineStatus[0] = 'msg_error_2';
                                customer.pipelineStatus[2] = 'msg_error_2';
                                // console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus[0]=msg_error_2, pipelineStatus[2]=msg_error_2`);
                                
                                // Lưu workflow WF2 (B2: Gửi tin nhắn) vào workflowTemplates với success: false
                                const messageWorkflowId = await getWorkflowIdByName('B2.*Gửi tin nhắn');
                                if (messageWorkflowId) {
                                    if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                                        customer.workflowTemplates = {};
                                    }
                                    if (!customer.workflowTemplates[messageWorkflowId]) {
                                        customer.workflowTemplates[messageWorkflowId] = { success: null };
                                    }
                                    customer.workflowTemplates[messageWorkflowId].success = false;
                                    customer.markModified('workflowTemplates');
                                    // console.log(`[processFindUidAndSendMessage] Đã lưu workflow WF2 vào workflowTemplates: ${messageWorkflowId}, success: false`);
                                }
                                
                                await customer.save();
                            }
                        }
                    } else {
                        messageStatus = "bỏ qua (template rỗng)";
                    }
                } else {
                    messageStatus = "bỏ qua (không có template)";
                    console.log('[processFindUidAndSendMessage] ⚠️ Không tìm thấy template tin nhắn xác nhận');
                }
            } catch (messageError) {
                console.error('[processFindUidAndSendMessage] Lỗi trong lúc gửi tin nhắn:', messageError.message);
                messageStatus = "thất bại";
            }
            
            // Cập nhật success cho workflow đầu tiên (WF1) dựa trên kết quả của tất cả các hành động
            // Workflow thành công nếu findUid thành công (tag và message có thể bỏ qua)
            const workflowSuccess = findUidStatus === "thành công" || findUidStatus === "thành công (retry)";
            if (findUidWorkflowId) {
                try {
                    const customer = await Customer.findById(customerId);
                    if (customer) {
                        // Kiểm tra và khởi tạo workflowTemplates nếu cần
                        if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                            customer.workflowTemplates = {};
                        }
                        if (!customer.workflowTemplates[findUidWorkflowId]) {
                            customer.workflowTemplates[findUidWorkflowId] = {};
                        }
                        customer.workflowTemplates[findUidWorkflowId].success = workflowSuccess;
                        customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                        await customer.save();
                        // console.log(`[processFindUidAndSendMessage] Đã cập nhật success cho workflow đầu tiên (WF1): ${workflowSuccess} (findUid: ${findUidStatus}, tag: ${renameStatus}, message: ${messageStatus})`);
                        // console.log('[processFindUidAndSendMessage] workflowTemplates sau khi cập nhật:', JSON.stringify(customer.workflowTemplates));
                    } else {
                        console.error('[processFindUidAndSendMessage] Không tìm thấy customer với ID:', customerId);
                    }
                } catch (error) {
                    console.error('[processFindUidAndSendMessage] Lỗi khi cập nhật success cho workflow đầu tiên:', error);
                    console.error('[processFindUidAndSendMessage] Error stack:', error.stack);
                }
            }
            
            // Revalidate để cập nhật UI
            revalidateData();
        } else {
            console.warn('[processFindUidAndSendMessage] ⚠️ Không tìm thấy UID hợp lệ cho KH:', customerId);
            findUidStatus = "thất bại";
            
            // Thêm care log khi tìm UID thất bại
            const errorMsg = findUidResponse?.content?.error_message || findUidResponse?.message || 'Không tìm thấy UID';
            const customer = await Customer.findById(customerId);
            if (customer) {
                customer.care.push({
                    content: `❌ Tìm UID thất bại: ${errorMsg}`,
                    createBy: newCustomer.createdBy || '68b0af5cf58b8340827174e0',
                    step: 1,
                    createAt: new Date()
                });
                customer.uid = null; // Đánh dấu là tìm thất bại
                // Kiểm tra và khởi tạo workflowTemplates nếu cần
                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                    customer.workflowTemplates = {};
                }
                // Lấy workflow ID từ database
                const findUidWorkflowId = await getWorkflowIdByName('B1.*Tiếp nhận');
                if (findUidWorkflowId) {
                    if (!customer.workflowTemplates[findUidWorkflowId]) {
                        customer.workflowTemplates[findUidWorkflowId] = {};
                    }
                    customer.workflowTemplates[findUidWorkflowId].success = false;
                }
                customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                await customer.save();
                // console.log('[processFindUidAndSendMessage] Đã cập nhật workflowTemplates khi tìm UID thất bại:', JSON.stringify(customer.workflowTemplates));
            }
            
            // Revalidate để cập nhật UI
            revalidateData();
        }
        
    } catch (e) {
        console.error('[processFindUidAndSendMessage] ❌ Lỗi nghiêm trọng trong tiến trình nền cho KH', customerId, ':', e.message);
        console.error('[processFindUidAndSendMessage] Stack trace:', e.stack);
    } finally {
        // Gửi thông báo tóm tắt kết quả
        const finalMessage = `
Hành động xác nhận khách hàng mới: ${phone}
- Tìm uid người dùng: ${findUidStatus}
- Đổi tên gợi nhớ: ${renameStatus}
- Đã gửi tin nhắn: ${messageStatus}`.trim();
        
        try {
            await sendGP(finalMessage);
            console.log('[processFindUidAndSendMessage] ✅ Gửi thông báo thành công');
        } catch (gpError) {
            console.error('[processFindUidAndSendMessage] ❌ Gửi thông báo thất bại:', gpError.message);
        }
        
        console.log('[processFindUidAndSendMessage] ====================================');
    }
}