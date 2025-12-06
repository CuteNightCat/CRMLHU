'use server';
import { unstable_cache as nextCache, revalidateTag } from 'next/cache';
import connectDB from "@/config/connectDB";
import Customer from "@/models/customer.model";
import mongoose from 'mongoose';
import checkAuthToken from '@/utils/checktoken';
import User from '@/models/users';
import '@/models/zalo.model' // Giữ lại nếu Zalo Account vẫn liên quan đến Customer
import ScheduledJob from "@/models/schedule";
import { reloadCustomers } from '@/data/customers/wraperdata.db';
import Service from '@/models/services.model';
import autoAssignForCustomer from '@/utils/autoAssign';
import { uploadFileToDrive } from '@/function/drive/image';
import RepetitionTime from '@/models/repetitionTime.model';
import { WorkflowTemplate } from '@/models/workflows.model';
// Các import không liên quan đến Student đã được bỏ đi
// import { ProfileDefault, statusStudent } from '@/data/default'; // Không dùng cho Customer
// import { getZaloUid } from '@/function/drive/appscript'; // Không dùng cho Customer (nếu không chuyển đổi)

const matchesAnyRole = (userRoles, allowedRoles = []) => {
    const roles = Array.isArray(userRoles) ? userRoles : userRoles ? [userRoles] : [];
    return roles.some((role) => allowedRoles.includes(role));
};

export async function getCombinedData(params) {
    const cachedData = nextCache(
        async (currentParams) => {
            await connectDB();

            const page = Number(currentParams.page) || 1;
            const limit = Number(currentParams.limit) || 10;
            const query = currentParams.query || '';
            const skip = (page - 1) * limit;

            const filterConditions = [];

            // Tìm kiếm theo tên/SĐT
            if (query) {
                filterConditions.push({
                    $or: [
                        { name: { $regex: query, $options: 'i' } },
                        { phone: { $regex: query, $options: 'i' } },
                    ],
                });
            }

            // Lọc theo nguồn
            // Phân biệt nguồn Form (ObjectId) và nguồn Tin nhắn/Đặc biệt (String)
            if (currentParams.source) {
                // Kiểm tra xem có phải là ObjectId hợp lệ không (nguồn Form)
                if (mongoose.Types.ObjectId.isValid(currentParams.source)) {
                    // Nguồn Form: Filter theo field 'source'
                    filterConditions.push({ 
                        source: new mongoose.Types.ObjectId(currentParams.source) 
                    });
                } else {
                    // Nguồn Tin nhắn hoặc đặc biệt: Filter theo field 'sourceDetails'
                    filterConditions.push({ 
                        sourceDetails: currentParams.source 
                    });
                }
            }

            // Lọc theo TRẠNG THÁI dựa trên phần tử đầu tiên pipelineStatus[0]
            // + fallback legacy (bỏ hậu tố _1/_2/... nếu còn dữ liệu cũ)
            if (currentParams.pipelineStatus) {
                const v = String(currentParams.pipelineStatus);
                const legacy = v.replace(/_\d+$/, ''); // "new_unconfirmed_1" -> "new_unconfirmed"
                filterConditions.push({
                    $or: [{ 'pipelineStatus.0': v }, { 'pipelineStatus.0': legacy }],
                });
            }

        // Lọc theo NGÀNH HỌC QUAN TÂM (tags)
            if (currentParams.tags) {
                if (currentParams.tags === 'null') {
                    filterConditions.push({
                        $or: [{ tags: { $exists: false } }, { tags: null }, { tags: { $size: 0 } }],
                    });
                } else {
                    const tagsAsObjectIds = currentParams.tags
                        .split(',')
                        .map((id) => id.trim())
                        .filter((id) => mongoose.Types.ObjectId.isValid(id))
                        .map((id) => new mongoose.Types.ObjectId(id));
                    if (tagsAsObjectIds.length > 0) {
                        filterConditions.push({ tags: { $in: tagsAsObjectIds } });
                    }
                }
            }

            // Lọc theo người phụ trách trong mảng assignees
            if (currentParams.assignee && mongoose.Types.ObjectId.isValid(currentParams.assignee)) {
                filterConditions.push({ 'assignees.user': new mongoose.Types.ObjectId(currentParams.assignee) });
            }

            // Zalo phase
            if (currentParams.zaloPhase) {
                filterConditions.push({ zaloPhase: currentParams.zaloPhase });
            }

            // Khoảng ngày tạo
            if (currentParams.startDate && currentParams.endDate) {
                const startDate = new Date(currentParams.startDate);
                startDate.setHours(0, 0, 0, 0);
                const endDate = new Date(currentParams.endDate);
                endDate.setHours(23, 59, 59, 999);
                filterConditions.push({ createAt: { $gte: startDate, $lte: endDate } });
            }

            const matchStage =
                filterConditions.length > 0 ? { $match: { $and: filterConditions } } : { $match: {} };

            // Pipeline tổng hợp (giữ nguyên logic hiện tại)
            const pipeline = [
                matchStage,
                { $lookup: { from: 'forms', localField: 'source', foreignField: '_id', as: 'sourceInfo' } },
                { $unwind: { path: '$sourceInfo', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        sourceName: '$sourceInfo.name',
                        lastCareNote: { $last: '$care' },
                    },
                },
                // Lấy thẻ ngành học (tags) để hiển thị tên
                { $lookup: { from: 'services', localField: 'tags', foreignField: '_id', as: 'tags' } },
                { $project: { sourceInfo: 0 } },
                { $sort: { createAt: -1 } },
                {
                    $facet: {
                        paginatedResults: [{ $skip: skip }, { $limit: limit }],
                        totalCount: [{ $count: 'count' }],
                    },
                },
            ];

            const results = await Customer.aggregate(pipeline).exec();
            let paginatedData = results[0]?.paginatedResults || [];

            // ===== Populate user cho care & assignees (giữ nguyên) =====
            if (paginatedData.length > 0) {
                const userIds = new Set();

                paginatedData.forEach((customer) => {
                    customer.care?.forEach((note) => {
                        if (note.createBy) userIds.add(String(note.createBy));
                    });
                    customer.assignees?.forEach((assignment) => {
                        if (assignment.user) userIds.add(String(assignment.user));
                    });
                });

                if (userIds.size > 0) {
                    const users = await User.find({ _id: { $in: Array.from(userIds) } })
                        .select('name avt')
                        .lean();
                    const userMap = new Map(users.map((u) => [String(u._id), u]));

                    paginatedData.forEach((customer) => {
                        customer.ccare = customer.care; // no-op (giữ)
                        customer.care?.forEach((note) => {
                            if (note.createBy && userMap.has(String(note.createBy))) {
                                note.createBy = userMap.get(String(note.createBy));
                            }
                        });
                        if (
                            customer.lastCareNote?.createBy &&
                            userMap.has(String(customer.lastCareNote.createBy))
                        ) {
                            customer.lastCareNote.createBy = userMap.get(String(customer.lastCareNote.createBy));
                        }
                        customer.assignees?.forEach((assignment) => {
                            if (assignment.user && userMap.has(String(assignment.user))) {
                                assignment.user = userMap.get(String(assignment.user));
                            }
                        });
                    });
                }
            }

            // ====== Bổ sung: populate đầy đủ serviceDetails ======
            // Thu thập ID Users & Services từ serviceDetails để query 1 lần
            const sdUserIds = new Set();
            const sdServiceIds = new Set();

            const collectFromServiceDetail = (sd) => {
                // Users
                if (sd.closedBy) sdUserIds.add(String(sd.closedBy));
                if (sd.approvedBy) sdUserIds.add(String(sd.approvedBy));
                (sd.payments || []).forEach((p) => {
                    if (p.receivedBy) sdUserIds.add(String(p.receivedBy));
                });
                (sd.commissions || []).forEach((cm) => {
                    if (cm.user) sdUserIds.add(String(cm.user));
                });
                (sd.costs || []).forEach((c) => {
                    if (c.createdBy) sdUserIds.add(String(c.createdBy));
                });

                // Services
                if (sd.selectedService) sdServiceIds.add(String(sd.selectedService));
                (sd.interestedServices || []).forEach((sid) => sdServiceIds.add(String(sid)));
            };

            paginatedData.forEach((customer) => {
                const list = Array.isArray(customer.serviceDetails)
                    ? customer.serviceDetails
                    : customer.serviceDetails
                        ? [customer.serviceDetails]
                        : [];
                list.forEach(collectFromServiceDetail);
            });

            // Query users/services một lần
            let sdUserMap = new Map();
            let sdServiceMap = new Map();
            if (sdUserIds.size > 0) {
                const users = await User.find({ _id: { $in: Array.from(sdUserIds) } })
                    .select('name avt')
                    .lean();
                sdUserMap = new Map(users.map((u) => [String(u._id), u]));
            }
            if (sdServiceIds.size > 0) {
                const services = await Service.find({ _id: { $in: Array.from(sdServiceIds) } })
                    .select('name code price')
                    .lean();
                sdServiceMap = new Map(services.map((s) => [String(s._id), s]));
            }

            // Map dữ liệu vào từng serviceDetails
            paginatedData.forEach((customer) => {
                const list = Array.isArray(customer.serviceDetails)
                    ? customer.serviceDetails
                    : customer.serviceDetails
                        ? [customer.serviceDetails]
                        : [];

                // Gán lại đã map → đảm bảo luôn là mảng trong output
                customer.serviceDetails = list.map((sd) => {
                    const cloned = { ...sd };

                    // Users
                    if (cloned.closedBy && sdUserMap.has(String(cloned.closedBy))) {
                        cloned.closedBy = sdUserMap.get(String(cloned.closedBy));
                    }
                    if (cloned.approvedBy && sdUserMap.has(String(cloned.approvedBy))) {
                        cloned.approvedBy = sdUserMap.get(String(cloned.approvedBy));
                    }
                    if (Array.isArray(cloned.payments)) {
                        cloned.payments = cloned.payments.map((p) => {
                            const cp = { ...p };
                            if (cp.receivedBy && sdUserMap.has(String(cp.receivedBy))) {
                                cp.receivedBy = sdUserMap.get(String(cp.receivedBy));
                            }
                            return cp;
                        });
                    }
                    if (Array.isArray(cloned.commissions)) {
                        cloned.commissions = cloned.commissions.map((cm) => {
                            const ccm = { ...cm };
                            if (ccm.user && sdUserMap.has(String(ccm.user))) {
                                ccm.user = sdUserMap.get(String(ccm.user));
                            }
                            return ccm;
                        });
                    }
                    if (Array.isArray(cloned.costs)) {
                        cloned.costs = cloned.costs.map((c) => {
                            const cc = { ...c };
                            if (cc.createdBy && sdUserMap.has(String(cc.createdBy))) {
                                cc.createdBy = sdUserMap.get(String(cc.createdBy));
                            }
                            return cc;
                        });
                    }

                    // Services
                    if (cloned.selectedService && sdServiceMap.has(String(cloned.selectedService))) {
                        cloned.selectedService = sdServiceMap.get(String(cloned.selectedService));
                    }
                    if (Array.isArray(cloned.interestedServices)) {
                        cloned.interestedServices = cloned.interestedServices
                            .map((sid) => sdServiceMap.get(String(sid)))
                            .filter(Boolean); // giữ các service tìm thấy
                    }

                    return cloned;
                });
            });

            // Kết quả cuối
            const plainData = JSON.parse(JSON.stringify(paginatedData));
            return {
                data: plainData,
                total: results[0]?.totalCount[0]?.count || 0,
            };
        },
        ['data-by-type'],
        { tags: ['combined-data'], revalidate: 3600 }
    );

    return cachedData(params);
}


export async function revalidateData() {
    try {
        revalidateTag('combined-data');
    } catch (e) {
        // Ignore if called in an unsupported context (e.g., during render)
    }
    try {
        await reloadCustomers();
    } catch (e) {
        // Best-effort background reload; ignore errors
    }
}

export async function updateCustomerInfo(previousState, formData) {
    if (!formData) {
        return { success: false, error: 'Không nhận được dữ liệu từ form.' };
    }

    const id = formData.get('_id');
    if (!id) return { success: false, error: 'Thiếu ID khách hàng.' };

    try {
        // console.log('🚩Đi qua hàm updateCustomerInfo');
        await connectDB();

        // Lấy các trường cơ bản từ form
        const payload = {
            name: formData.get('name'),
            email: formData.get('email'),
            area: formData.get('area'),
            bd: formData.get('bd') ? new Date(formData.get('bd')) : null,
            // --- MỚI: Xử lý trường tags ---
            // formData.getAll() sẽ lấy tất cả giá trị có key là 'tags' thành một mảng
            tags: formData.getAll('tags'),
        };

        // Xử lý ảnh khách hàng
        const coverCustomerFile = formData.get('cover_customer');
        const coverCustomerIdToRemove = formData.get('cover_customer_id');

        // console.log('[updateCustomerInfo] coverCustomerFile:', coverCustomerFile);
        // console.log('[updateCustomerInfo] coverCustomerIdToRemove:', coverCustomerIdToRemove);

        // Nếu có ảnh mới: upload lên Google Drive
        if (coverCustomerFile && typeof coverCustomerFile === 'object' && 'size' in coverCustomerFile && coverCustomerFile.size > 0) {
            // console.log('[updateCustomerInfo] Uploading image to Drive...');
            const folderId = '1u-2ExUF5LOXB_3bOBbI1beNOWb47aEfQ';
            const uploadedFile = await uploadFileToDrive(coverCustomerFile, folderId);
            
            // console.log('[updateCustomerInfo] Upload result:', uploadedFile);
            
            if (uploadedFile?.id) {
                payload.cover_customer = uploadedFile.id;
                // console.log('[updateCustomerInfo] Set cover_customer to:', uploadedFile.id);
            } else {
                // console.error('[updateCustomerInfo] Upload failed, no ID returned');
                return { success: false, error: 'Tải ảnh lên Google Drive thất bại. Vui lòng thử lại.' };
            }
        } 
        // Nếu xóa ảnh: set cover_customer = null
        else if (coverCustomerIdToRemove === '') {
            console.log('[updateCustomerInfo] Removing cover_customer');
            payload.cover_customer = null;
        }

        // Lọc ra các giá trị null hoặc undefined (trừ cover_customer)
        // cover_customer phải được xử lý riêng để đảm bảo lưu đúng
        const coverCustomerValue = payload.cover_customer;
        delete payload.cover_customer; // Tạm thời xóa để xử lý riêng

        Object.keys(payload).forEach(key => {
            const value = payload[key];
            if (value === null || value === undefined || value === '') {
                delete payload[key];
            }
        });

        // Thêm lại cover_customer nếu có giá trị (kể cả null khi xóa)
        if (coverCustomerValue !== undefined) {
            payload.cover_customer = coverCustomerValue;
        }

        console.log('[updateCustomerInfo] Final payload:', payload);

        // Sử dụng $set để đảm bảo update đúng field
        await Customer.findByIdAndUpdate(id, { $set: payload });

        // Nếu vừa chọn ngành học (tags) và chưa có người phụ trách thì auto-assign ngay
        try {
            if (Array.isArray(payload.tags) && payload.tags.length > 0) {
                const fresh = await Customer.findById(id).select('assignees tags').lean();
                if (!fresh?.assignees || fresh.assignees.length === 0) {
                    // console.log('🚩Gọi autoAssignForCustomer từ updateCustomerInfo');
                    await autoAssignForCustomer(id, { serviceId: payload.tags[0] });
                }
            }
        } catch (e) {
            console.error('[updateCustomerInfo] Auto-assign after tag update error:', e?.message || e);
        }

        revalidateData();
        return { success: true, message: 'Cập nhật thông tin thành công!' };
    } catch (error) {
        console.error("Lỗi khi cập nhật khách hàng:", error);
        return { success: false, error: 'Lỗi server khi cập nhật.' };
    }
}

/**
 * Helper function để parse timeRepeate và tính toán milliseconds
 * @param {string} timeRepeate - Format: "1 seconds", "2 minutes", etc.
 * @returns {number} Milliseconds
 */
function parseTimeRepeateToMs(timeRepeate) {
    if (!timeRepeate) return 0;
    
    const parts = timeRepeate.toString().trim().split(' ');
    if (parts.length < 2) return 0;
    
    const value = parseInt(parts[0], 10) || 0;
    const unit = parts[1].toLowerCase();
    
    const unitToMs = {
        'seconds': 1000,
        'second': 1000,
        'giây': 1000,
        'minutes': 60 * 1000,
        'minute': 60 * 1000,
        'phút': 60 * 1000,
        'hours': 60 * 60 * 1000,
        'hour': 60 * 60 * 1000,
        'giờ': 60 * 60 * 1000,
        'days': 24 * 60 * 60 * 1000,
        'day': 24 * 60 * 60 * 1000,
        'ngày': 24 * 60 * 60 * 1000,
        'months': 30 * 24 * 60 * 60 * 1000,
        'month': 30 * 24 * 60 * 60 * 1000,
        'tháng': 30 * 24 * 60 * 60 * 1000,
    };
    
    return value * (unitToMs[unit] || 1000);
}

/**
 * Tính toán các thời gian thực thi workflow trong tương lai
 * @param {Date} startDay - Ngày bắt đầu kích hoạt
 * @param {number} repeatCount - Số lần lặp
 * @param {string} timeRepeate - Khoảng cách mỗi lần lặp (ví dụ: "1 seconds")
 * @returns {Date[]} Mảng các thời gian thực thi
 */
function calculateExecutionTimes(startDay, repeatCount, timeRepeate) {
    if (!startDay || !repeatCount || !timeRepeate) {
        return [];
    }
    
    const startTime = new Date(startDay);
    if (isNaN(startTime.getTime())) {
        return [];
    }
    
    const intervalMs = parseTimeRepeateToMs(timeRepeate);
    if (intervalMs <= 0) {
        return [];
    }
    
    const executionTimes = [];
    for (let i = 0; i < repeatCount; i++) {
        const executionTime = new Date(startTime.getTime() + (i * intervalMs));
        executionTimes.push(executionTime);
    }
    
    return executionTimes;
}

export async function updateSubWorkflowConfigAction(previousState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) return { success: false, message: 'Bạn cần đăng nhập để thực hiện hành động này.' };
    if (!matchesAnyRole(user.role, ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'])) {
        return { success: false, message: 'Bạn không có quyền thực hiện chức năng này' };
    }

    const customerId = formData.get('customerId');
    const workflowId = formData.get('workflowId');
    const repeat = formData.get('repeat');
    const timeRepeate = formData.get('timeRepeate');
    const startDay = formData.get('startDay');
    const switchButton = formData.get('switchButton');

    if (!customerId || !workflowId) {
        return { success: false, error: 'Thiếu thông tin khách hàng hoặc workflow.' };
    }

    try {
        await connectDB();
        const customer = await Customer.findById(customerId);
        if (!customer) {
            return { success: false, error: 'Không tìm thấy khách hàng.' };
        }

        // Lấy workflow template để biết workflow_position và thông tin khác
        const workflowTemplate = await WorkflowTemplate.findById(workflowId).lean();
        if (!workflowTemplate) {
            return { success: false, error: 'Không tìm thấy workflow template.' };
        }

        const workflowIdStr = workflowId.toString();
        const workflowPosition = workflowTemplate.workflow_position;
        const isSubWorkflow = workflowTemplate.isSubWorkflow === true;
        const workflowName = workflowTemplate.name || 'Unknown Workflow';

        // Kiểm tra và khởi tạo workflowTemplates nếu cần
        if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
            customer.workflowTemplates = {};
        }

        // Chuyển sang String để lưu vào RepetitionTime (schema dùng String)
        const customerIdStr = customerId.toString();
        const workflowIdStrForRepetition = workflowId.toString();

        // ========== BƯỚC 1: KHÔNG XÓA workflow con cũ ==========
        // Mỗi workflow con có vùng riêng trong workflowTemplates và repetitiontimes
        // Không được ghi đè hoặc xóa workflow con khác
        // console.log(`[updateSubWorkflowConfigAction] Cập nhật/tạo mới workflow con ${workflowIdStr} (không xóa workflow con khác)`);

        // ========== BƯỚC 2: Cập nhật hoặc tạo mới customers.workflowTemplates ==========
        const existingConfig = customer.workflowTemplates[workflowIdStr];
        
        // Lấy số lượng steps từ workflowTemplate
        const stepworkflow = workflowTemplate.steps ? workflowTemplate.steps.length : 0;
        
        // Tạo id_stepworkflow từ danh sách steps
        const id_stepworkflow = {};
        if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
            for (const step of workflowTemplate.steps) {
                const stepId = step._id ? step._id.toString() : step._id;
                if (stepId) {
                    // Nếu đã có config cũ, giữ nguyên success của step đó (nếu có)
                    const existingStepSuccess = existingConfig?.id_stepworkflow?.[stepId]?.success;
                    id_stepworkflow[stepId] = {
                        success: existingStepSuccess !== undefined ? existingStepSuccess : false
                    };
                }
            }
        }
        
        // Kiểm tra xem đây có phải workflow auto không
        const isAutoWorkflow = workflowTemplate.autoWorkflow === true;
        
        // Nếu chưa có config, tạo mới
        if (!existingConfig) {
            // Workflow con mới → tạo mới đầy đủ
            customer.workflowTemplates[workflowIdStr] = {
                success: null,
                repeat: null,
                timeRepeate: null,
                startDay: null,
                switchButton: true,
                units: null,
                stepworkflow: stepworkflow,
                id_stepworkflow: id_stepworkflow,
                step_active: 0,
                doneAuto: isAutoWorkflow ? 'pending' : null // Chỉ workflow auto mới có doneAuto
            };
            // console.log(`[updateSubWorkflowConfigAction] ✅ Tạo mới workflow con ${workflowIdStr} trong workflowTemplates (doneAuto=${isAutoWorkflow ? 'pending' : 'null'})`);
        } else {
            // Workflow con đã tồn tại → reset các trạng thái TRỪ doneAuto
            // console.log(`[updateSubWorkflowConfigAction] ✅ Cập nhật workflow con ${workflowIdStr} (đã tồn tại) - reset trạng thái trừ doneAuto`);
            
            // 🔥 QUAN TRỌNG: Giữ nguyên doneAuto hoàn toàn (không reset)
            // - Nếu doneAuto = "done" → giữ nguyên "done" (không auto lại)
            // - Nếu doneAuto = "pending" → giữ nguyên "pending" (có thể auto lại khi bước cha hoàn thành)
            // - Nếu doneAuto = null → giữ nguyên null (workflow không phải auto)
            const existingDoneAuto = existingConfig.doneAuto;
            
            // Cập nhật stepworkflow và id_stepworkflow (reset về trạng thái ban đầu)
            customer.workflowTemplates[workflowIdStr].stepworkflow = stepworkflow;
            customer.workflowTemplates[workflowIdStr].id_stepworkflow = id_stepworkflow;
            
            // Reset các trạng thái về ban đầu (TRỪ doneAuto)
            customer.workflowTemplates[workflowIdStr].success = null;
            customer.workflowTemplates[workflowIdStr].step_active = 0;
            
            // Giữ nguyên doneAuto (không reset)
            customer.workflowTemplates[workflowIdStr].doneAuto = existingDoneAuto;
            
            // Nếu workflow mới không phải auto nhưng doneAuto cũ có giá trị → set null
            // Nếu workflow mới là auto nhưng doneAuto cũ = null → set "pending"
            if (!isAutoWorkflow && existingDoneAuto !== null && existingDoneAuto !== undefined) {
                // Workflow không phải auto → doneAuto = null
                customer.workflowTemplates[workflowIdStr].doneAuto = null;
                // console.log(`[updateSubWorkflowConfigAction] ℹ️ Workflow không phải auto → set doneAuto=null`);
            } else if (isAutoWorkflow && (existingDoneAuto === null || existingDoneAuto === undefined)) {
                // Workflow là auto nhưng chưa có doneAuto → set "pending"
                customer.workflowTemplates[workflowIdStr].doneAuto = 'pending';
                // console.log(`[updateSubWorkflowConfigAction] ℹ️ Workflow auto nhưng chưa có doneAuto → set doneAuto="pending"`);
            } else {
                // Giữ nguyên doneAuto
                console.log(`[updateSubWorkflowConfigAction] ✅ Giữ nguyên doneAuto=${existingDoneAuto}`);
            }
            
            // console.log(`[updateSubWorkflowConfigAction] ✅ Đã reset trạng thái: success=null, step_active=0, id_stepworkflow đã reset, doneAuto=${customer.workflowTemplates[workflowIdStr].doneAuto} (giữ nguyên)`);
        }

        // Cập nhật các giá trị (chỉ cập nhật nếu có giá trị)
        if (repeat !== null && repeat !== undefined && repeat !== '') {
            customer.workflowTemplates[workflowIdStr].repeat = parseInt(repeat, 10) || null;
        }
        if (timeRepeate !== null && timeRepeate !== undefined && timeRepeate !== '') {
            customer.workflowTemplates[workflowIdStr].timeRepeate = timeRepeate;
        }
        if (startDay !== null && startDay !== undefined && startDay !== '') {
            customer.workflowTemplates[workflowIdStr].startDay = startDay || null;
        }
        if (switchButton !== null && switchButton !== undefined) {
            customer.workflowTemplates[workflowIdStr].switchButton = switchButton === 'true' || switchButton === true;
        }

        // Parse và lưu units từ timeRepeate
        if (timeRepeate && typeof timeRepeate === 'string' && timeRepeate.trim().length > 0) {
            const parts = timeRepeate.trim().split(' ');
            if (parts.length >= 2) {
                const unit = parts[1].toLowerCase();
                const unitNormalizeMap = {
                    'second': 'seconds',
                    'seconds': 'seconds',
                    'giây': 'seconds',
                    'minute': 'minutes',
                    'minutes': 'minutes',
                    'phút': 'minutes',
                    'hour': 'hours',
                    'hours': 'hours',
                    'giờ': 'hours',
                    'day': 'days',
                    'days': 'days',
                    'ngày': 'days',
                };
                customer.workflowTemplates[workflowIdStr].units = unitNormalizeMap[unit] || unit;
            }
        }

        customer.markModified('workflowTemplates');
        await customer.save();

        // ========== BƯỚC 3: Đảm bảo có record trong repetitionTimes (tạo mới nếu chưa có) ==========
        // Kiểm tra và tạo mới record trong repetitiontimes ngay khi workflow con được thêm vào workflowTemplates
        // Không cần đợi các điều kiện repeat/startDay
        if (isSubWorkflow) {
            try {
                // Tìm record repetitionTimes với customerId và workflowTemplateId
                let existingRepetitionTime = await RepetitionTime.findOne({
                    customerId: customerIdStr,
                    workflowTemplateId: workflowIdStrForRepetition
                });
                
                // Nếu không tìm thấy với String, thử tìm với ObjectId (dữ liệu cũ)
                if (!existingRepetitionTime) {
                    try {
                        const customerObjectId = typeof customerId === 'string' ? new mongoose.Types.ObjectId(customerId) : customerId;
                        const workflowObjectId = typeof workflowId === 'string' ? new mongoose.Types.ObjectId(workflowId) : workflowId;
                        existingRepetitionTime = await RepetitionTime.findOne({
                            customerId: customerObjectId,
                            workflowTemplateId: workflowObjectId
                        });
                    } catch (objIdError) {
                        // Bỏ qua lỗi convert ObjectId
                    }
                }
                
                // Nếu chưa có record, tạo mới với các giá trị mặc định
                if (!existingRepetitionTime) {
                    // console.log(`[updateSubWorkflowConfigAction] Tạo mới record repetitionTime cơ bản cho customer ${customerIdStr}, workflow ${workflowIdStrForRepetition}`);
                    
                    await RepetitionTime.create({
                        customerId: customerIdStr,
                        workflowTemplateId: workflowIdStrForRepetition,
                        workflowName: workflowName,
                        iterationIndex: [],
                        indexAction: 0,
                        statusWorkflow: 'pending',
                        units: 'seconds', // Giá trị mặc định
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    
                    // console.log(`[updateSubWorkflowConfigAction] ✅ Đã tạo mới record repetitionTime cơ bản`);
                } else {
                    console.log(`[updateSubWorkflowConfigAction] ✅ Record repetitionTime đã tồn tại: _id=${existingRepetitionTime._id}`);
                }
            } catch (repetitionError) {
                console.error('[updateSubWorkflowConfigAction] Lỗi khi tạo record repetitionTime cơ bản:', repetitionError);
                // Không throw error, tiếp tục xử lý phần dưới
            }
        }

        // ========== BƯỚC 4: Cập nhật hoặc tạo mới bảng repetitionTimes (với đầy đủ thông tin) ==========
        // console.log(`[updateSubWorkflowConfigAction] Bắt đầu xử lý repetitionTimes cho customer ${customerId}, workflow ${workflowId}`);
        
        const currentConfig = customer.workflowTemplates[workflowIdStr];
        const currentStartDay = currentConfig?.startDay;
        const currentRepeat = currentConfig?.repeat;
        const currentTimeRepeate = currentConfig?.timeRepeate;
        const currentSwitchButton = currentConfig?.switchButton;
        const currentUnits = currentConfig?.units;
        
        // console.log(`[updateSubWorkflowConfigAction] Config hiện tại:`, {
        //     startDay: currentStartDay,
        //     repeat: currentRepeat,
        //     timeRepeate: currentTimeRepeate,
        //     switchButton: currentSwitchButton,
        //     units: currentUnits
        // });
        
        // console.log(`[updateSubWorkflowConfigAction] Workflow template:`, {
        //     _id: workflowTemplate?._id,
        //     name: workflowName,
        //     isSubWorkflow: isSubWorkflow,
        //     workflow_position: workflowPosition
        // });
        
        // Điều kiện để sinh nhiệm vụ:
        // 1. isSubWorkflow === true
        // 2. switchButton === true
        // 3. repeat > 0
        // 4. startDay hợp lệ
        const isSwitchOn = currentSwitchButton === true || currentSwitchButton === 'true';
        const hasValidRepeat = currentRepeat && typeof currentRepeat === 'number' && currentRepeat > 0;
        const hasValidStartDay = currentStartDay && !isNaN(new Date(currentStartDay).getTime());
        const hasTimeRepeate = currentTimeRepeate && typeof currentTimeRepeate === 'string' && currentTimeRepeate.trim().length > 0;
        
        // console.log(`[updateSubWorkflowConfigAction] Kiểm tra điều kiện:`, {
        //     isSubWorkflow: isSubWorkflow,
        //     switchButton: isSwitchOn,
        //     repeat: hasValidRepeat ? `${currentRepeat} (> 0)` : 'không hợp lệ',
        //     startDay: hasValidStartDay ? 'hợp lệ' : 'không hợp lệ',
        //     timeRepeate: hasTimeRepeate ? currentTimeRepeate : 'không có'
        // });
        
        if (isSubWorkflow) {
            try {
                const isSwitchOn = currentSwitchButton === true || currentSwitchButton === 'true';
                const hasValidRepeat = currentRepeat && typeof currentRepeat === 'number' && currentRepeat > 0;
                const hasValidStartDay = currentStartDay && !isNaN(new Date(currentStartDay).getTime());
                const hasTimeRepeate = currentTimeRepeate && typeof currentTimeRepeate === 'string' && currentTimeRepeate.trim().length > 0;
                
                // console.log(`[updateSubWorkflowConfigAction] Kiểm tra điều kiện:`, {
                //     isSubWorkflow: isSubWorkflow,
                //     switchButton: isSwitchOn,
                //     repeat: hasValidRepeat ? `${currentRepeat} (> 0)` : 'không hợp lệ',
                //     startDay: hasValidStartDay ? 'hợp lệ' : 'không hợp lệ',
                //     timeRepeate: hasTimeRepeate ? currentTimeRepeate : 'không có'
                // });

                // Nếu switchButton = false, xóa tất cả nhiệm vụ cũ
                if (!isSwitchOn) {
                    await RepetitionTime.deleteMany({
                        customerId: customerIdStr,
                        workflowTemplateId: workflowIdStrForRepetition
                    });
                    console.log(`[updateSubWorkflowConfigAction] Đã xóa nhiệm vụ repetitionTime do switchButton = false`);
                }
                // Nếu có đủ điều kiện, cập nhật hoặc tạo mới repetitionTimes
                else if (isSwitchOn && hasValidRepeat && hasValidStartDay && hasTimeRepeate) {
                    // Parse timeRepeate để lấy interval và unit
                    const parts = currentTimeRepeate.trim().split(' ');
                    if (parts.length < 2) {
                        console.warn(`[updateSubWorkflowConfigAction] timeRepeate không hợp lệ: ${currentTimeRepeate}`);
                    } else {
                        const interval = parseInt(parts[0], 10) || 0;
                        const unit = parts[1].toLowerCase();
                        
                        // Map unit sang milliseconds và normalize unit name
                        const unitToMs = {
                            'seconds': 1000,
                            'second': 1000,
                            'giây': 1000,
                            'minutes': 60 * 1000,
                            'minute': 60 * 1000,
                            'phút': 60 * 1000,
                            'hours': 60 * 60 * 1000,
                            'hour': 60 * 60 * 1000,
                            'giờ': 60 * 60 * 1000,
                            'days': 24 * 60 * 60 * 1000,
                            'day': 24 * 60 * 60 * 1000,
                            'ngày': 24 * 60 * 60 * 1000,
                        };
                        
                        // Normalize unit name để lưu dạng chuẩn (số nhiều)
                        const unitNormalizeMap = {
                            'second': 'seconds',
                            'seconds': 'seconds',
                            'giây': 'seconds',
                            'minute': 'minutes',
                            'minutes': 'minutes',
                            'phút': 'minutes',
                            'hour': 'hours',
                            'hours': 'hours',
                            'giờ': 'hours',
                            'day': 'days',
                            'days': 'days',
                            'ngày': 'days',
                        };
                        
                        const normalizedUnit = currentUnits || (unitNormalizeMap[unit] || unit);
                        const intervalMs = interval * (unitToMs[unit] || 1000);
                        
                        if (intervalMs <= 0) {
                            console.warn(`[updateSubWorkflowConfigAction] Không thể tính interval từ timeRepeate: ${currentTimeRepeate}`);
                        } else {
                            // ========== REGENERATE iterationIndex ==========
                            // Formula: iterationIndex[0] = startDay
                            //          iterationIndex[n] = startDay + n * timeRepeat (units)
                            const startTime = new Date(currentStartDay);
                            const iterationIndexArray = [];
                            
                            for (let i = 0; i < currentRepeat; i++) {
                                const executionTime = new Date(startTime.getTime() + (i * intervalMs));
                                iterationIndexArray.push(executionTime);
                            }
                            
                            // console.log(`[updateSubWorkflowConfigAction] Đã tính toán ${iterationIndexArray.length} thời gian thực thi:`, 
                            //     iterationIndexArray.map(d => d.toISOString()));
                            
                            try {
                                // ========== LOGIC XỬ LÝ repetitionTimes THEO QUY TẮC ==========
                                // 🔥 QUY TẮC CHUNG:
                                // 1. Luôn kiểm tra theo cặp (customerId + workflowTemplateId)
                                // 2. Không bao giờ xóa record rồi tạo lại
                                // 3. Có thì UPDATE, chưa có thì CREATE
                                // 4. Mỗi workflow con = 1 record riêng
                                
                                // console.log(`[updateSubWorkflowConfigAction] 🔍 Bắt đầu xử lý repetitionTimes: customerId=${customerIdStr}, workflowTemplateId=${workflowIdStrForRepetition}`);
                                
                                // STEP 1: Tìm tất cả record repetitionTimes theo customerId
                                const allRecordsForCustomer = await RepetitionTime.find({
                                    customerId: customerIdStr
                                }).lean();
                                
                                // console.log(`[updateSubWorkflowConfigAction] 📊 STEP 1 - Tổng số record repetitionTime cho customer này: ${allRecordsForCustomer.length}`);
                                // if (allRecordsForCustomer.length > 0) {
                                //     console.log(`[updateSubWorkflowConfigAction] 📋 Danh sách record hiện có:`, allRecordsForCustomer.map(r => ({
                                //         _id: r._id,
                                //         workflowTemplateId: r.workflowTemplateId,
                                //         workflowName: r.workflowName
                                //     })));
                                // }
                                
                                // Nếu KHÔNG có bất kỳ record nào của customerId
                                if (allRecordsForCustomer.length === 0) {
                                    // Đây là khách hàng mới hoàn toàn → tạo mới 100% record
                                    // console.log(`[updateSubWorkflowConfigAction] ✅ CASE 3: Khách hàng mới hoàn toàn (không có record nào) → CREATE mới`);
                                    
                                    try {
                                        const newRepetitionTime = await RepetitionTime.create({
                                            customerId: customerIdStr,
                                            workflowTemplateId: workflowIdStrForRepetition,
                                            workflowName: workflowName,
                                            iterationIndex: iterationIndexArray,
                                            indexAction: 0,
                                            statusWorkflow: 'pending',
                                            units: normalizedUnit,
                                            createdAt: new Date(),
                                            updatedAt: new Date()
                                        });
                                        // console.log(`[updateSubWorkflowConfigAction] ✅ Đã tạo mới record repetitionTime cho customer mới: _id=${newRepetitionTime._id}`);
                                        
                                        // 🔥 QUAN TRỌNG: Đảm bảo workflowTemplates có trạng thái đúng sau khi tạo mới repetitionTimes
                                        const customerAfterCreate = await Customer.findById(customerId);
                                        if (customerAfterCreate && customerAfterCreate.workflowTemplates?.[workflowIdStr]) {
                                            const workflowConfig = customerAfterCreate.workflowTemplates[workflowIdStr];
                                            
                                            // Đảm bảo id_stepworkflow có đầy đủ các steps
                                            if (!workflowConfig.id_stepworkflow || typeof workflowConfig.id_stepworkflow !== 'object') {
                                                workflowConfig.id_stepworkflow = {};
                                            }
                                            
                                            // Khởi tạo id_stepworkflow cho tất cả steps nếu chưa có
                                            if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
                                                for (const step of workflowTemplate.steps) {
                                                    const stepId = step._id ? step._id.toString() : null;
                                                    if (stepId && !workflowConfig.id_stepworkflow[stepId]) {
                                                        workflowConfig.id_stepworkflow[stepId] = { success: false };
                                                    }
                                                }
                                            }
                                            
                                            // Đảm bảo các trạng thái đúng
                                            workflowConfig.success = workflowConfig.success || null;
                                            workflowConfig.step_active = workflowConfig.step_active || 0;
                                            
                                            customerAfterCreate.markModified('workflowTemplates');
                                            await customerAfterCreate.save();
                                            // console.log(`[updateSubWorkflowConfigAction] ✅ Đã đảm bảo workflowTemplates có trạng thái đúng sau khi tạo mới repetitionTimes cho customer mới`);
                                        }
                                    } catch (createError) {
                                        if (createError.code === 11000) {
                                            // Duplicate key error → fallback to updateOne
                                            // console.log(`[updateSubWorkflowConfigAction] ⚠️ Duplicate key error khi tạo mới, fallback to updateOne`);
                                            await RepetitionTime.updateOne(
                                                { customerId: customerIdStr, workflowTemplateId: workflowIdStrForRepetition },
                                                {
                                                    $set: {
                                                        workflowName: workflowName,
                                                        iterationIndex: iterationIndexArray,
                                                        indexAction: 0,
                                                        statusWorkflow: 'pending',
                                                        units: normalizedUnit,
                                                        updatedAt: new Date()
                                                    },
                                                    $setOnInsert: {
                                                        createdAt: new Date()
                                                    }
                                                },
                                                { upsert: true }
                                            );
                                            // console.log(`[updateSubWorkflowConfigAction] ✅ Đã cập nhật bằng updateOne sau duplicate key error`);
                                            
                                            // Reset lại trạng thái trong workflowTemplates sau khi fallback update
                                            const customerAfterFallback = await Customer.findById(customerId);
                                            if (customerAfterFallback && customerAfterFallback.workflowTemplates?.[workflowIdStr]) {
                                                const workflowConfig = customerAfterFallback.workflowTemplates[workflowIdStr];
                                                
                                                // Reset id_stepworkflow về trạng thái ban đầu
                                                const resetIdStepworkflow = {};
                                                if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
                                                    for (const step of workflowTemplate.steps) {
                                                        const stepId = step._id ? step._id.toString() : null;
                                                        if (stepId) {
                                                            resetIdStepworkflow[stepId] = { success: false };
                                                        }
                                                    }
                                                }
                                                
                                                workflowConfig.id_stepworkflow = resetIdStepworkflow;
                                                workflowConfig.success = null;
                                                workflowConfig.step_active = 0;
                                                
                                                customerAfterFallback.markModified('workflowTemplates');
                                                await customerAfterFallback.save();
                                                // console.log(`[updateSubWorkflowConfigAction] ✅ Đã reset trạng thái workflowTemplates sau khi fallback update cho customer mới`);
                                            }
                                        } else {
                                            throw createError;
                                        }
                                    }
                                } else {
                                    // STEP 2: Kiểm tra trong các record tìm được có workflowTemplateId không
                                    const existWorkflowForCustomer = await RepetitionTime.findOne({
                                        customerId: customerIdStr,
                                        workflowTemplateId: workflowIdStrForRepetition
                                    }).lean();
                                    
                                    if (existWorkflowForCustomer) {
                                        // CASE A: ĐÃ CÓ (customerId + workflowTemplateId) → UPDATE
                                        // console.log(`[updateSubWorkflowConfigAction] ✅ CASE 1: Đã có record với workflowTemplateId → UPDATE (không xóa)`);
                                        // console.log(`[updateSubWorkflowConfigAction] 📝 Record cần cập nhật: _id=${existWorkflowForCustomer._id}, workflowTemplateId=${existWorkflowForCustomer.workflowTemplateId}`);
                                        
                                        // UPDATE record hiện có, reset về trạng thái ban đầu khi cập nhật schedule mới
                                        await RepetitionTime.updateOne(
                                            { _id: existWorkflowForCustomer._id },
                                            {
                                                $set: {
                                                    workflowName: workflowName,
                                                    iterationIndex: iterationIndexArray,
                                                    indexAction: 0, // Reset về 0 khi cập nhật schedule mới
                                                    statusWorkflow: 'pending', // Reset về pending khi cập nhật schedule mới
                                                    units: normalizedUnit,
                                                    updatedAt: new Date()
                                                }
                                            }
                                        );
                                        
                                        // console.log(`[updateSubWorkflowConfigAction] ✅ Đã cập nhật record repetitionTime: _id=${existWorkflowForCustomer._id}`);
                                        
                                        // 🔥 QUAN TRỌNG: Reset lại trạng thái trong workflowTemplates sau khi cập nhật repetitionTimes
                                        // Đảm bảo các trạng thái step được reset về ban đầu
                                        const customerAfterUpdate = await Customer.findById(customerId);
                                        if (customerAfterUpdate && customerAfterUpdate.workflowTemplates?.[workflowIdStr]) {
                                            const workflowConfig = customerAfterUpdate.workflowTemplates[workflowIdStr];
                                            
                                            // Reset id_stepworkflow về trạng thái ban đầu (tất cả success: false)
                                            const resetIdStepworkflow = {};
                                            if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
                                                for (const step of workflowTemplate.steps) {
                                                    const stepId = step._id ? step._id.toString() : null;
                                                    if (stepId) {
                                                        resetIdStepworkflow[stepId] = { success: false };
                                                    }
                                                }
                                            }
                                            
                                            workflowConfig.id_stepworkflow = resetIdStepworkflow;
                                            workflowConfig.success = null;
                                            workflowConfig.step_active = 0;
                                            // Giữ nguyên doneAuto (không reset)
                                            
                                            customerAfterUpdate.markModified('workflowTemplates');
                                            await customerAfterUpdate.save();
                                            // console.log(`[updateSubWorkflowConfigAction] ✅ Đã reset trạng thái workflowTemplates sau khi cập nhật repetitionTimes: success=null, step_active=0, doneAuto=${workflowConfig.doneAuto} (giữ nguyên)`);
                                        }
                                    } else {
                                        // CASE B: CHƯA CÓ (customerId có rồi nhưng workflowTemplateId chưa có) → CREATE mới
                                        // console.log(`[updateSubWorkflowConfigAction] ✅ CASE 2: Customer đã có record nhưng chưa có workflowTemplateId này → CREATE mới (không xóa record khác)`);
                                        
                                        try {
                                            const newRepetitionTime = await RepetitionTime.create({
                                                customerId: customerIdStr,
                                                workflowTemplateId: workflowIdStrForRepetition,
                                                workflowName: workflowName,
                                                iterationIndex: iterationIndexArray,
                                                indexAction: 0,
                                                statusWorkflow: 'pending',
                                                units: normalizedUnit,
                                                createdAt: new Date(),
                                                updatedAt: new Date()
                                            });
                                            // console.log(`[updateSubWorkflowConfigAction] ✅ Đã tạo mới record repetitionTime: _id=${newRepetitionTime._id}, workflowTemplateId=${workflowIdStrForRepetition}`);
                                            
                                            // 🔥 QUAN TRỌNG: Đảm bảo workflowTemplates có trạng thái đúng sau khi tạo mới repetitionTimes
                                            const customerAfterCreate = await Customer.findById(customerId);
                                            if (customerAfterCreate && customerAfterCreate.workflowTemplates?.[workflowIdStr]) {
                                                const workflowConfig = customerAfterCreate.workflowTemplates[workflowIdStr];
                                                
                                                // Đảm bảo id_stepworkflow có đầy đủ các steps
                                                if (!workflowConfig.id_stepworkflow || typeof workflowConfig.id_stepworkflow !== 'object') {
                                                    workflowConfig.id_stepworkflow = {};
                                                }
                                                
                                                // Khởi tạo id_stepworkflow cho tất cả steps nếu chưa có
                                                if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
                                                    for (const step of workflowTemplate.steps) {
                                                        const stepId = step._id ? step._id.toString() : null;
                                                        if (stepId && !workflowConfig.id_stepworkflow[stepId]) {
                                                            workflowConfig.id_stepworkflow[stepId] = { success: false };
                                                        }
                                                    }
                                                }
                                                
                                                // Đảm bảo các trạng thái đúng
                                                workflowConfig.success = workflowConfig.success || null;
                                                workflowConfig.step_active = workflowConfig.step_active || 0;
                                                
                                                customerAfterCreate.markModified('workflowTemplates');
                                                await customerAfterCreate.save();
                                                // console.log(`[updateSubWorkflowConfigAction] ✅ Đã đảm bảo workflowTemplates có trạng thái đúng sau khi tạo mới repetitionTimes`);
                                            }
                                        } catch (createError) {
                                            if (createError.code === 11000) {
                                                // Duplicate key error → fallback to updateOne
                                                // console.log(`[updateSubWorkflowConfigAction] ⚠️ Duplicate key error khi tạo mới, fallback to updateOne`);
                                                await RepetitionTime.updateOne(
                                                    { customerId: customerIdStr, workflowTemplateId: workflowIdStrForRepetition },
                                                    {
                                                        $set: {
                                                            workflowName: workflowName,
                                                            iterationIndex: iterationIndexArray,
                                                            indexAction: 0,
                                                            statusWorkflow: 'pending',
                                                            units: normalizedUnit,
                                                            updatedAt: new Date()
                                                        },
                                                        $setOnInsert: {
                                                            createdAt: new Date()
                                                        }
                                                    },
                                                    { upsert: true }
                                                );
                                                // console.log(`[updateSubWorkflowConfigAction] ✅ Đã cập nhật bằng updateOne sau duplicate key error`);
                                                
                                                // Reset lại trạng thái trong workflowTemplates sau khi fallback update
                                                const customerAfterFallback = await Customer.findById(customerId);
                                                if (customerAfterFallback && customerAfterFallback.workflowTemplates?.[workflowIdStr]) {
                                                    const workflowConfig = customerAfterFallback.workflowTemplates[workflowIdStr];
                                                    
                                                    // Reset id_stepworkflow về trạng thái ban đầu
                                                    const resetIdStepworkflow = {};
                                                    if (workflowTemplate.steps && Array.isArray(workflowTemplate.steps)) {
                                                        for (const step of workflowTemplate.steps) {
                                                            const stepId = step._id ? step._id.toString() : null;
                                                            if (stepId) {
                                                                resetIdStepworkflow[stepId] = { success: false };
                                                            }
                                                        }
                                                    }
                                                    
                                                    workflowConfig.id_stepworkflow = resetIdStepworkflow;
                                                    workflowConfig.success = null;
                                                    workflowConfig.step_active = 0;
                                                    
                                                    customerAfterFallback.markModified('workflowTemplates');
                                                    await customerAfterFallback.save();
                                                    // console.log(`[updateSubWorkflowConfigAction] ✅ Đã reset trạng thái workflowTemplates sau khi fallback update`);
                                                }
                                            } else {
                                                throw createError;
                                            }
                                        }
                                    }
                                }
                                
                                // Verify lại trong database
                                const verifyRecord = await RepetitionTime.findOne({
                                    customerId: customerIdStr,
                                    workflowTemplateId: workflowIdStrForRepetition
                                }).lean();
                                
                                // if (verifyRecord) {
                                //     if (Array.isArray(verifyRecord.iterationIndex)) {
                                //         console.log(`[updateSubWorkflowConfigAction] ✅ Xác minh: Record có ${verifyRecord.iterationIndex.length} thời gian trong iterationIndex`);
                                //         if (verifyRecord.iterationIndex.length > 0) {
                                //             console.log(`[updateSubWorkflowConfigAction] Mẫu thời gian:`, verifyRecord.iterationIndex.slice(0, 3).map(d => new Date(d).toISOString()));
                                //         }
                                //     } else {
                                //         console.error(`[updateSubWorkflowConfigAction] ❌ iterationIndex không phải là mảng trong database!`);
                                //     }
                                // } else {
                                //     console.error(`[updateSubWorkflowConfigAction] ❌ Không tìm thấy record sau khi lưu!`);
                                // }
                            } catch (saveError) {
                                console.error(`[updateSubWorkflowConfigAction] ❌ Lỗi khi lưu record:`, saveError);
                                console.error(`[updateSubWorkflowConfigAction] Chi tiết lỗi:`, {
                                    message: saveError.message,
                                    code: saveError.code,
                                    name: saveError.name
                                });
                            }
                        }
                    }
                }
            } catch (repetitionError) {
                console.error('[updateSubWorkflowConfigAction] Lỗi khi lưu vào bảng repetitionTime:', repetitionError);
            }
        }

        revalidateData();
        return { success: true, message: 'Cập nhật cấu hình workflow con thành công!' };
    } catch (error) {
        // console.error('Lỗi khi cập nhật cấu hình workflow con:', error);
        return { success: false, error: 'Lỗi server khi cập nhật.' };
    }
}

export async function addCareNoteAction(previousState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) return { success: false, message: 'Bạn cần đăng nhập để thực hiện hành động này.' };
    if (!matchesAnyRole(user.role, ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'])) {
        return { success: false, message: 'Bạn không có quyền thực hiện chức năng này' };
    }

    // MỚI: Lấy thêm 'step' từ formData
    const customerId = formData.get('customerId');
    const content = formData.get('content');
    const step = formData.get('step');

    // MỚI: Thêm 'step' vào điều kiện kiểm tra
    if (!customerId || !content || !step) {
        return { success: false, error: 'Thiếu thông tin ghi chú.' };
    }

    try {
        await connectDB();

        // MỚI: Thêm trường 'step' vào object newNote
        // Chuyển step sang dạng Number để đảm bảo đúng kiểu dữ liệu trong CSDL
        const newNote = {
            content,
            step: Number(step),
            createBy: user.id,
            createAt: new Date()
        };

        await Customer.findByIdAndUpdate(customerId, {
            $push: { care: newNote }
        });

        revalidateData();
        return { success: true, message: 'Thêm ghi chú thành công.' };
    } catch (error) {
        console.error("Error adding care note:", error);
        return { success: false, error: 'Lỗi máy chủ: Không thể thêm ghi chú.' };
    }
}

export async function updateCustomerStatusAction(previousState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    if (!matchesAnyRole(user.role, ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'])) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }
    const customerId = formData.get('customerId');
    const newStatusStr = formData.get('status');

    if (!customerId || !newStatusStr) {
        return { success: false, error: 'Thiếu thông tin cần thiết.' };
    }
    const newStatus = parseInt(newStatusStr, 10);
    try {
        await connectDB();
        const customer = await Customer.findById(customerId).select('status').lean();
        if (!customer) {
            return { success: false, error: 'Không tìm thấy khách hàng.' };
        }
        if (customer.status === newStatus) {
            return { success: false, error: 'Khách hàng đã ở trạng thái này.' };
        }
        await Customer.findByIdAndUpdate(customerId, {
            status: newStatus
        });
        revalidateData();
        return { success: true, message: 'Cập nhật trạng thái thành công!' };
    } catch (error) {
        console.log(error);

        return { success: false, error: 'Lỗi server khi cập nhật trạng thái.' };
    }
}

/**
 * Gán một hoặc nhiều khách hàng cho nhân sự tuyển sinh.
 * Đồng thời cập nhật trạng thái pipeline và ghi log chăm sóc (care).
 */
export async function assignRoleToCustomersAction(prevState, formData) {
    // console.log('🚩Đi qua hàm assignRoleToCustomersAction');
    // 1. Xác thực và phân quyền người dùng
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { success: false, error: 'Bạn cần đăng nhập để thực hiện hành động này.' };
    }
    // 2. Lấy và kiểm tra dữ liệu đầu vào
    const customersJSON = formData.get('selectedCustomersJSON');
    const userIdToAssign = formData.get('userId');

    if (!userIdToAssign || !customersJSON) {
        return { success: false, error: 'Dữ liệu không hợp lệ. Vui lòng chọn người phụ trách và khách hàng.' };
    }

    let customerIds;
    try {
        customerIds = JSON.parse(customersJSON).map(c => c._id);
        if (!Array.isArray(customerIds) || customerIds.length === 0) {
            return { success: false, error: 'Không có khách hàng nào được chọn.' };
        }
    } catch (e) {
        return { success: false, error: 'Định dạng danh sách khách hàng không đúng.' };
    }

    try {
        await connectDB();

        // 3. Lấy thông tin của nhân viên được gán để xác định group
        const assignedUser = await User.findById(userIdToAssign).lean();
        if (!assignedUser) {
            return { success: false, error: 'Không tìm thấy thông tin nhân viên được gán.' };
        }

        // 4. Xác định trạng thái pipeline mới dựa trên group của nhân viên
        const userGroup = assignedUser.group; // 'telesale'/'care' (hoặc 'telesale_TuVan'/'CareService')
        let newPipelineStatus;
        if (userGroup === 'telesale' || userGroup === 'telesale_TuVan') {
            newPipelineStatus = 'telesale_TuVan3';
        } else if (userGroup === 'care' || userGroup === 'CareService') {
            newPipelineStatus = 'CareService3';
        } else {
            newPipelineStatus = 'undetermined_3'; // Mặc định nếu không có group
        }

        // 5. Chuẩn bị các object để cập nhật
        const assigneeObject = {
            user: new mongoose.Types.ObjectId(userIdToAssign),
            group: userGroup,
            assignedAt: new Date()
        };

        const careNote = {
        content: `Hồ sơ được phân bổ cho nhân sự: ${assignedUser.name || 'N/A'}`,
            createBy: new mongoose.Types.ObjectId(user.id),
            step: 3, // Ghi log cho Bước 3
            createAt: new Date()
        };

        // 6. Cập nhật hàng loạt khách hàng
        const result = await Customer.updateMany(
            { _id: { $in: customerIds } },
            {
                $set: {
                    // Thay thế toàn bộ danh sách phụ trách bằng nhân sự mới
                    assignees: [assigneeObject],
                    'pipelineStatus.0': newPipelineStatus, // Trạng thái tổng quan gần nhất
                    'pipelineStatus.3': newPipelineStatus, // Trạng thái cho Bước 3: Phân bổ
                },
                // Ghi log hành động
                $push: {
                    care: careNote,
                }
            }
        );
        // console.log(`[pipelineStatus] Cập nhật pipelineStatus cho ${result.modifiedCount} customers: pipelineStatus.0=${newPipelineStatus}, pipelineStatus.3=${newPipelineStatus} (assignRoleToCustomers)`);

        revalidateData();
        if (result.modifiedCount > 0) {
            return { success: true, message: `Đã phân bổ thành công ${result.modifiedCount} khách hàng cho ${assignedUser.name}.` };
        } else {
            return { success: true, message: `Không có khách hàng nào được cập nhật. Có thể họ đã được phân bổ từ trước.` };
        }

    } catch (error) {
        console.error("Lỗi khi gán người phụ trách hàng loạt:", error);
        return { success: false, error: 'Đã xảy ra lỗi phía máy chủ. Vui lòng thử lại.' };
    }
}

/**
 * Bỏ gán một hoặc nhiều khách hàng khỏi nhân sự tuyển sinh.
 * Đồng thời cập nhật trạng thái pipeline (nếu không còn ai phụ trách) và ghi log chăm sóc (care).
 */
export async function unassignRoleFromCustomersAction(prevState, formData) {
    // 1) Xác thực & phân quyền
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { success: false, error: 'Bạn cần đăng nhập để thực hiện hành động này.' };
    }
    if (!matchesAnyRole(user.role, ['Admin', 'Admin Sale', 'Manager'])) {
        return { success: false, error: 'Bạn không có quyền thực hiện chức năng này.' };
    }

    // 2) Dữ liệu đầu vào
    const customersJSON = formData.get('selectedCustomersJSON');
    const userIdToUnassign = formData.get('userId');

    if (!userIdToUnassign || !customersJSON) {
        return { success: false, error: 'Dữ liệu không hợp lệ. Vui lòng chọn người cần bỏ gán và khách hàng.' };
    }

    let customerIds;
    try {
        customerIds = JSON.parse(customersJSON).map((c) => c._id);
        if (!Array.isArray(customerIds) || customerIds.length === 0) {
            return { success: false, error: 'Không có khách hàng nào được chọn.' };
        }
    } catch {
        return { success: false, error: 'Định dạng danh sách khách hàng không đúng.' };
    }

    try {
        await connectDB();

        // 3) Lấy thông tin nhân viên để ghi log
        const assignedUser = await User.findById(userIdToUnassign).lean();
        if (!assignedUser) {
            return { success: false, error: 'Không tìm thấy thông tin nhân viên cần bỏ gán.' };
        }

        // 4) Care note (yêu cầu)
        const careNote = {
            content: `Hồ sơ được bỏ phân bổ cho: ${assignedUser.name || 'N/A'}`,
            createBy: new mongoose.Types.ObjectId(user.id),
            step: 3, // Ghi log cho Bước 3
            createAt: new Date()
        };

        // 5) Bỏ gán khỏi mảng assignees + ghi care
        const pullResult = await Customer.updateMany(
            { _id: { $in: customerIds } },
            {
                $pull: { assignees: { user: new mongoose.Types.ObjectId(userIdToUnassign) } },
                $push: { care: careNote }
            }
        );

        // 6) Nếu hồ sơ không còn ai phụ trách => set pipeline về trạng thái unassigned
        const UNASSIGNED_STATUS = 'unassigned_3';

        const affectedCustomers = await Customer.find(
            { _id: { $in: customerIds } },
            { _id: 1, assignees: 1 }
        ).lean();

        const idsNoAssignee = affectedCustomers
            .filter((c) => !c.assignees || c.assignees.length === 0)
            .map((c) => c._id);

        revalidateData();

        return {
            success: true,
            message: `Đã bỏ gán khỏi ${pullResult.modifiedCount} khách hàng${idsNoAssignee.length ? `; ${idsNoAssignee.length} hồ sơ không còn ai phụ trách.` : '.'}`
        };
    } catch (error) {
        console.error('Lỗi khi bỏ gán người phụ trách hàng loạt:', error);
        return { success: false, error: 'Đã xảy ra lỗi phía máy chủ. Vui lòng thử lại.' };
    }
}
