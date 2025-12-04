'use server';

import Agenda from 'agenda';
import mongoose from 'mongoose';
import { CustomerWorkflow, WorkflowTemplate } from '@/models/workflows.model';
import Customer from '@/models/customer.model';
import Zalo from '@/models/zalo.model';
import Logs from '@/models/log.model';
import Setting from '@/models/setting.model';
import Form from '@/models/formclient';
import Variant from '@/models/variant.model';
import Service from '@/models/services.model';
import User from '@/models/users';
import { actionZalo, sendGP } from '@/function/drive/appscript';
import Appointment from '@/models/appointment.model';
import { processMessageConversation } from '@/utils/autoMessageCustomer';
import { getPagesFromAPI } from '@/lib/pancake-api';
import RepetitionTime from '@/models/repetitionTime.model';
let agendaInstance = null;

// =============================================================
// == CÁC HẰNG SỐ CẤU HÌNH
// =============================================================
const actionMap = {
    'message': 'sendMessage',
    'friendRequest': 'addFriend',
    'checkFriend': 'checkFriend',
    'tag': 'tag',
    'findUid': 'findUid',
};

// Helper function để lấy workflow ID từ database dựa trên tên
async function getWorkflowIdByName(namePattern) {
    try {
        const workflow = await WorkflowTemplate.findOne({ 
            name: { $regex: namePattern, $options: 'i' } 
        }).select('_id').lean();
        return workflow ? workflow._id.toString() : null;
    } catch (error) {
        console.error(`[getWorkflowIdByName] Lỗi khi tìm workflow với pattern "${namePattern}":`, error);
        return null;
    }
}

// Helper function để lấy workflow ID từ database dựa trên type và thứ tự
async function getWorkflowIdByType(type, order = 1) {
    try {
        const workflows = await WorkflowTemplate.find({ type: type })
            .sort({ _id: 1 })
            .select('_id name')
            .lean();
        if (workflows.length >= order) {
            return workflows[order - 1]._id.toString();
        }
        return null;
    } catch (error) {
        console.error(`[getWorkflowIdByType] Lỗi khi tìm workflow type "${type}" order ${order}:`, error);
        return null;
    }
}

const RETRYABLE_ERRORS = ['hourly', 'daily', 'no_accounts'];
const SYSTEM_USER_ID = '68b0af5cf58b8340827174e0';

const actionToStepMap = {
    friendRequest: 1, checkFriend: 1, tag: 1, findUid: 1,
    message: 2,
    allocation: 3, bell: 3, appointmentReminder: 5
};
const actionToNameMap = {
    message: 'Gửi tin nhắn Zalo', friendRequest: 'Gửi lời mời kết bạn',
    checkFriend: 'Kiểm tra trạng thái bạn bè', tag: 'Gắn thẻ Zalo',
    findUid: 'Tìm UID Zalo', allocation: 'Phân bổ cho đội tuyển sinh', bell: 'Gửi thông báo hệ thống',
    appointmentReminder: 'Nhắc lịch hẹn'
};


// =============================================================
// == 1. CÁC HÀM HELPER CƠ BẢN
// =============================================================

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
 * Gửi yêu cầu revalidate cache tới Next.js API để cập nhật giao diện người dùng.
 */
function triggerRevalidation() {
    console.log('[Agenda] Triggering revalidation via API for tag: customers');
    try {
        const host = process.env.URL || 'http://localhost:4000';
        const secret = process.env.REVALIDATE_SECRET_TOKEN;
        fetch(`${host}/api/cache/retag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, tag: 'customers' }),
        });
    } catch (revalError) {
        console.error('[Agenda] Lỗi khi gọi API revalidate:', revalError);
    }
}

// =============================================================
// == 2. CÁC HÀM XỬ LÝ JOB (PROCESSORS)
// =============================================================

/**
 * Hàm xử lý chung cho các job Zalo ban đầu (WF1) và job 'message' (WF2).
 * @param {import('agenda').Job} job - Đối tượng job từ Agenda.
 */
async function genericJobProcessor(job) {
    // 🔥🔥🔥 BẮT BUỘC: LOG NGAY ĐẦU TIÊN KHI BẤT KỲ STEP NÀO ĐƯỢC GỌI THỰC THI 🔥🔥🔥
    const rawJobData = job.attrs.data || {};
    const rawStepId = rawJobData.stepId?.toString();
    let jobName = job.attrs.name;
    const jobId = job.attrs._id?.toString();
    let customerId = rawJobData.customerId;
    let workflowTemplateId = rawJobData.workflowTemplateId;
    let pipelineStep = rawJobData.pipelineStep;
    let subWorkflowName = rawJobData.subWorkflowName;
    const scheduledAt = job.attrs.nextRunAt?.toISOString() || job.attrs.lastRunAt?.toISOString() || 'N/A';
    const now = new Date().toISOString();
    const isStepDelay = rawStepId === '6928f5f890519d95f67c7a6c';
    
    // 🔥 LOG BẮT BUỘC - MỖI KHI STEP ĐƯỢC GỌI THỰC THI
    console.log(`\n\n`);
    console.log(`╔════════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                    🔥 STEP ĐƯỢC GỌI THỰC THI 🔥                                ║`);
    console.log(`╠════════════════════════════════════════════════════════════════════════════════╣`);
    console.log(`║ Job Name        : ${(jobName || 'N/A').padEnd(60)} ║`);
    console.log(`║ Job ID          : ${(jobId || 'N/A').padEnd(60)} ║`);
    console.log(`║ Step ID         : ${(rawStepId || 'N/A').padEnd(60)} ║`);
    console.log(`║ Customer ID     : ${(customerId || 'N/A').padEnd(60)} ║`);
    console.log(`║ Workflow ID     : ${(workflowTemplateId || 'N/A').padEnd(60)} ║`);
    console.log(`║ Pipeline Step   : ${(pipelineStep?.toString() || 'N/A').padEnd(60)} ║`);
    console.log(`║ Sub Workflow    : ${(subWorkflowName || 'N/A').padEnd(60)} ║`);
    console.log(`║ Scheduled At    : ${scheduledAt.padEnd(60)} ║`);
    console.log(`║ Now             : ${now.padEnd(60)} ║`);
    console.log(`║ Is Step Delay   : ${(isStepDelay ? 'YES ⚠️' : 'NO').padEnd(60)} ║`);
    if (isStepDelay) {
        console.log(`║ ⚠️⚠️⚠️  STEP DELAY DETECTED - Đây là step có delay! ⚠️⚠️⚠️                        ║`);
    }
    console.log(`╚════════════════════════════════════════════════════════════════════════════════╝`);
    console.log(`\n`);
    
    // 🔥 DEBUG: Log đặc biệt cho step delay 6928f5f890519d95f67c7a6c
    if (isStepDelay) {
        console.log(`[genericJobProcessor] 🔥🔥🔥🔥🔥 STEP DELAY JOB CALLED (FIRST LOG): stepId=6928f5f890519d95f67c7a6c 🔥🔥🔥🔥🔥`, {
            jobName: job.attrs.name,
            jobId: job.attrs._id?.toString(),
            scheduledAt: job.attrs.nextRunAt?.toISOString() || job.attrs.lastRunAt?.toISOString() || 'N/A',
            lastRunAt: job.attrs.lastRunAt?.toISOString() || 'N/A',
            lastFinishedAt: job.attrs.lastFinishedAt?.toISOString() || 'N/A',
            nextRunAt: job.attrs.nextRunAt?.toISOString() || 'N/A',
            now: new Date().toISOString(),
            rawJobData: rawJobData,
            fullJobAttrs: {
                name: job.attrs.name,
                data: job.attrs.data,
                type: job.attrs.type,
                priority: job.attrs.priority,
                nextRunAt: job.attrs.nextRunAt?.toISOString(),
                lastRunAt: job.attrs.lastRunAt?.toISOString(),
                lastFinishedAt: job.attrs.lastFinishedAt?.toISOString(),
                failedAt: job.attrs.failedAt?.toISOString(),
                failCount: job.attrs.failCount,
                failReason: job.attrs.failReason
            }
        });
    }
    
    console.log(`[genericJobProcessor] 🔍 DEBUG - Job được gọi:`, {
        jobName: job.attrs.name,
        scheduledAt: job.attrs.nextRunAt?.toISOString() || job.attrs.lastRunAt?.toISOString() || 'N/A',
        jobId: job.attrs._id?.toString(),
        jobDataKeys: Object.keys(rawJobData),
        jobData: {
            customerId: rawJobData.customerId,
            stepId: rawJobData.stepId,
            workflowTemplateId: rawJobData.workflowTemplateId,
            pipelineStep: rawJobData.pipelineStep,
            subWorkflowName: rawJobData.subWorkflowName,
            params: rawJobData.params
        }
    });
    
    // Đã khai báo ở trên, chỉ lấy các biến còn thiếu
    const { params, cwId } = rawJobData;
    let stepId = rawJobData.stepId;
    
    // Chuẩn hóa workflowTemplateId nếu là ObjectId
    if (workflowTemplateId) {
        workflowTemplateId = workflowTemplateId.toString();
    }
    if (stepId) {
        stepId = stepId.toString();
    }
    
    // Fallback: Lấy pipelineStep và subWorkflowName từ workflowTemplateId nếu thiếu
    if ((!pipelineStep || !subWorkflowName) && workflowTemplateId) {
        try {
            console.log(`[genericJobProcessor] 🔍 Đang lấy thông tin từ WorkflowTemplate: workflowTemplateId=${workflowTemplateId}`);
            const template = await WorkflowTemplate.findById(workflowTemplateId).lean();
            if (template) {
                console.log(`[genericJobProcessor] 🔍 Template found:`, {
                    name: template.name,
                    isSubWorkflow: template.isSubWorkflow,
                    workflow_position: template.workflow_position
                });
                
                if (template.isSubWorkflow) {
                    pipelineStep = template.workflow_position || pipelineStep;
                    subWorkflowName = template.name || subWorkflowName;
                    console.log(`[genericJobProcessor] ✅ Lấy pipelineStep và subWorkflowName từ WorkflowTemplate: pipelineStep=${pipelineStep}, subWorkflowName="${subWorkflowName}"`);
                } else {
                    console.log(`[genericJobProcessor] ⚠️ Template không phải sub-workflow: isSubWorkflow=${template.isSubWorkflow}`);
                }
            } else {
                console.log(`[genericJobProcessor] ⚠️ Không tìm thấy template với workflowTemplateId=${workflowTemplateId}`);
            }
        } catch (error) {
            console.error(`[genericJobProcessor] ❌ Lỗi khi lấy thông tin từ WorkflowTemplate:`, error);
        }
    }
    
    // Fallback: Thử lấy từ CustomerWorkflow nếu vẫn thiếu
    if ((!pipelineStep || !subWorkflowName) && cwId) {
        try {
            const cw = await CustomerWorkflow.findById(cwId).populate('templateId').lean();
            if (cw && cw.templateId && cw.templateId.isSubWorkflow) {
                pipelineStep = cw.templateId.workflow_position || pipelineStep;
                subWorkflowName = cw.templateId.name || subWorkflowName;
                console.log(`[genericJobProcessor] Lấy pipelineStep và subWorkflowName từ CustomerWorkflow: pipelineStep=${pipelineStep}, subWorkflowName="${subWorkflowName}"`);
            }
        } catch (error) {
            console.error(`[genericJobProcessor] Lỗi khi lấy thông tin từ CustomerWorkflow:`, error);
        }
    }
    
    // Xác định là sub-workflow step nếu có đầy đủ: pipelineStep, subWorkflowName, stepId, workflowTemplateId
    const isSubWorkflowStep = !!(pipelineStep && subWorkflowName && stepId && workflowTemplateId);

    // Log thông tin step & workflow đang chạy (áp dụng cho cả workflow cha và workflow con)
    console.log(
        `[genericJobProcessor] ▶️ Step đang chạy: jobName=${jobName}, ` +
        `workflowTemplateId=${workflowTemplateId || 'N/A'}, stepId=${stepId || 'N/A'}, ` +
        `customerId=${customerId}, pipelineStep=${pipelineStep || 'N/A'}, subWorkflowName=${subWorkflowName || 'N/A'}, ` +
        `isSubWorkflowStep=${isSubWorkflowStep}`
    );

    try {
        // 🔥 BƯỚC 1: ĐẢM BẢO STEP ĐƯỢC KHỞI TẠO/GHI NHẬN TRƯỚC KHI CHẠY ACTION
        // Mỗi lần step chạy (kể cả step delay), phải đảm bảo:
        // 1. Customer tồn tại
        // 2. workflowTemplates[workflowId] tồn tại
        // 3. id_stepworkflow[stepId] tồn tại (khởi tạo nếu chưa có)
        // Điều này đảm bảo step luôn được ghi nhận dù có delay hay không
        const customer = await Customer.findById(customerId);
        if (!customer) throw new Error(`Không tìm thấy Customer ID ${customerId}`);

        // 🔥 QUAN TRỌNG: Khởi tạo workflowConfig và step TRƯỚC khi chạy action
        // Áp dụng cho TẤT CẢ steps có stepId và workflowTemplateId (kể cả step delay)
        if (stepId && workflowTemplateId) {
            try {
                const workflowIdStr = workflowTemplateId.toString();
                const stepIdStr = stepId.toString();
                
                console.log(`[genericJobProcessor] 🔥 BƯỚC 1: Khởi tạo/đảm bảo step ${stepIdStr} được ghi nhận trong workflowTemplates`);
                
                // Lấy customer mới nhất từ database
                const currentCustomer = await Customer.findById(customerId);
                if (!currentCustomer) {
                    throw new Error(`Không tìm thấy Customer ${customerId}`);
                }
                
                // Đảm bảo workflowTemplates tồn tại
                if (!currentCustomer.workflowTemplates || typeof currentCustomer.workflowTemplates !== 'object' || Array.isArray(currentCustomer.workflowTemplates)) {
                    currentCustomer.workflowTemplates = {};
                    currentCustomer.markModified('workflowTemplates');
                    await currentCustomer.save();
                }
                
                // Đảm bảo workflowConfig tồn tại
                let workflowConfig = currentCustomer.workflowTemplates[workflowIdStr];
                if (!workflowConfig) {
                    console.log(`[genericJobProcessor] ⚠️ WorkflowConfig chưa có, đang tạo mới cho workflowTemplateId=${workflowIdStr}`);
                    
                    // Lấy thông tin workflow template để tạo config
                    const template = await WorkflowTemplate.findById(workflowTemplateId).lean();
                    if (!template) {
                        throw new Error(`Không tìm thấy WorkflowTemplate ${workflowTemplateId}`);
                    }
                    
                    const stepworkflow = template.steps ? template.steps.length : 0;
                    const id_stepworkflow = {};
                    
                    // Khởi tạo id_stepworkflow cho tất cả steps
                    if (template.steps && Array.isArray(template.steps)) {
                        for (const step of template.steps) {
                            const sId = step._id ? step._id.toString() : null;
                            if (sId) {
                                id_stepworkflow[sId] = { success: false }; // Khởi tạo với success=false
                            }
                        }
                    }
                    
                    // Tạo mới workflowConfig
                    currentCustomer.workflowTemplates[workflowIdStr] = {
                        success: null,
                        repeat: null,
                        timeRepeate: null,
                        startDay: null,
                        switchButton: true,
                        units: null,
                        stepworkflow: stepworkflow,
                        id_stepworkflow: id_stepworkflow,
                        step_active: 0,
                        doneAuto: template.autoWorkflow ? 'pending' : null
                    };
                    
                    currentCustomer.markModified('workflowTemplates');
                    await currentCustomer.save();
                    
                    console.log(`[genericJobProcessor] ✅ Đã tạo mới workflowConfig cho workflowTemplateId=${workflowIdStr}`);
                    
                    // Lấy lại customer sau khi tạo
                    const updatedCustomer = await Customer.findById(customerId);
                    workflowConfig = updatedCustomer?.workflowTemplates?.[workflowIdStr];
                }
                
                // Đảm bảo id_stepworkflow[stepId] tồn tại
                if (workflowConfig) {
                    if (!workflowConfig.id_stepworkflow || typeof workflowConfig.id_stepworkflow !== 'object') {
                        workflowConfig.id_stepworkflow = {};
                    }
                    
                    // Kiểm tra xem stepId đã có trong id_stepworkflow chưa
                    if (!workflowConfig.id_stepworkflow[stepIdStr]) {
                        console.log(`[genericJobProcessor] ⚠️ Step ${stepIdStr} chưa có trong id_stepworkflow, đang khởi tạo với success=false`);
                        
                        // Khởi tạo step với success=false (sẽ cập nhật thành true sau khi action thành công)
                        await Customer.findByIdAndUpdate(
                            customerId,
                            {
                                $set: {
                                    [`workflowTemplates.${workflowIdStr}.id_stepworkflow.${stepIdStr}`]: { success: false }
                                }
                            }
                        );
                        
                        console.log(`[genericJobProcessor] ✅ Đã khởi tạo step ${stepIdStr} trong id_stepworkflow với success=false`);
                    } else {
                        console.log(`[genericJobProcessor] ✅ Step ${stepIdStr} đã tồn tại trong id_stepworkflow: success=${workflowConfig.id_stepworkflow[stepIdStr]?.success}`);
                    }
                }
            } catch (initError) {
                console.error(`[genericJobProcessor] ❌ Lỗi khi khởi tạo workflowConfig/step:`, initError);
                // Không throw error ở đây, tiếp tục thực hiện action
            }
        }

        // Ghi log bắt đầu nếu là sub-workflow step
        if (isSubWorkflowStep) {
            const actionName = actionToNameMap[jobName] || jobName;
            console.log(`[genericJobProcessor] Ghi log bắt đầu sub-workflow step: ${actionName}`);
            await logCareForStep(
                customerId,
                pipelineStep,
                `⏳ [Workflow con: ${subWorkflowName}] Đang thực hiện: ${actionName}`
            );
        }

        // 🔥 BƯỚC 2: THỰC HIỆN ACTION
        const rawMessage = params?.message || '';
        const processedMessage = await processMessage(rawMessage, customer);
        let selectedZalo;

        if (jobName === 'findUid') {
            const selection = await findNextAvailableZaloAccount();
            if (!selection.account) throw new Error(selection.reason);
            selectedZalo = selection.account;
        } else {
            if (customer.uid?.[0]?.zalo) selectedZalo = await Zalo.findById(customer.uid[0].zalo);
            if (!selectedZalo) selectedZalo = await Zalo.findOne();
            if (!selectedZalo) throw new Error('No Zalo account available for this action');
        }

        const uid = selectedZalo.uid;
        const zaloId = selectedZalo._id;
        const actionType = actionMap[jobName];
        const response = await actionZalo({ phone: customer.phone, uidPerson: customer.uid?.[0]?.uid || '', actionType, message: processedMessage, uid });

        await Logs.create({
            status: { status: response?.status || false, message: processedMessage, data: { error_code: response?.content?.error_code || null, error_message: response?.content?.error_message || (response?.status ? '' : 'Invalid response from AppScript') } },
            type: actionType, createBy: SYSTEM_USER_ID, customer: customerId, zalo: zaloId,
        });

        const stepSuccess = response?.status || false;
        if (!stepSuccess) throw new Error(response?.message || 'Action Zalo failed or returned invalid response');
        
        // 🔥 BƯỚC 3: CẬP NHẬT TRẠNG THÁI STEP SAU KHI ACTION THÀNH CÔNG
        // 🔥 QUAN TRỌNG: Cập nhật success cho TẤT CẢ steps của workflow (kể cả step delay)
        // Điều kiện: Có stepId và workflowTemplateId (không phân biệt delay hay không)
        console.log(`[genericJobProcessor] 🔍 DEBUG - Kiểm tra điều kiện cập nhật step:`, {
            isSubWorkflowStep,
            stepId: stepId || 'MISSING',
            workflowTemplateId: workflowTemplateId || 'MISSING',
            pipelineStep: pipelineStep || 'MISSING',
            subWorkflowName: subWorkflowName || 'MISSING',
            hasAllRequiredFields: !!(stepId && workflowTemplateId),
            willUpdate: !!(stepId && workflowTemplateId) // Chỉ cần stepId và workflowTemplateId
        });
        
        // 🔥 DEBUG: Log đặc biệt cho step delay 6928f5f890519d95f67c7a6c
        if (stepId && stepId.toString() === '6928f5f890519d95f67c7a6c') {
            console.log(`[genericJobProcessor] 🔥🔥🔥 STEP DELAY DETECTED - Đang xử lý step delay: stepId=6928f5f890519d95f67c7a6c 🔥🔥🔥`, {
                isSubWorkflowStep,
                hasStepId: !!stepId,
                hasWorkflowTemplateId: !!workflowTemplateId,
                hasPipelineStep: !!pipelineStep,
                hasSubWorkflowName: !!subWorkflowName,
                willUpdate: !!(stepId && workflowTemplateId),
                customerId: customerId,
                rawJobData: {
                    customerId: job.attrs.data?.customerId,
                    stepId: job.attrs.data?.stepId,
                    workflowTemplateId: job.attrs.data?.workflowTemplateId,
                    pipelineStep: job.attrs.data?.pipelineStep,
                    subWorkflowName: job.attrs.data?.subWorkflowName
                }
            });
        }
        
        // 🔥 QUAN TRỌNG: Cập nhật success cho TẤT CẢ steps có stepId và workflowTemplateId
        // Không phân biệt delay hay không, miễn là có đủ thông tin
        if (stepId && workflowTemplateId) {
            try {
                const workflowIdStr = workflowTemplateId.toString();
                const stepIdStr = stepId.toString();
                
                console.log(`[genericJobProcessor] 🔥 BƯỚC 3: Cập nhật step ${stepIdStr} success=true sau khi action thành công`);
                
                // 🔥 QUAN TRỌNG: Truy xuất khách hàng bằng customerId và xác minh workflowTemplateId, stepId trước khi cập nhật
                // Đảm bảo không cập nhật nhầm step của workflow khác
                const customerToUpdate = await Customer.findById(customerId);
                
                if (!customerToUpdate) {
                    console.error(`[genericJobProcessor] ❌ Không tìm thấy customer ${customerId} để cập nhật step success`);
                    // Không return, tiếp tục xử lý
                } else {
                    // Kiểm tra workflowTemplateId có tồn tại trong customer.workflowTemplates không
                    const workflowConfig = customerToUpdate.workflowTemplates?.[workflowIdStr];
                    
                    if (!workflowConfig) {
                        console.error(`[genericJobProcessor] ❌ WorkflowConfig ${workflowIdStr} không tồn tại trong customer ${customerId} - có thể workflow chưa được khởi tạo`);
                        // Không return, tiếp tục xử lý
                    } else {
                        // Kiểm tra stepId có tồn tại trong workflowConfig.id_stepworkflow không
                        const stepExists = workflowConfig.id_stepworkflow && 
                                         typeof workflowConfig.id_stepworkflow === 'object' && 
                                         workflowConfig.id_stepworkflow[stepIdStr];
                        
                        if (!stepExists) {
                            console.error(`[genericJobProcessor] ❌ Step ${stepIdStr} không tồn tại trong workflowConfig ${workflowIdStr} của customer ${customerId} - có thể step chưa được khởi tạo`);
                            // Không return, tiếp tục xử lý
                        } else {
                            // 🔥 QUAN TRỌNG: Sử dụng findByIdAndUpdate với $set để đảm bảo atomic update
                            // Tránh race condition khi nhiều step chạy cùng lúc
                            // Cập nhật step success = true (action đã thành công)
                            // Xác minh lại customerId, workflowIdStr, stepIdStr trước khi cập nhật
                            const updateStepResult = await Customer.findByIdAndUpdate(
                                customerId,
                                {
                                    $set: {
                                        [`workflowTemplates.${workflowIdStr}.id_stepworkflow.${stepIdStr}.success`]: true
                                    }
                                },
                                { new: true }
                            );
                            
                            if (!updateStepResult) {
                                console.error(`[genericJobProcessor] ❌ Không thể cập nhật step success cho customer ${customerId}, workflow ${workflowIdStr}, step ${stepIdStr}`);
                                // Không return, tiếp tục xử lý
                            } else {
                                const workflowConfigAfterUpdate = updateStepResult.workflowTemplates?.[workflowIdStr];
                                
                                if (!workflowConfigAfterUpdate) {
                                    console.error(`[genericJobProcessor] ❌ WorkflowConfig ${workflowIdStr} không tồn tại sau khi cập nhật step success - có thể đã bị xóa`);
                                    // Không return, tiếp tục xử lý
                                } else {
                        console.log(`[genericJobProcessor] ✅ Đã cập nhật step ${stepIdStr}: success=true`);
                        
                        // 🔥 BƯỚC 4: Tính lại step_active từ fresh data sau khi cập nhật step success
                        // 🔥 QUAN TRỌNG: Chỉ đếm steps đã CHẠY XONG (success: true), KHÔNG đếm steps có success: false (chưa chạy)
                        // success: false nghĩa là step chưa chạy hoặc chưa được khởi tạo đúng cách
                        // success: true nghĩa là step đã chạy xong và thành công
                        let stepActiveCount = 0;
                        const stepStatuses = [];
                        if (workflowConfigAfterUpdate.id_stepworkflow && typeof workflowConfigAfterUpdate.id_stepworkflow === 'object') {
                            for (const [stepIdKey, stepStatus] of Object.entries(workflowConfigAfterUpdate.id_stepworkflow)) {
                                if (stepStatus && stepStatus.success === true) {
                                    stepActiveCount++;
                                    stepStatuses.push({ stepId: stepIdKey, success: stepStatus.success, status: 'completed' });
                                } else if (stepStatus && stepStatus.success === false) {
                                    stepStatuses.push({ stepId: stepIdKey, success: stepStatus.success, status: 'not_yet_run' });
                                } else {
                                    stepStatuses.push({ stepId: stepIdKey, success: stepStatus?.success, status: 'unknown' });
                                }
                            }
                        }
                        
                        // 🔥 DEBUG: Log chi tiết để kiểm tra
                        console.log(`[genericJobProcessor] 🔍 Tính toán step_active:`, {
                            stepActiveCount: stepActiveCount,
                            stepworkflow: workflowConfigAfterUpdate.stepworkflow || 'N/A',
                            stepStatuses: stepStatuses,
                            id_stepworkflow: Object.keys(workflowConfigAfterUpdate.id_stepworkflow || {}).map(key => ({
                                stepId: key,
                                success: workflowConfigAfterUpdate.id_stepworkflow[key]?.success
                            }))
                        });
                        
                        // 🔥 BƯỚC 5: Cập nhật step_active bằng atomic operation
                        await Customer.findByIdAndUpdate(
                            customerId,
                            {
                                $set: {
                                    [`workflowTemplates.${workflowIdStr}.step_active`]: stepActiveCount
                                }
                            }
                        );
                        
                        console.log(`[genericJobProcessor] ✅ Đã cập nhật step_active=${stepActiveCount}/${workflowConfigAfterUpdate.stepworkflow || 'N/A'}`);
                        
                        // 🔥 BƯỚC 6: Kiểm tra workflow hoàn thành với fresh data
                        // 🔥 QUAN TRỌNG: Lấy lại fresh customer từ database để đảm bảo có dữ liệu mới nhất
                        // Đặc biệt quan trọng cho step delay - có thể chạy sau khi workflow đã được đánh dấu hoàn thành
                        const freshCustomer = await Customer.findById(customerId);
                        if (freshCustomer && freshCustomer.workflowTemplates?.[workflowIdStr]) {
                            const freshWorkflowConfig = freshCustomer.workflowTemplates[workflowIdStr];
                            
                            // 🔥 QUAN TRỌNG: Chỉ kiểm tra workflow hoàn thành khi step_active === stepworkflow
                            // Điều này đảm bảo tất cả steps (kể cả step delay) đã chạy xong
                            const stepworkflow = freshWorkflowConfig.stepworkflow || 0;
                            const step_active = freshWorkflowConfig.step_active || 0;
                            
                            // 🔍 DEBUG: Log chi tiết để kiểm tra
                            console.log(`[genericJobProcessor] 🔍 Kiểm tra workflow hoàn thành:`, {
                                stepworkflow: stepworkflow,
                                step_active: step_active,
                                condition: `step_active (${step_active}) === stepworkflow (${stepworkflow})`,
                                willCheck: step_active === stepworkflow && stepworkflow > 0,
                                currentSuccess: freshWorkflowConfig.success,
                                id_stepworkflow: Object.keys(freshWorkflowConfig.id_stepworkflow || {}).map(key => ({
                                    stepId: key,
                                    success: freshWorkflowConfig.id_stepworkflow[key]?.success
                                }))
                            });
                            
                            // 🔥 QUAN TRỌNG: Chỉ cập nhật success khi step_active === stepworkflow
                            // Đảm bảo tất cả steps (kể cả step delay) đã chạy xong
                            if (stepworkflow > 0 && step_active === stepworkflow) {
                                // Tất cả steps đã chạy xong, kiểm tra xem tất cả đều success chưa
                                let allStepsSuccess = true;
                                let allStepsCompleted = true;
                                
                                for (const stepStatus of Object.values(freshWorkflowConfig.id_stepworkflow || {})) {
                                    if (!stepStatus) {
                                        allStepsCompleted = false;
                                        break;
                                    }
                                    if (stepStatus.success === true) {
                                        // Step đã success
                                    } else if (stepStatus.success === false) {
                                        allStepsSuccess = false;
                                    } else if (stepStatus.success === null || stepStatus.success === undefined) {
                                        // Step chưa được đánh dấu success/failure
                                        allStepsCompleted = false;
                                        break;
                                    }
                                }
                                
                                // 🔥 QUAN TRỌNG: Luôn cập nhật lại success của workflow nếu tất cả steps đã hoàn thành
                                // Điều này đảm bảo rằng nếu step delay chạy sau khi workflow đã được đánh dấu success=false,
                                // nó sẽ được cập nhật lại thành success=true nếu tất cả steps đều thành công
                                if (allStepsCompleted) {
                                    // Kiểm tra xem success có thay đổi không
                                    const currentSuccess = freshWorkflowConfig.success;
                                    const needsUpdate = currentSuccess !== allStepsSuccess;
                                    
                                    if (needsUpdate) {
                                        console.log(`[genericJobProcessor] 🔄 Phát hiện thay đổi success: ${currentSuccess} → ${allStepsSuccess} (có thể do step delay chạy sau)`);
                                    }
                                    
                                    // Cập nhật success và doneAuto bằng atomic operation
                                    const updateFields = {
                                        [`workflowTemplates.${workflowIdStr}.success`]: allStepsSuccess
                                    };
                                    
                                    // Nếu workflow auto và đã hoàn thành, đánh dấu doneAuto = "done"
                                    if (freshWorkflowConfig.doneAuto === 'pending') {
                                        updateFields[`workflowTemplates.${workflowIdStr}.doneAuto`] = 'done';
                                        console.log(`[genericJobProcessor] ✅ Workflow con auto đã hoàn thành → doneAuto = "done"`);
                                    }
                                    
                                    await Customer.findByIdAndUpdate(
                                        customerId,
                                        { $set: updateFields }
                                    );
                                    
                                    console.log(`[genericJobProcessor] ✅ Workflow con đã hoàn thành: success=${allStepsSuccess}, step_active=${step_active}/${stepworkflow}${needsUpdate ? ' (đã cập nhật lại)' : ''}`);
                                    
                                    // 🔥 QUAN TRỌNG: Đồng bộ hóa statusWorkflow trong RepetitionTime với success của workflow con
                                    // Khi success của workflow con thay đổi → cập nhật statusWorkflow tương ứng
                                    // success = true → statusWorkflow = "done"
                                    // success = false → statusWorkflow = "failed"
                                    // Đặc biệt quan trọng cho step delay - có thể chạy sau khi workflow đã được đánh dấu failed
                                    console.log(`[genericJobProcessor] 🔄 Đồng bộ hóa: Đang cập nhật statusWorkflow trong repetitiontimes theo success=${allStepsSuccess}...`);
                                    await checkAndUpdateRepetitionTimeStatus(customerId, workflowTemplateId);
                                } else {
                                    console.log(`[genericJobProcessor] ⏳ Workflow con chưa hoàn thành: có step chưa được đánh dấu (null/undefined), step_active=${step_active}/${stepworkflow}`);
                                }
                            } else {
                                console.log(`[genericJobProcessor] ⏳ Workflow con chưa hoàn thành: step_active=${step_active}/${stepworkflow} (cần tất cả steps chạy xong)`);
                            }
                        } else {
                            console.error(`[genericJobProcessor] ❌ Không tìm thấy freshWorkflowConfig sau khi cập nhật step success`);
                        }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`[genericJobProcessor] ❌ Lỗi khi cập nhật trạng thái step:`, error);
            }
        }

        switch (jobName) {
            case 'friendRequest':
                if (customer.uid.length > 0) {
                    customer.uid[0].isReques = 1;
                    customer.pipelineStatus = 'consulted';
                    await customer.save();
                    triggerRevalidation();
                }
                break;
            case 'checkFriend':
                if (customer.uid.length > 0) {
                    customer.uid[0].isFriend = response.content?.isFriend ? 1 : 0;
                    await customer.save();
                    triggerRevalidation();
                }
                break;
            case 'tag':
                if (processedMessage) {
                    customer.zaloname = processedMessage;
                    await customer.save();
                    triggerRevalidation();
                }
                break;
            case 'message':
                const newStatus = response?.status ? 'msg_success_2' : 'msg_error_2';
                await Customer.updateOne({ _id: customerId }, {
                    $set: {
                        'pipelineStatus.0': newStatus,
                        'pipelineStatus.2': newStatus
                    }
                });
                triggerRevalidation();
                
                // Lưu workflow WF2 (B2: Gửi tin nhắn) vào workflowTemplates
                if (cwId) {
                    // Nếu có cwId, lấy workflow ID từ CustomerWorkflow
                    try {
                        const cw = await CustomerWorkflow.findById(cwId).populate('templateId').lean();
                        if (cw && cw.templateId) {
                            const workflowId = cw.templateId._id.toString();
                            const customer = await Customer.findById(customerId);
                            if (customer) {
                                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                                    customer.workflowTemplates = {};
                                }
                                if (!customer.workflowTemplates[workflowId]) {
                                    customer.workflowTemplates[workflowId] = { success: null };
                                }
                                customer.workflowTemplates[workflowId].success = response?.status || false;
                                customer.markModified('workflowTemplates');
                                await customer.save();
                                console.log(`[genericJobProcessor] Đã lưu workflow WF2 vào workflowTemplates: ${workflowId}, success: ${customer.workflowTemplates[workflowId].success}`);
                            }
                        }
                    } catch (error) {
                        console.error('[genericJobProcessor] Lỗi khi lưu workflow WF2:', error);
                    }
                } else {
                    // Nếu không có cwId, tìm workflow từ database
                    try {
                        const messageWorkflowId = await getWorkflowIdByName('B2.*Gửi tin nhắn');
                        if (messageWorkflowId) {
                            const customer = await Customer.findById(customerId);
                            if (customer) {
                                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                                    customer.workflowTemplates = {};
                                }
                                if (!customer.workflowTemplates[messageWorkflowId]) {
                                    customer.workflowTemplates[messageWorkflowId] = { success: null };
                                }
                                customer.workflowTemplates[messageWorkflowId].success = response?.status || false;
                                customer.markModified('workflowTemplates');
                                await customer.save();
                                console.log(`[genericJobProcessor] Đã lưu workflow WF2 vào workflowTemplates: ${messageWorkflowId}, success: ${customer.workflowTemplates[messageWorkflowId].success}`);
                            }
                        }
                    } catch (error) {
                        console.error('[genericJobProcessor] Lỗi khi lưu workflow WF2:', error);
                    }
                }
                break;
            case 'findUid':
                await Zalo.updateOne({ _id: zaloId }, { $inc: { rateLimitPerHour: -1, rateLimitPerDay: -1 } });
                const foundUid = response.content?.data?.uid;
                if (foundUid) {
                    customer.uid = [{ zalo: zaloId, uid: normalizeUid(foundUid), isFriend: 0, isReques: 0 }];
                    customer.zaloavt = response.content?.data?.avatar || null;
                    customer.zaloname = response.content?.data?.zalo_name || null;
                    customer.pipelineStatus[0] = 'valid_1';
                    customer.pipelineStatus[1] = 'valid_1';
                    await customer.save();
                    triggerRevalidation();
                } else {
                    customer.pipelineStatus[0] = 'valid_1';
                    customer.pipelineStatus[1] = 'valid_1';
                    await customer.save();
                    triggerRevalidation();
                }
                // Lấy workflow ID từ database thay vì hardcode
                setImmediate(async () => {
                    const messageWorkflowId = await getWorkflowIdByName('B2.*Gửi tin nhắn');
                    if (messageWorkflowId) {
                        await attachWorkflow(customerId, messageWorkflowId).catch(console.error);
                    } else {
                        console.error('[findUid] Không tìm thấy workflow "B2: Gửi tin nhắn xác nhận qua zalo"');
                    }
                });
                break;
        }
        
        // Ghi log hoàn thành
        if (isSubWorkflowStep) {
            const actionName = actionToNameMap[jobName] || jobName;
            const logContent = `✅ [Workflow con: ${subWorkflowName}] Hoàn thành: ${actionName}${processedMessage ? ` - "${processedMessage.substring(0, 50)}${processedMessage.length > 50 ? '...' : ''}"` : ''}`;
            console.log(`[genericJobProcessor] Ghi log hoàn thành sub-workflow step: ${logContent}`);
            await logCareForStep(
                customerId,
                pipelineStep,
                logContent
            );
        } else {
            await logCareHistory(customerId, jobName, 'success');
        }
        
        // Lấy thông tin sub-workflow từ job data
        const { parentStepId, parentCwId } = job.attrs.data || {};
        await updateStepStatus(cwId, jobName, 'completed', customerId, parentStepId, parentCwId);
    } catch (error) {
        console.error(`[Job ${jobName}] Xảy ra lỗi: "${error.message}"`);
        
        // Cập nhật trạng thái step thất bại trong customers.workflowTemplates nếu là sub-workflow step
        if (isSubWorkflowStep && stepId && workflowTemplateId) {
            try {
                const customer = await Customer.findById(customerId);
                if (customer) {
                    const workflowIdStr = workflowTemplateId.toString();
                    const workflowConfig = customer.workflowTemplates?.[workflowIdStr];
                    
                    if (workflowConfig) {
                        // Khởi tạo id_stepworkflow nếu chưa có
                        if (!workflowConfig.id_stepworkflow || typeof workflowConfig.id_stepworkflow !== 'object') {
                            workflowConfig.id_stepworkflow = {};
                        }
                        
                        // Cập nhật success của step này = false
                        workflowConfig.id_stepworkflow[stepId] = {
                            success: false
                        };
                        
                        // Tính step_active dựa trên số step đã có trạng thái (success hoặc false) (tránh race condition)
                        let stepActiveCount = 0;
                        for (const stepStatus of Object.values(workflowConfig.id_stepworkflow || {})) {
                            if (stepStatus && (stepStatus.success === true || stepStatus.success === false)) {
                                stepActiveCount++;
                            }
                        }
                        workflowConfig.step_active = stepActiveCount;
                        
                        console.log(`[genericJobProcessor] ❌ Đã cập nhật step ${stepId}: success=false, step_active=${workflowConfig.step_active}/${workflowConfig.stepworkflow || 'N/A'}`);
                        
                        // Kiểm tra xem đã chạy hết tất cả steps chưa
                        const stepworkflow = workflowConfig.stepworkflow || 0;
                        const step_active = workflowConfig.step_active || 0;
                        
                        // 🔥 QUAN TRỌNG: Chỉ cập nhật success khi step_active === stepworkflow
                        // Đảm bảo tất cả steps (kể cả step delay) đã chạy xong
                        if (stepworkflow > 0 && step_active === stepworkflow) {
                            // Đã chạy hết tất cả steps, có ít nhất 1 step thất bại
                            workflowConfig.success = false;
                            
                            customer.markModified('workflowTemplates');
                            await customer.save();
                            
                            console.log(`[genericJobProcessor] ❌ Workflow con đã hoàn thành với lỗi: success=false, step_active=${step_active}/${stepworkflow}`);
                            
                            // 🔥 QUAN TRỌNG: Đồng bộ hóa statusWorkflow trong RepetitionTime với success = false
                            // success = false → statusWorkflow = "failed"
                            console.log(`[genericJobProcessor] 🔄 Đồng bộ hóa: Đang cập nhật statusWorkflow trong repetitiontimes theo success=false...`);
                            await checkAndUpdateRepetitionTimeStatus(customerId, workflowTemplateId);
                        } else {
                            // Chưa chạy hết, chỉ cập nhật step hiện tại
                            console.log(`[genericJobProcessor] ⏳ Chưa chạy hết tất cả steps: step_active=${step_active}/${stepworkflow}, chỉ cập nhật step hiện tại`);
                            customer.markModified('workflowTemplates');
                            await customer.save();
                        }
                    }
                }
            } catch (updateError) {
                console.error(`[genericJobProcessor] ❌ Lỗi khi cập nhật trạng thái step thất bại:`, updateError);
            }
        }
        
        // Ghi log thất bại
        if (isSubWorkflowStep) {
            const actionName = actionToNameMap[jobName] || jobName;
            const logContent = `❌ [Workflow con: ${subWorkflowName}] Thất bại: ${actionName} - ${error.message}`;
            console.log(`[genericJobProcessor] Ghi log thất bại sub-workflow step: ${logContent}`);
            await logCareForStep(
                customerId,
                pipelineStep,
                logContent
            );
        } else {
            await logCareHistory(customerId, jobName, 'failed', error.message);
        }
        
        const { parentStepId, parentCwId } = job.attrs.data || {};
        if (RETRYABLE_ERRORS.includes(error.message)) {
            await handleJobFailure(job, error, cwId, jobName);
        } else {
            await updateStepStatus(cwId, jobName, 'failed', customerId, parentStepId, parentCwId);
        }
    }
}

/**
 * Hàm xử lý job 'allocation' (Bước đầu của WF3) - Phân bổ khách hàng cho đội tuyển sinh.
 * @param {import('agenda').Job} job - Đối tượng job từ Agenda.
 */
async function allocationJobProcessor(job) {
    const { customerId, cwId } = job.attrs.data;
    const jobName = 'allocation';
    console.log(`[Job ${jobName}] Bắt đầu xử lý cho KH: ${customerId}`);
    let newStatus = 'undetermined_3'
    try {
        const customer = await Customer.findById(customerId);
        if (!customer) throw new Error(`Không tìm thấy KH ID: ${customerId}`);
        if (!customer.uid || customer.uid.length === 0) throw new Error(`KH ${customerId} chưa có UID để phân bổ.`);

        const requiredGroups = await getRequiredGroups(customer.tags);
        if (requiredGroups.length === 0) {
            console.log(`[Job ${jobName}] KH ${customerId} không có tag ngành học nào cần phân bổ.`);
            await logCareHistory(customerId, jobName, 'success', 'Không có tag ngành học nào cần phân bổ.');
            await updateStepStatus(cwId, jobName, 'completed', customerId);
            return;
        }

        const zaloAccountId = customer.uid[0].zalo;
        let assignmentsMade = 0;
        for (const group of requiredGroups) {
            const isAlreadyAssigned = customer.assignees.some(a => a.group === group);
            if (isAlreadyAssigned) {
                console.log(`[Job ${jobName}] KH đã được gán cho nhóm ${group}. Bỏ qua.`);
                continue;
            }
            const nextStaff = await findNextEnrollmentForGroup(group, zaloAccountId);
            if (nextStaff) {
                customer.assignees.push({ user: nextStaff._id, group: group, assignedAt: new Date() });
                assignmentsMade++;
                console.log(`[Job ${jobName}] Đã gán KH ${customerId} cho nhân sự ${nextStaff._id} nhóm ${group}.`);

                // ==========================================================
                // == THÊM LOGIC CẬP NHẬT newStatus TẠI ĐÂY ==
                if (group === 'telesale' || group === 'telesale_TuVan') {
                    newStatus = 'telesale_TuVan3';
                } else if (group === 'care' || group === 'CareService') {
                    newStatus = 'CareService3';
                }
                // ==========================================================

            } else {
        console.log(`[Job ${jobName}] Không tìm thấy nhân sự phù hợp cho nhóm ${group}.`);
            }
        }

        customer.pipelineStatus[0] = newStatus;
        customer.pipelineStatus[3] = newStatus;
        
        // Lưu workflow WF3 (B3: Phân bổ) vào workflowTemplates
        if (cwId) {
            // Nếu có cwId, lấy workflow ID từ CustomerWorkflow
            try {
                const cw = await CustomerWorkflow.findById(cwId).populate('templateId').lean();
                if (cw && cw.templateId) {
                    const workflowId = cw.templateId._id.toString();
                    if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                        customer.workflowTemplates = {};
                    }
                    if (!customer.workflowTemplates[workflowId]) {
                        customer.workflowTemplates[workflowId] = { success: null };
                    }
                    customer.workflowTemplates[workflowId].success = newStatus !== 'undetermined_3';
                    customer.markModified('workflowTemplates');
                    console.log(`[allocationJobProcessor] Đã lưu workflow WF3 vào workflowTemplates: ${workflowId}, success: ${customer.workflowTemplates[workflowId].success}`);
                }
            } catch (error) {
                console.error('[allocationJobProcessor] Lỗi khi lưu workflow WF3:', error);
            }
        } else {
            // Nếu không có cwId, tìm workflow từ database
            try {
                const allocationWorkflowId = await getWorkflowIdByName('B3.*Phân bổ');
                if (allocationWorkflowId) {
                    if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                        customer.workflowTemplates = {};
                    }
                    if (!customer.workflowTemplates[allocationWorkflowId]) {
                        customer.workflowTemplates[allocationWorkflowId] = { success: null };
                    }
                    customer.workflowTemplates[allocationWorkflowId].success = newStatus !== 'undetermined_3';
                    customer.markModified('workflowTemplates');
                    console.log(`[allocationJobProcessor] Đã lưu workflow WF3 vào workflowTemplates: ${allocationWorkflowId}, success: ${customer.workflowTemplates[allocationWorkflowId].success}`);
                }
            } catch (error) {
                console.error('[allocationJobProcessor] Lỗi khi lưu workflow WF3:', error);
            }
        }
        
        await customer.save();
        triggerRevalidation();
        const { pipelineStep, subWorkflowName } = job.attrs.data || {};
        const isSubWorkflowStep = !!pipelineStep && !!subWorkflowName;
        
        if (isSubWorkflowStep) {
            await logCareForStep(
                customerId,
                pipelineStep,
                `✅ [Workflow con: ${subWorkflowName}] Hoàn thành: Phân bổ cho đội tuyển sinh`
            );
        } else {
            await logCareHistory(customerId, jobName, newStatus == 'undetermined_3' ? 'failed' : 'success');
        }
        
        const { parentStepId, parentCwId } = job.attrs.data || {};
        await updateStepStatus(cwId, jobName, 'completed', customerId, parentStepId, parentCwId);
    } catch (error) {
        console.error(`[Job ${jobName}] Lỗi nghiêm trọng: "${error.message}"`);
        
        const { pipelineStep, subWorkflowName } = job.attrs.data || {};
        const isSubWorkflowStep = !!pipelineStep && !!subWorkflowName;
        
        if (isSubWorkflowStep) {
            await logCareForStep(
                customerId,
                pipelineStep,
                `❌ [Workflow con: ${subWorkflowName}] Thất bại: Phân bổ cho đội tuyển sinh - ${error.message}`
            );
        } else {
            await logCareHistory(customerId, jobName, 'failed', error.message);
        }
        
        const { parentStepId, parentCwId } = job.attrs.data || {};
        await updateStepStatus(cwId, jobName, 'failed', customerId, parentStepId, parentCwId);
    }
}

/**
 * Hàm xử lý job 'bell' (Bước sau của WF3) - Gửi thông báo hệ thống.
 * @param {import('agenda').Job} job - Đối tượng job từ Agenda.
 */
async function bellJobProcessor(job) {
    const { customerId, cwId } = job.attrs.data;
    const jobName = 'bell';
    console.log(`[Job ${jobName}] Bắt đầu gửi thông báo cho KH: ${customerId}`);
    try {
        const customer = await Customer.findById(customerId).populate('care.createBy', 'name').lean();
        if (!customer) throw new Error(`Không tìm thấy KH ID: ${customerId}`);

        // BƯỚC 1: Trích xuất các ID người dùng từ trong content để tra cứu tên
        const manualAddRegex = /bởi ([0-9a-f]{24})\.$/;
        const userIdsFromContent = new Set();
        customer.care.forEach(entry => {
            const match = entry.content.match(manualAddRegex);
            if (match && match[1]) {
                userIdsFromContent.add(match[1]);
            }
        });

        // BƯỚC 2: Tra cứu tên từ các ID đã thu thập được
        const idToNameMap = new Map();
        if (userIdsFromContent.size > 0) {
            const users = await User.find({ _id: { $in: Array.from(userIdsFromContent) } }).select('name').lean();
            users.forEach(user => {
                idToNameMap.set(user._id.toString(), user.name);
            });
        }

        // BƯỚC 3: Gọi hàm format với map chứa tên đã tra cứu
        const careHistoryMessage = formatCareHistoryForNotification(customer.care, idToNameMap);

        const assignedUsers = await User.find({ _id: { $in: customer.assignees.map(a => a.user) } }).select('name').lean();
        const assignedNames = assignedUsers.map(u => u.name).join(', ');
        const finalMessage = `🔔 KHÁCH HÀNG MỚI\n` + `--------------------\n` + `👤 Tên: ${customer.name}\n` + `📞 SĐT: ${customer.phone}\n` + `👨‍💼 NV được gán: ${assignedNames || 'Chưa có'}\n` + `--------------------\n` + `LỊCH SỬ CHĂM SÓC:\n${careHistoryMessage}`;

        const success = await sendGP(finalMessage);

        if (!success) throw new Error('Gửi thông báo qua Google Apps Script thất bại');

        console.log(`[Job ${jobName}] Đã gửi thông báo thành công cho KH ${customerId}.`);
        
        // Lưu workflow WF3 (B3: Phân bổ) vào workflowTemplates nếu chưa có
        // (bell là step của WF3, nên cần đảm bảo WF3 được lưu)
        const { cwId } = job.attrs.data || {};
        if (cwId) {
            try {
                const cw = await CustomerWorkflow.findById(cwId).populate('templateId').lean();
                if (cw && cw.templateId) {
                    const workflowId = cw.templateId._id.toString();
                    const customerDoc = await Customer.findById(customerId);
                    if (customerDoc) {
                        if (!customerDoc.workflowTemplates || typeof customerDoc.workflowTemplates !== 'object' || Array.isArray(customerDoc.workflowTemplates)) {
                            customerDoc.workflowTemplates = {};
                        }
                        if (!customerDoc.workflowTemplates[workflowId]) {
                            customerDoc.workflowTemplates[workflowId] = { success: null };
                        }
                        // Cập nhật success nếu chưa có hoặc đang là null
                        if (customerDoc.workflowTemplates[workflowId].success === null) {
                            customerDoc.workflowTemplates[workflowId].success = true; // bell thành công
                        }
                        customerDoc.markModified('workflowTemplates');
                        await customerDoc.save();
                        console.log(`[bellJobProcessor] Đã lưu/cập nhật workflow WF3 vào workflowTemplates: ${workflowId}`);
                    }
                }
            } catch (error) {
                console.error('[bellJobProcessor] Lỗi khi lưu workflow WF3:', error);
            }
        }
        
        const { pipelineStep, subWorkflowName } = job.attrs.data || {};
        const isSubWorkflowStep = !!pipelineStep && !!subWorkflowName;
        
        if (isSubWorkflowStep) {
            await logCareForStep(
                customerId,
                pipelineStep,
                `✅ [Workflow con: ${subWorkflowName}] Hoàn thành: Gửi thông báo hệ thống`
            );
        } else {
            await logCareHistory(customerId, jobName, 'success');
        }
        
        const { parentStepId, parentCwId } = job.attrs.data || {};
        await updateStepStatus(cwId, jobName, 'completed', customerId, parentStepId, parentCwId);
    } catch (error) {
        console.error(`[Job ${jobName}] Xảy ra lỗi: "${error.message}"`);
        
        const { pipelineStep, subWorkflowName } = job.attrs.data || {};
        const isSubWorkflowStep = !!pipelineStep && !!subWorkflowName;
        
        if (isSubWorkflowStep) {
            await logCareForStep(
                customerId,
                pipelineStep,
                `❌ [Workflow con: ${subWorkflowName}] Thất bại: Gửi thông báo hệ thống - ${error.message}`
            );
        } else {
            await logCareHistory(customerId, jobName, 'failed', error.message);
        }
        
        const { parentStepId, parentCwId } = job.attrs.data || {};
        await updateStepStatus(cwId, jobName, 'failed', customerId, parentStepId, parentCwId);
    }
}


// =============================================================
// == 3. CÁC HÀM HELPER QUẢN LÝ WORKFLOW VÀ JOB
// =============================================================

/**
 * Tìm các sub-workflow cần chèn vào workflow chính dựa trên workflow_position
 * @param {number} pipelineStep - Số thứ tự step trong pipeline (1-6)
 * @returns {Promise<Array>} Danh sách sub-workflow templates
 */
async function findSubWorkflowsForStep(pipelineStep) {
    const subWorkflows = await WorkflowTemplate.find({
        isSubWorkflow: true,
        workflow_position: pipelineStep
    }).lean();
    return subWorkflows;
}

/**
 * Tự động thiết lập thời gian kích hoạt workflow con khi bước cha hoàn thành
 * @param {string} customerId - ID của customer
 * @param {number} pipelineStep - Số thứ tự step trong pipeline (1-6)
 * @param {Date} parentActionCompletedTime - Thời gian hoàn thành hành động cha
 */
async function autoSetupRepetitionWorkflow(customerId, pipelineStep, parentActionCompletedTime) {
    try {
        console.log(`[autoSetupRepetitionWorkflow] Bắt đầu thiết lập workflow con cho step ${pipelineStep}, customer ${customerId}`);
        
        // Tìm tất cả workflow con cho step này (không phân biệt autoWorkflow)
        const allSubWorkflows = await WorkflowTemplate.find({
            isSubWorkflow: true,
            workflow_position: pipelineStep
        }).lean();
        
        if (allSubWorkflows.length === 0) {
            console.log(`[autoSetupRepetitionWorkflow] Không có workflow con nào cho step ${pipelineStep}`);
            return;
        }
        
        // Tìm workflow con có autoWorkflow = true
        const autoWorkflow = allSubWorkflows.find(wf => wf.autoWorkflow === true);
        
        let startDayTime = parentActionCompletedTime;
        
        // TRƯỜNG HỢP 1: Có workflow con autoWorkflow
        if (autoWorkflow) {
            console.log(`[autoSetupRepetitionWorkflow] Tìm thấy workflow con auto: "${autoWorkflow.name}"`);
            
            // Kiểm tra xem auto workflow đã từng chạy chưa (có record trong workflowTemplates với success !== null)
            const customer = await Customer.findById(customerId);
            if (!customer) {
                console.error(`[autoSetupRepetitionWorkflow] Không tìm thấy customer ${customerId}`);
                return;
            }
            
            const autoWorkflowIdStr = autoWorkflow._id.toString();
            
            // Kiểm tra và khởi tạo workflowTemplates nếu cần
            if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                customer.workflowTemplates = {};
            }
            
            const existingAutoWorkflowConfig = customer.workflowTemplates[autoWorkflowIdStr];
            
            // Nếu auto workflow đã từng chạy (success !== null), không chạy lại
            if (existingAutoWorkflowConfig && existingAutoWorkflowConfig.success !== null) {
                console.log(`[autoSetupRepetitionWorkflow] ⚠️ Workflow tự động "${autoWorkflow.name}" đã hoàn thành (success=${existingAutoWorkflowConfig.success}) - hiện tại không kích hoạt`);
                startDayTime = new Date(); // Nếu đã hoàn thành, lấy thời gian hiện tại làm startDayTime
            } else {
                // Auto workflow chưa chạy hoặc đang pending (success === null) → chạy ngay
                console.log(`[autoSetupRepetitionWorkflow] Workflow tự động "${autoWorkflow.name}" chưa chạy hoặc đang pending - kích hoạt ngay`);
                
                // Đảm bảo có record trong workflowTemplates
                if (!existingAutoWorkflowConfig) {
                    customer.workflowTemplates[autoWorkflowIdStr] = {
                        success: null,
                        repeat: null,
                        timeRepeate: null,
                        startDay: null,
                        switchButton: true,
                        units: null,
                        stepworkflow: autoWorkflow.steps ? autoWorkflow.steps.length : 0,
                        id_stepworkflow: {},
                        step_active: 0,
                        doneAuto: 'pending' // Workflow auto chưa chạy
                    };
                    customer.markModified('workflowTemplates');
                    await customer.save();
                }
                
                // Kiểm tra doneAuto: workflow auto chỉ chạy 1 lần duy nhất
                const customerIdStr = customerId.toString();
                const workflowConfig = customer.workflowTemplates?.[autoWorkflowIdStr];
                const doneAuto = workflowConfig?.doneAuto || 'pending';
                
                // Nếu doneAuto = "done" → workflow auto đã chạy 1 lần, không chạy lại
                if (doneAuto === 'done') {
                    console.log(`[autoSetupRepetitionWorkflow] Workflow auto "${autoWorkflow.name}" đã chạy 1 lần (doneAuto="done") → không auto chạy lại`);
                    return; // Không chạy auto workflow nữa
                }
                
                // Kiểm tra switchButton: nếu false thì không chạy
                if (workflowConfig?.switchButton === false) {
                    console.log(`[autoSetupRepetitionWorkflow] Workflow auto "${autoWorkflow.name}" có switchButton=false → không chạy`);
                    return;
                }
                
                // Workflow auto chưa chạy (doneAuto = "pending") → chạy ngay
                console.log(`[autoSetupRepetitionWorkflow] Workflow auto "${autoWorkflow.name}" chưa chạy (doneAuto="pending") → kích hoạt ngay`);
                
                // Kiểm tra đã có repetitiontimes chưa (nếu có thì không chạy lại)
                let existingAutoRepetitionTime = await RepetitionTime.findOne({
                    customerId: customerIdStr,
                    workflowTemplateId: autoWorkflowIdStr
                });
                
                if (existingAutoRepetitionTime) {
                    console.log(`[autoSetupRepetitionWorkflow] ⚠️ Đã có repetitiontimes cho workflow này (ID: ${existingAutoRepetitionTime._id}) - không chạy lại`);
                    return;
                }
                
                // Lấy giá trị mặc định (theo DEFAULT_SUBWORKFLOW_CONFIG)
                const DEFAULT_REPEAT = 1;
                const DEFAULT_TIME_REPEATE = '1 seconds';
                const DEFAULT_UNITS = 'seconds';
                
                // Parse timeRepeate để lấy units
                const parts = DEFAULT_TIME_REPEATE.trim().split(' ');
                const unit = parts.length >= 2 ? parts[1].toLowerCase() : 'seconds';
                const unitNormalizeMap = {
                    'second': 'seconds', 'seconds': 'seconds', 'giây': 'seconds',
                    'minute': 'minutes', 'minutes': 'minutes', 'phút': 'minutes',
                    'hour': 'hours', 'hours': 'hours', 'giờ': 'hours',
                    'day': 'days', 'days': 'days', 'ngày': 'days',
                };
                const normalizedUnits = unitNormalizeMap[unit] || DEFAULT_UNITS;
                
                // Cập nhật workflowTemplates với startDay và các giá trị mặc định
                if (!existingAutoWorkflowConfig) {
                    // Khởi tạo id_stepworkflow cho tất cả steps
                    const id_stepworkflow = {};
                    if (autoWorkflow.steps && Array.isArray(autoWorkflow.steps)) {
                        for (const step of autoWorkflow.steps) {
                            const stepId = step._id ? step._id.toString() : null;
                            if (stepId) {
                                id_stepworkflow[stepId] = { success: false };
                            }
                        }
                    }
                    
                    customer.workflowTemplates[autoWorkflowIdStr] = {
                        success: null,
                        repeat: DEFAULT_REPEAT,
                        timeRepeate: DEFAULT_TIME_REPEATE,
                        startDay: parentActionCompletedTime.toISOString(),
                        switchButton: true,
                        units: normalizedUnits,
                        stepworkflow: autoWorkflow.steps ? autoWorkflow.steps.length : 0,
                        id_stepworkflow: id_stepworkflow,
                        step_active: 0,
                        doneAuto: 'pending'
                    };
                } else {
                    // Cập nhật startDay và các giá trị mặc định nếu chưa có
                    if (!existingAutoWorkflowConfig.startDay) {
                        existingAutoWorkflowConfig.startDay = parentActionCompletedTime.toISOString();
                    }
                    if (!existingAutoWorkflowConfig.repeat) {
                        existingAutoWorkflowConfig.repeat = DEFAULT_REPEAT;
                    }
                    if (!existingAutoWorkflowConfig.timeRepeate) {
                        existingAutoWorkflowConfig.timeRepeate = DEFAULT_TIME_REPEATE;
                    }
                    if (!existingAutoWorkflowConfig.units) {
                        existingAutoWorkflowConfig.units = normalizedUnits;
                    }
                    existingAutoWorkflowConfig.switchButton = true;
                }
                customer.markModified('workflowTemplates');
                await customer.save();
                console.log(`[autoSetupRepetitionWorkflow] ✅ Đã cập nhật workflowTemplates với startDay: ${parentActionCompletedTime.toISOString()}, repeat: ${DEFAULT_REPEAT}, timeRepeate: ${DEFAULT_TIME_REPEATE}, units: ${normalizedUnits}`);
                
                // Tạo record trong repetitiontimes
                console.log(`[autoSetupRepetitionWorkflow] Create new repetitiontimes for workflowTemplateId ${autoWorkflowIdStr} (auto workflow)`);
                try {
                    await RepetitionTime.create({
                        customerId: customerIdStr,
                        workflowTemplateId: autoWorkflowIdStr,
                        workflowName: autoWorkflow.name,
                        iterationIndex: [],
                        indexAction: 0,
                        statusWorkflow: 'pending',
                        units: normalizedUnits,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    console.log(`[autoSetupRepetitionWorkflow] ✅ Đã tạo mới record repetitionTime cho auto workflow`);
                } catch (createError) {
                    if (createError.code === 11000) {
                        console.log(`[autoSetupRepetitionWorkflow] ⚠️ Duplicate key error, fallback to updateOne`);
                        await RepetitionTime.updateOne(
                            { customerId: customerIdStr, workflowTemplateId: autoWorkflowIdStr },
                            {
                                $set: {
                                    workflowName: autoWorkflow.name,
                                    units: normalizedUnits,
                                    updatedAt: new Date()
                                }
                            }
                        );
                    } else {
                        throw createError;
                    }
                }
                
                // Chạy workflow con auto với startDay = parentActionCompletedTime
                await runChildWorkflow(customerId, autoWorkflow._id, parentActionCompletedTime);
                
                // Đợi workflow con auto hoàn thành (tối đa 30 giây)
                const maxWaitTime = 30000; // 30 giây
                const checkInterval = 1000; // 1 giây
                let waitedTime = 0;
                let autoCompleted = false;
                
                while (waitedTime < maxWaitTime && !autoCompleted) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    waitedTime += checkInterval;
                    
                    // Kiểm tra xem workflow con auto đã hoàn thành chưa
                    const customerCheck = await Customer.findById(customerId).lean();
                    if (customerCheck?.workflowTemplates?.[autoWorkflowIdStr]?.success !== null) {
                        autoCompleted = true;
                        console.log(`[autoSetupRepetitionWorkflow] Workflow con auto đã hoàn thành sau ${waitedTime/1000}s`);
                    }
                }
                
                if (autoCompleted) {
                    // Lấy thời gian hoàn thành workflow con auto
                    startDayTime = new Date(); // Thời gian hiện tại (sau khi hoàn thành)
                    console.log(`[autoSetupRepetitionWorkflow] Lấy autoEndTime: ${startDayTime.toISOString()}`);
                } else {
                    console.warn(`[autoSetupRepetitionWorkflow] Workflow con auto chưa hoàn thành sau ${maxWaitTime/1000}s, dùng parentActionCompletedTime`);
                }
            }
        }
        
        // TRƯỜNG HỢP 2: Không có workflow con autoWorkflow hoặc đã lấy autoEndTime
        // startDay = (autoEndTime hoặc parentActionCompletedTime) + 1 phút
        const startDay = new Date(startDayTime.getTime() + 60 * 1000); // +1 phút
        
        console.log(`[autoSetupRepetitionWorkflow] startDay được tính: ${startDay.toISOString()}`);
        
        // Xử lý các workflow con không phải autoWorkflow (workflow con lặp lại)
        const repetitionWorkflows = allSubWorkflows.filter(wf => !wf.autoWorkflow);
        
        for (const workflowTemplate of repetitionWorkflows) {
            // Lấy cấu hình từ customer.workflowTemplates (nếu có)
            const customer = await Customer.findById(customerId);
            if (!customer) continue;
            
            const workflowIdStr = workflowTemplate._id.toString();
            
            // Kiểm tra và khởi tạo workflowTemplates nếu cần
            if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                customer.workflowTemplates = {};
            }
            
            if (!customer.workflowTemplates[workflowIdStr]) {
                customer.workflowTemplates[workflowIdStr] = {
                    success: null,
                    repeat: null,
                    timeRepeate: null,
                    startDay: null,
                    switchButton: true
                };
            }
            
            const config = customer.workflowTemplates[workflowIdStr];
            
            // Chỉ thiết lập nếu chưa có startDay hoặc switchButton = true
            if (config.switchButton && config.repeat && config.timeRepeate) {
                // Cập nhật startDay
                config.startDay = startDay.toISOString();
                customer.markModified('workflowTemplates');
                await customer.save();
                
                console.log(`[autoSetupRepetitionWorkflow] Đã cập nhật startDay cho workflow "${workflowTemplate.name}": ${startDay.toISOString()}`);
                
                // Sinh iterationIndex và lưu vào repetitionTimes
                await setupRepetitionTimes(customerId, workflowTemplate, config, startDay);
            } else {
                console.log(`[autoSetupRepetitionWorkflow] Bỏ qua workflow "${workflowTemplate.name}" vì chưa có cấu hình đầy đủ`);
            }
        }
        
        console.log(`[autoSetupRepetitionWorkflow] ✅ Hoàn thành thiết lập workflow con cho step ${pipelineStep}`);
    } catch (error) {
        console.error(`[autoSetupRepetitionWorkflow] ❌ Lỗi:`, error);
    }
}

/**
 * Thiết lập repetitionTimes cho workflow con
 * @param {string} customerId - ID của customer
 * @param {Object} workflowTemplate - Workflow template
 * @param {Object} config - Cấu hình từ customer.workflowTemplates
 * @param {Date} startDay - Thời gian bắt đầu kích hoạt
 */
async function setupRepetitionTimes(customerId, workflowTemplate, config, startDay) {
    try {
        const { repeat, timeRepeate } = config;
        
        if (!repeat || !timeRepeate) {
            console.warn(`[setupRepetitionTimes] Thiếu repeat hoặc timeRepeate`);
            return;
        }
        
        // Parse timeRepeate để lấy interval và unit
        const parts = timeRepeate.trim().split(' ');
        if (parts.length < 2) {
            console.warn(`[setupRepetitionTimes] timeRepeate không hợp lệ: ${timeRepeate}`);
            return;
        }
        
        const interval = parseInt(parts[0], 10) || 0;
        const unit = parts[1].toLowerCase();
        
        // Map unit sang milliseconds và normalize unit name
        const unitToMs = {
            'seconds': 1000, 'second': 1000, 'giây': 1000,
            'minutes': 60 * 1000, 'minute': 60 * 1000, 'phút': 60 * 1000,
            'hours': 60 * 60 * 1000, 'hour': 60 * 60 * 1000, 'giờ': 60 * 60 * 1000,
            'days': 24 * 60 * 60 * 1000, 'day': 24 * 60 * 60 * 1000, 'ngày': 24 * 60 * 60 * 1000,
        };
        
        const unitNormalizeMap = {
            'second': 'seconds', 'seconds': 'seconds', 'giây': 'seconds',
            'minute': 'minutes', 'minutes': 'minutes', 'phút': 'minutes',
            'hour': 'hours', 'hours': 'hours', 'giờ': 'hours',
            'day': 'days', 'days': 'days', 'ngày': 'days',
        };
        
        const normalizedUnit = unitNormalizeMap[unit] || unit;
        const intervalMs = interval * (unitToMs[unit] || 1000);
        
        if (intervalMs <= 0) {
            console.warn(`[setupRepetitionTimes] Không thể tính interval từ timeRepeate: ${timeRepeate}`);
            return;
        }
        
        // Tính toán iterationIndex
        const startTime = new Date(startDay);
        const iterationIndexArray = [];
        
        let currentExecuteAt = startTime;
        for (let i = 0; i < repeat; i++) {
            iterationIndexArray.push(new Date(currentExecuteAt));
            currentExecuteAt = new Date(currentExecuteAt.getTime() + intervalMs);
        }
        
        console.log(`[setupRepetitionTimes] Đã tính toán ${iterationIndexArray.length} thời gian thực thi`);
        
        // Chuyển sang String để tương thích với schema mới
        const customerIdStr = customerId.toString();
        const workflowTemplateIdStr = workflowTemplate._id.toString();
        
        // Tìm record cũ (nếu có) - sử dụng String
        let existingRepetitionTime = await RepetitionTime.findOne({
            customerId: customerIdStr,
            workflowTemplateId: workflowTemplateIdStr
        });
        
        // Nếu không tìm thấy với String, thử tìm với ObjectId (dữ liệu cũ)
        if (!existingRepetitionTime) {
            try {
                const customerObjectId = typeof customerId === 'string' ? new mongoose.Types.ObjectId(customerId) : customerId;
                const workflowObjectId = typeof workflowTemplate._id === 'string' ? new mongoose.Types.ObjectId(workflowTemplate._id) : workflowTemplate._id;
                existingRepetitionTime = await RepetitionTime.findOne({
                    customerId: customerObjectId,
                    workflowTemplateId: workflowObjectId
                });
            } catch (objIdError) {
                // Bỏ qua lỗi convert ObjectId
            }
        }
        
        if (existingRepetitionTime) {
            // Cập nhật record cũ
            existingRepetitionTime.workflowTemplateId = workflowTemplateIdStr;
            existingRepetitionTime.workflowName = workflowTemplate.name;
            existingRepetitionTime.iterationIndex = iterationIndexArray;
            existingRepetitionTime.indexAction = 0;
            existingRepetitionTime.statusWorkflow = 'pending';
            existingRepetitionTime.units = normalizedUnit;
            existingRepetitionTime.updatedAt = new Date();
            await existingRepetitionTime.save();
            console.log(`[setupRepetitionTimes] ✅ Đã cập nhật repetitionTimes cho workflow "${workflowTemplate.name}"`);
        } else {
            // Tạo record mới
            const repetitionTimeRecord = {
                customerId: customerIdStr,
                workflowTemplateId: workflowTemplateIdStr,
                workflowName: workflowTemplate.name,
                iterationIndex: iterationIndexArray,
                statusWorkflow: 'pending',
                indexAction: 0,
                units: normalizedUnit,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            await RepetitionTime.create(repetitionTimeRecord);
            console.log(`[setupRepetitionTimes] ✅ Đã tạo mới repetitionTimes cho workflow "${workflowTemplate.name}"`);
        }
    } catch (error) {
        console.error(`[setupRepetitionTimes] ❌ Lỗi:`, error);
    }
}

/**
 * Ghi log vào care[] với step tương ứng
 * @param {string} customerId - ID của customer
 * @param {number} step - Số thứ tự step trong pipeline (1-6)
 * @param {string} content - Nội dung log
 */
async function logCareForStep(customerId, step, content) {
    try {
        console.log(`[logCareForStep] Ghi log: customerId=${customerId}, step=${step}, content="${content}"`);
        const result = await Customer.updateOne(
            { _id: customerId },
            {
                $push: {
                    care: {
                        content: content,
                        step: step,
                        createBy: SYSTEM_USER_ID,
                        createAt: new Date()
                    }
                }
            }
        );
        console.log(`[logCareForStep] Kết quả update: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
        triggerRevalidation();
    } catch (error) {
        console.error(`[logCareForStep] Lỗi khi ghi care log:`, error);
    }
}

/**
 * Trigger sub-workflow khi pipeline step hoàn thành (dựa trên care log)
 * @param {string} customerId - ID của customer
 * @param {number} pipelineStep - Số thứ tự step trong pipeline (1-6)
 */
async function triggerSubWorkflowForPipelineStep(customerId, pipelineStep) {
    try {
        console.log(`[triggerSubWorkflowForPipelineStep] Kiểm tra sub-workflow cho step ${pipelineStep} của customer ${customerId}`);
        
        // Tìm sub-workflow có workflow_position tương ứng
        const subWorkflows = await findSubWorkflowsForStep(pipelineStep);
        
        if (subWorkflows.length === 0) {
            console.log(`[triggerSubWorkflowForPipelineStep] Không tìm thấy sub-workflow cho step ${pipelineStep}`);
            return;
        }
        
        const customer = await Customer.findById(customerId).lean();
        if (!customer) {
            console.error(`[triggerSubWorkflowForPipelineStep] Không tìm thấy customer ${customerId}`);
            return;
        }
        
        // Với mỗi sub-workflow, schedule các steps
        const agenda = await initAgenda();
        const now = Date.now();
        
        for (const subWorkflowTemplate of subWorkflows) {
            // Kiểm tra xem đã có CustomerWorkflow cho sub-workflow này chưa
            const existingCw = await CustomerWorkflow.findOne({
                customerId,
                templateId: subWorkflowTemplate._id
            });
            
            if (existingCw) {
                console.log(`[triggerSubWorkflowForPipelineStep] Sub-workflow ${subWorkflowTemplate.name} đã được attach. Bỏ qua.`);
                continue;
            }
            
            // Ghi log bắt đầu sub-workflow
            console.log(`[triggerSubWorkflowForPipelineStep] Ghi log bắt đầu sub-workflow: "${subWorkflowTemplate.name}" cho step ${pipelineStep}`);
            await logCareForStep(
                customerId,
                pipelineStep,
                `🔄 [Workflow con] Bắt đầu chạy: "${subWorkflowTemplate.name}"`
            );
            
            // Tạo CustomerWorkflow cho sub-workflow
            // Lưu ý: step.delay đã là milliseconds trong database
            let subWorkflowCurrentTime = now;
            const subSteps = subWorkflowTemplate.steps.map((step, index) => {
                const scheduledTime = new Date(subWorkflowCurrentTime + step.delay);
                subWorkflowCurrentTime = scheduledTime.getTime(); // Cập nhật cho step tiếp theo
                return {
                    action: step.action,
                    scheduledTime: scheduledTime,
                    status: 'pending',
                    params: step.params,
                    retryCount: 0,
                    isSubWorkflow: true,
                    parentStepId: null, // Pipeline step không có parentStepId cụ thể
                    subWorkflowId: subWorkflowTemplate._id,
                };
            });
            
            const subCustomerWorkflow = new CustomerWorkflow({
                customerId,
                templateId: subWorkflowTemplate._id,
                startTime: new Date(),
                steps: subSteps,
                nextStepTime: subSteps.length > 0 ? subSteps[0].scheduledTime : null,
                status: 'active',
            });
            await subCustomerWorkflow.save();
            
            // Schedule các job cho sub-steps
            for (const subStep of subSteps) {
                const jobData = {
                    customerId: customerId.toString(),
                    cwId: subCustomerWorkflow._id.toString(),
                    params: subStep.params,
                    parentStepId: null,
                    parentCwId: null,
                    pipelineStep: pipelineStep, // Thêm pipelineStep để ghi log đúng step
                    subWorkflowName: subWorkflowTemplate.name, // Thêm tên sub-workflow
                };
                console.log(`[triggerSubWorkflowForPipelineStep] Schedule job: action=${subStep.action}, pipelineStep=${pipelineStep}, subWorkflowName="${subWorkflowTemplate.name}"`);
                await agenda.schedule(subStep.scheduledTime, subStep.action, jobData);
            }
            
            // Link vào customer - lưu workflowTemplates dạng object: {idWorkflowAc: {success: null, repeat: null, timeRepeate: null, startDay: null}}
            const subWorkflowIdStr = subWorkflowTemplate._id.toString();
            const customer = await Customer.findById(customerId);
            if (customer) {
                // Kiểm tra và khởi tạo workflowTemplates nếu cần
                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                    customer.workflowTemplates = {};
                }
                // Vì đây là sub-workflow (isSubWorkflow = true), thêm các thuộc tính đặc biệt
                customer.workflowTemplates[subWorkflowIdStr] = { 
                    success: null,
                    repeat: null,
                    timeRepeate: null,
                    startDay: null,
                    switchButton: true
                };
                customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                await customer.save();
            }
            
            console.log(`[triggerSubWorkflowForPipelineStep] Đã trigger sub-workflow "${subWorkflowTemplate.name}" cho step ${pipelineStep}`);
        }
    } catch (error) {
        console.error(`[triggerSubWorkflowForPipelineStep] Lỗi khi trigger sub-workflow:`, error);
    }
}

/**
 * Chèn sub-workflow steps vào workflow chính sau step cha
 * @param {Object} customerWorkflow - CustomerWorkflow instance
 * @param {Object} parentStep - Step cha đã hoàn thành
 * @param {Object} subWorkflowTemplate - Template của sub-workflow
 */
async function insertSubWorkflowSteps(customerWorkflow, parentStep, subWorkflowTemplate) {
    const parentStepIndex = customerWorkflow.steps.findIndex(s => s._id.toString() === parentStep._id.toString());
    if (parentStepIndex === -1) return;
    
    // Tìm step tiếp theo của workflow chính (không phải sub-workflow)
    const nextMainStepIndex = customerWorkflow.steps.findIndex(
        (s, idx) => idx > parentStepIndex && !s.isSubWorkflow && s.status === 'pending'
    );
    
    const now = Date.now();
    let baseTime = now;
    
    // Tính toán thời gian cho sub-steps (chạy tuần tự ngay sau step cha)
    // Lưu ý: step.delay đã là milliseconds trong database
    const subSteps = subWorkflowTemplate.steps.map((step, index) => {
        const scheduledTime = new Date(baseTime + step.delay);
        baseTime = scheduledTime.getTime(); // Cập nhật baseTime cho step tiếp theo
        return {
            action: step.action,
            scheduledTime: scheduledTime,
            status: 'pending',
            params: step.params,
            retryCount: 0,
            isSubWorkflow: true,
            parentStepId: parentStep._id,
            subWorkflowId: subWorkflowTemplate._id,
        };
    });
    
    // Chèn sub-steps vào sau step cha
    customerWorkflow.steps.splice(parentStepIndex + 1, 0, ...subSteps);
    
    // Nếu có step tiếp theo của workflow chính, điều chỉnh scheduledTime để chạy sau sub-workflow
    if (nextMainStepIndex !== -1 && subSteps.length > 0) {
        const lastSubStepTime = subSteps[subSteps.length - 1].scheduledTime.getTime();
        const nextMainStep = customerWorkflow.steps[nextMainStepIndex + subSteps.length];
        if (nextMainStep && nextMainStep.scheduledTime.getTime() <= lastSubStepTime) {
            // Điều chỉnh để step chính chạy sau sub-workflow
            nextMainStep.scheduledTime = new Date(lastSubStepTime + 60000); // +1 phút sau sub-workflow
        }
    }
    
    await customerWorkflow.save();
    
    // Schedule các job cho sub-steps
    const agenda = await initAgenda();
    for (const subStep of subSteps) {
        await agenda.schedule(subStep.scheduledTime, subStep.action, {
            customerId: customerWorkflow.customerId.toString(),
            cwId: customerWorkflow._id.toString(),
            params: subStep.params,
            parentStepId: parentStep._id.toString(),
            parentCwId: customerWorkflow._id.toString(),
        });
    }
    
    // Nếu có step tiếp theo cần điều chỉnh, reschedule
    if (nextMainStepIndex !== -1) {
        const nextMainStep = customerWorkflow.steps[nextMainStepIndex + subSteps.length];
        if (nextMainStep) {
            // Cancel job cũ và schedule lại
            await agenda.cancel({ name: nextMainStep.action, 'data.cwId': customerWorkflow._id.toString() });
            await agenda.schedule(nextMainStep.scheduledTime, nextMainStep.action, {
                customerId: customerWorkflow.customerId.toString(),
                cwId: customerWorkflow._id.toString(),
                params: nextMainStep.params,
            });
        }
    }
    
    console.log(`[insertSubWorkflowSteps] Đã chèn ${subSteps.length} sub-steps vào sau step ${parentStep.action}`);
}

/**
 * Gán một workflow mới cho khách hàng và đặt lịch các job tương ứng.
 * @param {string} customerId - ID của khách hàng.
 * @param {string} templateId - ID của WorkflowTemplate.
 * @param {string} parentStepId - ID của step cha (nếu đây là sub-workflow).
 * @param {string} parentCwId - ID của CustomerWorkflow cha (nếu đây là sub-workflow).
 */
async function attachWorkflow(customerId, templateId, parentStepId = null, parentCwId = null) {
    const existingAssignment = await CustomerWorkflow.findOne({ customerId, templateId });
    if (existingAssignment) {
        console.log(`[attachWorkflow] Bỏ qua vì KH ${customerId} đã có WF ${templateId}.`);
        return;
    }
    const template = await WorkflowTemplate.findById(templateId);
    if (!template) {
        console.error(`[attachWorkflow] Không tìm thấy template ID: ${templateId}`);
        return;
    }
    
    const now = Date.now();
    // Lưu ý: step.delay đã là milliseconds trong database
    let currentTime = now;
    let allSteps = template.steps.map((step, index) => {
        const scheduledTime = new Date(currentTime + step.delay);
        currentTime = scheduledTime.getTime(); // Cập nhật cho step tiếp theo
        return {
            action: step.action,
            scheduledTime: scheduledTime,
            status: 'pending',
            params: step.params,
            retryCount: 0,
            isSubWorkflow: false,
            parentStepId: null,
            subWorkflowId: null,
            // Lưu lại ID step gốc trong template để log & cập nhật success
            templateStepId: step._id ? step._id.toString() : null,
        };
    });
    
    // Nếu đây là sub-workflow, đánh dấu các step
    if (parentStepId && parentCwId) {
        allSteps = allSteps.map(step => ({
            ...step,
            isSubWorkflow: true,
            parentStepId: parentStepId,
            subWorkflowId: templateId,
        }));
    }
    
    const customerWorkflow = new CustomerWorkflow({
        customerId,
        templateId,
        startTime: new Date(),
        steps: allSteps,
        nextStepTime: allSteps.length > 0 ? allSteps[0].scheduledTime : null,
        status: 'active',
    });
    await customerWorkflow.save();
    
    const agenda = await initAgenda();
    for (const step of customerWorkflow.steps) {
        // Đảm bảo truyền workflowTemplateId và stepId (templateStepId) cho mọi step
        const templateStepId = step.templateStepId || null;
        const workflowTemplateId = templateId.toString();

        await agenda.schedule(step.scheduledTime, step.action, {
            customerId: customerId.toString(),
            cwId: customerWorkflow._id.toString(),
            params: step.params,
            parentStepId: step.parentStepId?.toString() || null,
            parentCwId: step.isSubWorkflow ? parentCwId.toString() : null,
            workflowTemplateId: workflowTemplateId,
            stepId: templateStepId,
        });
    }
    
    // Lưu workflowTemplates dạng object: {idWorkflowAc: {success: null, ...}}
    const templateIdStr = templateId.toString();
    const customer = await Customer.findById(customerId);
    if (customer) {
        // Kiểm tra và khởi tạo workflowTemplates nếu cần
        if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
            customer.workflowTemplates = {};
        }
        
        // Nếu là sub-workflow, thêm các thuộc tính đặc biệt
        if (template.isSubWorkflow) {
            customer.workflowTemplates[templateIdStr] = { 
                success: null,
                repeat: null,
                timeRepeate: null,
                startDay: null,
                switchButton: true
            };
        } else {
            customer.workflowTemplates[templateIdStr] = { success: null };
        }
        
        customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
        await customer.save();
        console.log(`[attachWorkflow] Đã gán thành công WF ${template.name} cho KH ${customerId}, workflowTemplates:`, JSON.stringify(customer.workflowTemplates));
    } else {
        console.error(`[attachWorkflow] Không tìm thấy customer với ID: ${customerId}`);
    }
}

/**
 * Chạy trực tiếp các action từ workflow template (không tạo CustomerWorkflow)
 * Schedule các steps trực tiếp với Agenda
 * @param {string|ObjectId} customerId - ID của customer
 * @param {string|ObjectId} templateId - ID của workflow template
 * @param {Date} startDay - Thời gian bắt đầu (mặc định là thời gian hiện tại)
 */
async function runChildWorkflow(customerId, templateId, startDay = null) {
    try {
        const template = await WorkflowTemplate.findById(templateId);
        if (!template) {
            console.error(`[runChildWorkflow] Không tìm thấy template ID: ${templateId}`);
            return false;
        }
        
        const agenda = await initAgenda();
        const now = startDay ? startDay.getTime() : Date.now();
        const pipelineStep = template.workflow_position || null;
        const subWorkflowName = template.name;
        
        console.log(`[runChildWorkflow] Bắt đầu chạy workflow "${subWorkflowName}" cho KH ${customerId}`);
        
        // Đảm bảo workflowTemplates đã được khởi tạo trước khi schedule các step
        const customer = await Customer.findById(customerId);
        if (customer) {
            const workflowIdStr = templateId.toString();
            
            // Kiểm tra và khởi tạo workflowTemplates nếu cần
            if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                customer.workflowTemplates = {};
            }
            
            // Đảm bảo có config cho workflow con này
            if (!customer.workflowTemplates[workflowIdStr]) {
                const stepworkflow = template.steps ? template.steps.length : 0;
                const id_stepworkflow = {};
                
                // Khởi tạo id_stepworkflow cho tất cả steps
                if (template.steps && Array.isArray(template.steps)) {
                    for (const step of template.steps) {
                        const stepId = step._id ? step._id.toString() : null;
                        if (stepId) {
                            id_stepworkflow[stepId] = { success: false };
                        }
                    }
                }
                
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
                    doneAuto: template.autoWorkflow ? 'pending' : null
                };
                
                customer.markModified('workflowTemplates');
                await customer.save();
                console.log(`[runChildWorkflow] ✅ Đã khởi tạo workflowTemplates cho workflow con "${subWorkflowName}"`);
            } else {
                // 🔥 QUAN TRỌNG: Đảm bảo tất cả steps (kể cả delay) đã được khởi tạo trong id_stepworkflow
                const existingConfig = customer.workflowTemplates[workflowIdStr];
                if (existingConfig && template.steps && Array.isArray(template.steps)) {
                    let needsUpdate = false;
                    for (const step of template.steps) {
                        const stepId = step._id ? step._id.toString() : null;
                        if (stepId && (!existingConfig.id_stepworkflow || !existingConfig.id_stepworkflow[stepId])) {
                            // Step chưa có trong id_stepworkflow, khởi tạo
                            if (!existingConfig.id_stepworkflow) {
                                existingConfig.id_stepworkflow = {};
                            }
                            existingConfig.id_stepworkflow[stepId] = { success: false };
                            needsUpdate = true;
                            console.log(`[runChildWorkflow] ⚠️ Đã thêm step ${stepId} vào id_stepworkflow (có thể là step delay)`);
                        }
                    }
                    
                    if (needsUpdate) {
                        customer.markModified('workflowTemplates');
                        await customer.save();
                        console.log(`[runChildWorkflow] ✅ Đã cập nhật id_stepworkflow với các steps còn thiếu`);
                    }
                }
            }
        }
        
        // 🔥 QUAN TRỌNG: Đảm bảo tất cả steps (kể cả delay) đã được khởi tạo trong id_stepworkflow TRƯỚC KHI schedule
        // Reload customer để lấy config mới nhất (có thể đã được cập nhật ở trên)
        const workflowIdStr = templateId.toString();
        const customerBeforeSchedule = await Customer.findById(customerId);
        if (customerBeforeSchedule && customerBeforeSchedule.workflowTemplates?.[workflowIdStr]) {
            const configBeforeSchedule = customerBeforeSchedule.workflowTemplates[workflowIdStr];
            if (template.steps && Array.isArray(template.steps)) {
                let needsUpdateBeforeSchedule = false;
                for (const step of template.steps) {
                    const stepId = step._id ? step._id.toString() : null;
                    if (stepId && (!configBeforeSchedule.id_stepworkflow || !configBeforeSchedule.id_stepworkflow[stepId])) {
                        // Step chưa có trong id_stepworkflow, khởi tạo TRƯỚC KHI schedule
                        if (!configBeforeSchedule.id_stepworkflow) {
                            configBeforeSchedule.id_stepworkflow = {};
                        }
                        configBeforeSchedule.id_stepworkflow[stepId] = { success: false };
                        needsUpdateBeforeSchedule = true;
                        console.log(`[runChildWorkflow] ⚠️ Đang khởi tạo step ${stepId} trong id_stepworkflow TRƯỚC KHI schedule (có thể là step delay)`);
                    }
                }
                
                if (needsUpdateBeforeSchedule) {
                    customerBeforeSchedule.markModified('workflowTemplates');
                    await customerBeforeSchedule.save();
                    console.log(`[runChildWorkflow] ✅ Đã khởi tạo tất cả steps (kể cả delay) trong id_stepworkflow TRƯỚC KHI schedule`);
                }
            }
        }
        
        // Chạy trực tiếp các steps với Agenda (không tạo CustomerWorkflow)
        // Lưu ý: step.delay đã là milliseconds trong database (từ WorkflowForm đã chuyển đổi)
        let currentTime = now;
        for (const step of template.steps) {
            // Delay được lưu bằng milliseconds, không cần nhân thêm
            const scheduledTime = new Date(currentTime + step.delay);
            const stepId = step._id ? step._id.toString() : null;
            const jobData = {
                customerId: customerId.toString(),
                params: step.params || {},
                pipelineStep: pipelineStep,
                subWorkflowName: subWorkflowName,
                stepId: stepId, // ID của step để cập nhật id_stepworkflow
                workflowTemplateId: templateId.toString() // ID của workflow template
            };
            
            if (step.delay === 0) {
                // Chạy ngay nếu delay = 0
                await agenda.now(step.action, jobData);
                console.log(`[runChildWorkflow] ✅ Đã chạy ngay step "${step.action}" (stepId=${stepId}) cho KH ${customerId}`);
            } else {
                // Schedule cho tương lai (delay đã là milliseconds)
                const scheduledJob = await agenda.schedule(scheduledTime, step.action, jobData);
                const isDelayStep = stepId === '6928f5f890519d95f67c7a6c';
                console.log(`[runChildWorkflow] ✅ Đã schedule step "${step.action}" (stepId=${stepId}) cho ${scheduledTime.toISOString()} (delay=${step.delay}ms)`, {
                    jobId: scheduledJob?.attrs?._id?.toString() || 'N/A',
                    jobName: scheduledJob?.attrs?.name || 'N/A',
                    scheduledTime: scheduledTime.toISOString(),
                    now: new Date().toISOString(),
                    delayMs: step.delay,
                    isDelayStep: isDelayStep,
                    jobData: jobData
                });
                if (isDelayStep) {
                    console.log(`[runChildWorkflow] 🔥🔥🔥 STEP DELAY SCHEDULED: stepId=6928f5f890519d95f67c7a6c, jobId=${scheduledJob?.attrs?._id?.toString()}, scheduledTime=${scheduledTime.toISOString()}, now=${new Date().toISOString()} 🔥🔥🔥`);
                }
            }
            
            // Cập nhật currentTime cho step tiếp theo (chạy tuần tự)
            currentTime = scheduledTime.getTime();
        }
        
        console.log(`[runChildWorkflow] ✅ Đã chạy workflow con "${subWorkflowName}" cho KH ${customerId} (${template.steps.length} step(s))`);
        return true;
    } catch (error) {
        console.error(`[runChildWorkflow] ❌ Lỗi khi chạy workflow con:`, error);
        return false;
    }
}

/**
 * Kiểm tra và cập nhật statusWorkflow trong RepetitionTime dựa trên success của workflow con
 * Chỉ cập nhật khi đã chạy hết iterationIndex
 * Nếu success = true → statusWorkflow = "done"
 * Nếu success = false → statusWorkflow = "failed"
 */
async function checkAndUpdateRepetitionTimeStatus(customerId, workflowTemplateId) {
    try {
        // Chuẩn hóa ID về String
        const customerIdStr = customerId.toString();
        const workflowTemplateIdStr = workflowTemplateId.toString();
        
        // Tìm RepetitionTime record
        const repetitionTime = await RepetitionTime.findOne({
            customerId: customerIdStr,
            workflowTemplateId: workflowTemplateIdStr
        }).lean();
        
        if (!repetitionTime) {
            console.log(`[checkAndUpdateRepetitionTimeStatus] ⚠️ Không tìm thấy RepetitionTime record: customerId=${customerIdStr}, workflowTemplateId=${workflowTemplateIdStr}`);
            return;
        }
        
        // Lấy success từ customers.workflowTemplates
        const customer = await Customer.findById(customerId);
        if (!customer) {
            console.log(`[checkAndUpdateRepetitionTimeStatus] ⚠️ Không tìm thấy Customer: customerId=${customerIdStr}`);
            return;
        }
        
        const workflowIdStr = workflowTemplateIdStr;
        const workflowConfig = customer.workflowTemplates?.[workflowIdStr];
        const workflowSuccess = workflowConfig?.success;
        
        console.log(`[checkAndUpdateRepetitionTimeStatus] 🔍 DEBUG:`, {
            repetitionTimeId: repetitionTime._id,
            currentStatus: repetitionTime.statusWorkflow,
            workflowSuccess: workflowSuccess,
            iterationIndexLength: repetitionTime.iterationIndex?.length || 0,
            indexAction: repetitionTime.indexAction,
            hasIterationIndex: Array.isArray(repetitionTime.iterationIndex) && repetitionTime.iterationIndex.length > 0
        });
        
        // Xác định xem có cần kiểm tra iterationIndex không
        const hasIterationIndex = Array.isArray(repetitionTime.iterationIndex) && repetitionTime.iterationIndex.length > 0;
        
        // Nếu có iterationIndex (workflow hẹn giờ tương lai), kiểm tra đã chạy hết chưa
        if (hasIterationIndex) {
            const allIterationsCompleted = repetitionTime.indexAction >= repetitionTime.iterationIndex.length;
            if (!allIterationsCompleted) {
                console.log(`[checkAndUpdateRepetitionTimeStatus] ⏳ Chưa chạy hết iterationIndex: indexAction=${repetitionTime.indexAction}/${repetitionTime.iterationIndex.length}`);
                return; // Chưa chạy hết, không cập nhật
            }
        }
        // Nếu không có iterationIndex (workflow auto), không cần kiểm tra, chỉ cần kiểm tra workflowSuccess
        
        // 🔥 QUAN TRỌNG: Kiểm tra workflowSuccess và cập nhật statusWorkflow tương ứng
        // Nếu workflowSuccess = null hoặc undefined, không cập nhật
        if (workflowSuccess === null || workflowSuccess === undefined) {
            console.log(`[checkAndUpdateRepetitionTimeStatus] ⏳ workflowSuccess = ${workflowSuccess} (null/undefined), giữ nguyên statusWorkflow = "${repetitionTime.statusWorkflow}"`);
            return;
        }
        
        // Xác định newStatus dựa trên workflowSuccess
        let newStatus = null;
        if (workflowSuccess === true) {
            // Tất cả steps thành công → done (kể cả khi status hiện tại là 'failed')
            newStatus = 'done';
            
            // Nếu là workflow auto và đã hoàn thành, đánh dấu doneAuto = "done"
            if (workflowConfig && workflowConfig.doneAuto === 'pending') {
                workflowConfig.doneAuto = 'done';
                customer.markModified('workflowTemplates');
                await customer.save();
                console.log(`[checkAndUpdateRepetitionTimeStatus] ✅ Workflow auto đã hoàn thành → doneAuto = "done"`);
            }
        } else if (workflowSuccess === false) {
            // Có ít nhất 1 step thất bại → failed
            newStatus = 'failed';
        }
        
        // Chỉ cập nhật nếu newStatus đã được xác định và khác với status hiện tại
        if (newStatus && newStatus !== repetitionTime.statusWorkflow) {
            const updateResult = await RepetitionTime.updateOne(
                { _id: repetitionTime._id },
                {
                    $set: {
                        statusWorkflow: newStatus,
                        updatedAt: new Date()
                    }
                }
            );
            
            if (updateResult.modifiedCount > 0) {
                console.log(`[checkAndUpdateRepetitionTimeStatus] ✅ Đã cập nhật statusWorkflow từ "${repetitionTime.statusWorkflow}" → "${newStatus}" cho RepetitionTime ${repetitionTime._id} (workflowSuccess=${workflowSuccess}, hasIterationIndex=${hasIterationIndex}, modifiedCount=${updateResult.modifiedCount})`);
            } else {
                console.log(`[checkAndUpdateRepetitionTimeStatus] ⚠️ Không cập nhật được: matchedCount=${updateResult.matchedCount}, modifiedCount=${updateResult.modifiedCount}`);
            }
        } else if (newStatus) {
            console.log(`[checkAndUpdateRepetitionTimeStatus] ℹ️ Status không thay đổi: ${repetitionTime.statusWorkflow} = ${newStatus} (workflowSuccess=${workflowSuccess})`);
        }
    } catch (error) {
        console.error(`[checkAndUpdateRepetitionTimeStatus] ❌ Lỗi:`, error);
    }
}

/**
 * Xác định pipeline step từ action hoặc customer pipelineStatus
 * @param {string} action - Tên action
 * @param {string} customerId - ID của customer
 * @returns {Promise<number|null>} Số thứ tự step (1-6) hoặc null
 */
async function getPipelineStepFromAction(action, customerId) {
    // Mapping action sang pipeline step
    const actionToStepMap = {
        'findUid': 1,
        'message': 2,
        'allocation': 3,
        'bell': 3,
    };
    
    if (actionToStepMap[action]) {
        return actionToStepMap[action];
    }
    
    // Nếu không có trong map, thử lấy từ customer pipelineStatus
    const customer = await Customer.findById(customerId).select('pipelineStatus').lean();
    if (customer && customer.pipelineStatus && customer.pipelineStatus[0]) {
        const status = customer.pipelineStatus[0];
        // Parse status để tìm step (ví dụ: 'telesale_TuVan3' -> step 3)
        if (status.includes('_1') || status.includes('unconfirmed_1')) return 1;
        if (status.includes('_2') || status.includes('msg_')) return 2;
        if (status.includes('_3') || status.includes('telesale') || status.includes('CareService')) return 3;
        if (status.includes('_4')) return 4;
        if (status.includes('_5')) return 5;
        if (status.includes('_6')) return 6;
    }
    
    return null;
}

/**
 * Cập nhật trạng thái một bước trong workflow và kích hoạt workflow tiếp theo nếu cần.
 * @param {string} cwId - ID của CustomerWorkflow.
 * @param {string} action - Tên hành động (job) vừa hoàn thành.
 * @param {'completed'|'failed'} status - Trạng thái mới của bước.
 * @param {string} customerId - ID của khách hàng để nối chuỗi workflow.
 * @param {string} parentStepId - ID của step cha (nếu đây là sub-workflow step).
 * @param {string} parentCwId - ID của CustomerWorkflow cha (nếu đây là sub-workflow step).
 */
async function updateStepStatus(cwId, action, status, customerId, parentStepId = null, parentCwId = null) {
    const cw = await CustomerWorkflow.findById(cwId);
    if (!cw) return;
    
    // Tìm step: nếu có parentStepId thì tìm step con, không thì tìm step chính
    let step;
    if (parentStepId) {
        step = cw.steps.find(s => 
            s.action === action && 
            s.status === 'pending' && 
            s.isSubWorkflow && 
            s.parentStepId?.toString() === parentStepId.toString()
        );
    } else {
        step = cw.steps.find(s => s.action === action && s.status === 'pending' && !s.isSubWorkflow);
        if (!step) {
            step = cw.steps.find(s => s.action === action && s.status === 'pending');
        }
    }
    
    if (step) {
        step.status = status;
        
        // Nếu step cha hoàn thành và không phải sub-workflow, kiểm tra sub-workflow
        if (status === 'completed' && !step.isSubWorkflow) {
            // Tìm pipeline step tương ứng
            const pipelineStep = await getPipelineStepFromAction(action, customerId);
            
            if (pipelineStep) {
                // Lấy thời gian hoàn thành hành động cha
                const parentActionCompletedTime = new Date();
                
                // Tự động thiết lập thời gian kích hoạt workflow con lặp lại
                await autoSetupRepetitionWorkflow(customerId, pipelineStep, parentActionCompletedTime);
                
                // Tìm sub-workflow cần chèn (không phải autoWorkflow)
                const subWorkflows = await findSubWorkflowsForStep(pipelineStep);
                const nonAutoWorkflows = subWorkflows.filter(wf => !wf.autoWorkflow);
                
                if (nonAutoWorkflows.length > 0) {
                    // Chèn sub-workflow steps vào sau step cha (chỉ workflow không phải auto)
                    for (const subWorkflowTemplate of nonAutoWorkflows) {
                        await insertSubWorkflowSteps(cw, step, subWorkflowTemplate);
                    }
                }
            }
        }
        
        // Nếu đây là sub-workflow step, kiểm tra sub-workflow đã hoàn thành chưa
        if (step.isSubWorkflow && status === 'completed') {
            const parentStepId = step.parentStepId;
            const subWorkflowId = step.subWorkflowId;
            const subSteps = cw.steps.filter(s => 
                s.isSubWorkflow && 
                s.parentStepId?.toString() === parentStepId?.toString() &&
                s.subWorkflowId?.toString() === subWorkflowId?.toString()
            );
            
            // Nếu tất cả sub-steps đã hoàn thành, cập nhật success cho sub-workflow
            const allSubStepsCompleted = subSteps.every(s => s.status !== 'pending');
            const hasFailedSubStep = subSteps.some(s => s.status === 'failed');
            
            if (allSubStepsCompleted && subWorkflowId) {
                console.log(`[updateStepStatus] Sub-workflow ${subWorkflowId} đã hoàn thành. Chuyển sang step tiếp theo.`);
                // Cập nhật success cho sub-workflow (giữ lại các thuộc tính đặc biệt: repeat, timeRepeate, startDay)
                const subWorkflowIdStr = subWorkflowId.toString();
                const customer = await Customer.findById(customerId);
                if (customer) {
                    // Kiểm tra và khởi tạo workflowTemplates nếu cần
                    if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                        customer.workflowTemplates = {};
                    }
                    if (!customer.workflowTemplates[subWorkflowIdStr]) {
                        // Nếu chưa có, khởi tạo với các thuộc tính đặc biệt cho sub-workflow
                        customer.workflowTemplates[subWorkflowIdStr] = {
                            success: null,
                            repeat: null,
                            timeRepeate: null,
                            startDay: null,
                            switchButton: true
                        };
                    }
                    // Chỉ cập nhật success, giữ nguyên các thuộc tính khác
                    customer.workflowTemplates[subWorkflowIdStr].success = !hasFailedSubStep;
                    customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                    await customer.save();
                }
            }
        }
        
        // Cập nhật nextStepTime (bỏ qua sub-workflow steps khi tính nextStepTime của workflow chính)
        const nextMainStep = cw.steps.find(s => s.status === 'pending' && !s.isSubWorkflow);
        cw.nextStepTime = nextMainStep?.scheduledTime || null;
        
        // Kiểm tra workflow đã hoàn thành chưa (chỉ tính các step chính)
        const mainSteps = cw.steps.filter(s => !s.isSubWorkflow);
        const allMainStepsCompleted = mainSteps.every(s => s.status !== 'pending');
        const hasFailedStep = mainSteps.some(s => s.status === 'failed');
        
        if (allMainStepsCompleted) {
            cw.status = 'completed';
            // Cập nhật success trong workflowTemplates
            const templateIdStr = cw.templateId.toString();
            const customer = await Customer.findById(customerId);
            if (customer) {
                // Kiểm tra và khởi tạo workflowTemplates nếu cần
                if (!customer.workflowTemplates || typeof customer.workflowTemplates !== 'object' || Array.isArray(customer.workflowTemplates)) {
                    customer.workflowTemplates = {};
                }
                if (!customer.workflowTemplates[templateIdStr]) {
                    customer.workflowTemplates[templateIdStr] = {};
                }
                customer.workflowTemplates[templateIdStr].success = !hasFailedStep;
                customer.markModified('workflowTemplates'); // Quan trọng cho Schema.Types.Mixed
                await customer.save();
            }
        }
        
        await cw.save();

        // Workflow chain logic - lấy workflow ID từ database
        const messageWorkflowId = await getWorkflowIdByName('B2.*Gửi tin nhắn');
        if (cw.status === 'completed' && messageWorkflowId && cw.templateId.toString() === messageWorkflowId) {
            console.log(`[Workflow Chain] WF2 (${messageWorkflowId}) hoàn tất. Kích hoạt WF3.`);
            setImmediate(async () => {
                const allocationWorkflowId = await getWorkflowIdByName('B3.*Phân bổ');
                if (allocationWorkflowId) {
                    await attachWorkflow(customerId, allocationWorkflowId).catch(console.error);
                } else {
                    console.error('[Workflow Chain] Không tìm thấy workflow "B3: Phân bổ Data cho Telesale"');
                }
            });
        }
    }
}

/**
 * Tìm tài khoản Zalo tiếp theo có sẵn để thực hiện hành động, theo cơ chế round-robin.
 * @returns {Promise<{account: object|null, reason: string|null}>} Tài khoản Zalo hoặc lý do không có.
 */
async function findNextAvailableZaloAccount() {
    const ZALO_ROTATION_KEY = "lastUsedZaloIndex";
    const allAccounts = await Zalo.find({}).sort({ _id: 1 }).lean();
    if (allAccounts.length === 0) return { account: null, reason: 'no_accounts' };
    const lastIndexSetting = await Setting.findOne({ key: ZALO_ROTATION_KEY });
    let lastIndex = lastIndexSetting ? Number(lastIndexSetting.value) : -1;
    for (let i = 0; i < allAccounts.length; i++) {
        lastIndex = (lastIndex + 1) % allAccounts.length;
        const selectedAccount = allAccounts[lastIndex];
        if (selectedAccount.rateLimitPerHour > 0 && selectedAccount.rateLimitPerDay > 0) {
            await Setting.updateOne({ key: ZALO_ROTATION_KEY }, { $set: { value: lastIndex } }, { upsert: true });
            return { account: selectedAccount, reason: null };
        }
    }
    return { account: null, reason: allAccounts.some(acc => acc.rateLimitPerDay > 0) ? 'hourly' : 'daily' };
}

/**
 * Xử lý khi một job thất bại, quyết định thử lại (retry) hoặc đánh dấu là 'failed'.
 * @param {import('agenda').Job} job - Đối tượng job từ Agenda.
 * @param {Error} error - Lỗi xảy ra.
 * @param {string} cwId - ID của CustomerWorkflow.
 * @param {string} action - Tên hành động (job) bị lỗi.
 */
async function handleJobFailure(job, error, cwId, action) {
    const cw = await CustomerWorkflow.findById(cwId);
    if (!cw) return;
    const step = cw.steps.find(s => s.action === action && s.status === 'pending');
    if (!step) return;
    step.retryCount = (step.retryCount || 0) + 1;
    let retryDelay = 300000; // 5 phút
    if (error.message === 'hourly') retryDelay = 3600000; // 1 giờ
    else if (error.message === 'daily') retryDelay = 86400000; // 24 giờ
    if (step.retryCount < 10) {
        job.schedule(new Date(Date.now() + retryDelay));
        await job.save();
    } else {
        await updateStepStatus(cwId, action, 'failed');
    }
    await cw.save();
}

/**
 * Chuẩn hóa chuỗi UID Zalo (loại bỏ ký tự không phải số).
 * @param {string} u - Chuỗi UID đầu vào.
 * @returns {string} Chuỗi UID đã được chuẩn hóa.
 */
function normalizeUid(u) {
    return String(u ?? "").trim().replace(/\D/g, "");
}

// =============================================================
// == 4. CÁC HÀM HELPER CHO HÀNH ĐỘNG MỚI
// =============================================================

/**
 * Ghi lại một mục vào lịch sử chăm sóc (customer.care) của khách hàng.
 * @param {string} customerId - ID của khách hàng.
 * @param {string} jobName - Tên của job đang chạy.
 * @param {'success'|'failed'} status - Trạng thái của hành động.
 * @param {string} [errorMessage=''] - Thông báo lỗi nếu có.
 */
async function logCareHistory(customerId, jobName, status, errorMessage = '') {
    const step = actionToStepMap[jobName] || 0;
    const actionName = actionToNameMap[jobName] || jobName;
    let content = `Hành động [${actionName}] đã hoàn thành thành công.`;
    if (status === 'failed') {
        content = `Hành động [${actionName}] thất bại: ${errorMessage}`;
    } else if (errorMessage) {
        content = `Hành động [${actionName}] thành công: ${errorMessage}`;
    }
    try {
        await Customer.updateOne({ _id: customerId }, {
            $push: { care: { content: content, step: step, createBy: SYSTEM_USER_ID, createAt: new Date() } }
        });
    } catch (error) {
        console.error(`[logCareHistory] Lỗi khi ghi care log cho KH ${customerId}:`, error);
    }
}

/**
 * Lấy danh sách các nhóm phụ trách ('telesale', 'care') dựa trên tags của khách hàng.
 * @param {string[]} tags - Mảng các ID ngành học (tags) của khách hàng.
 * @returns {Promise<string[]>} Mảng các nhóm chuyên môn duy nhất.
 */
async function getRequiredGroups(tags) {
    if (!tags || tags.length === 0) return [];
    try {
        const services = await Service.find({ _id: { $in: tags } }).select('type').lean();
        const groups = new Set(services.map(s => s.type));
        return Array.from(groups);
    } catch (error) {
        console.error("Lỗi khi lấy nhóm ngành học từ tags:", error);
        return [];
    }
}

/**
 * Tìm nhân sự tuyển sinh tiếp theo cho một nhóm cụ thể theo cơ chế round-robin.
 * @param {string} group - Nhóm phụ trách ('telesale' hoặc 'care').
 * @param {string} zaloAccountId - ID tài khoản Zalo đã tìm ra khách hàng.
 * @returns {Promise<object|null>} Đối tượng User hoặc null nếu không tìm thấy.
 */
async function findNextEnrollmentForGroup(group, zaloAccountId) {
    const zaloAccount = await Zalo.findById(zaloAccountId).select('roles').lean();
    if (!zaloAccount || zaloAccount.roles.length === 0) {
        console.log(`Zalo ${zaloAccountId} không được gán cho user nào.`);
        return null;
    }
    const candidateStaff = await User.find({
        role: { $in: ['Telesale', 'Care', 'Sale', 'Admin Sale'] },
        group: group
    }).sort({ _id: 1 }).lean();
    if (candidateStaff.length === 0) {
        console.log(`Không có nhân sự nhóm ${group} được Zalo ${zaloAccountId} cho phép.`);
        return null;
    }
    const settingKey = `lastAssignedEnrollmentIndex_${group}`;
    const lastIndexSetting = await Setting.findOne({ key: settingKey });
    const lastIndex = lastIndexSetting ? Number(lastIndexSetting.value) : -1;
    const nextIndex = (lastIndex + 1) % candidateStaff.length;
    const selectedStaff = candidateStaff[nextIndex];
    await Setting.updateOne({ key: settingKey }, { $set: { value: nextIndex.toString() } }, { upsert: true });
    return selectedStaff;
}

/**
 * Định dạng lịch sử chăm sóc (care array) thành một chuỗi tin nhắn dễ đọc.
 * @param {Array} careArray - Mảng care từ đối tượng customer.
 * @returns {string} Chuỗi tin nhắn đã được định dạng.
 */
function formatCareHistoryForNotification(careArray, idToNameMap = new Map()) {
    if (!careArray || careArray.length === 0) return "Chưa có lịch sử chăm sóc.";

    const manualAddRegex = /Khách hàng được thêm thủ công bởi ([0-9a-f]{24})\./;

    const groupedByStep = careArray.reduce((acc, entry) => {
        const step = entry.step || 0;
        if (!acc[step]) acc[step] = [];
        acc[step].push(entry);
        return acc;
    }, {});

    let message = "";
    Object.keys(groupedByStep).sort((a, b) => a - b).forEach((step, index) => {
        if (index > 0) message += "\n";
        message += `--- Bước ${step} ---\n`;

        groupedByStep[step].forEach(entry => {
            const match = entry.content.match(manualAddRegex);

            // Trường hợp 1: Content khớp với mẫu "thêm thủ công"
            if (match && match[1]) {
                const userId = match[1];
                const creatorName = idToNameMap.get(userId);

                if (creatorName) {
                    // Nếu tìm thấy tên, thay thế ID bằng tên và không thêm "(bởi...)"
                    message += `+ Khách hàng được thêm thủ công bởi ${creatorName}.\n`;
                } else {
                    // Nếu không tìm thấy tên, giữ nguyên content gốc và thêm người tạo log
                    let userName = 'Hệ thống';
                    if (entry.createBy) {
                        userName = (typeof entry.createBy === 'object' && entry.createBy.name) ? entry.createBy.name : `User (${entry.createBy.toString().slice(-6)})`;
                    }
                    message += `+ ${entry.content} (bởi ${userName})\n`;
                }
            }
            // Trường hợp 2: Content thông thường
            else {
                let userName = 'Hệ thống';
                if (entry.createBy) {
                    userName = (typeof entry.createBy === 'object' && entry.createBy.name) ? entry.createBy.name : `User (${entry.createBy.toString().slice(-6)})`;
                }
                message += `+ ${entry.content} (bởi ${userName})\n`;
            }
        });
    });
    return message;
}

// =============================================================
// == Processor mới: appointmentReminder
//    - Lấy Appointment + Customer
//    - Gửi tin nhắn nhắc hẹn qua Zalo
//    - Gửi thông báo bell (sendGP)
//    - Ghi care log bước 5
// =============================================================
async function appointmentReminderProcessor(job) {
    const { appointmentId, customerId } = job.attrs.data || {};
    const jobName = 'appointmentReminder';

    try {
        // 1) Lấy dữ liệu và populate thêm service
        const appointment = await Appointment.findById(appointmentId)
            .populate('customer', 'name phone uid')
            .populate('createdBy', 'name')
        .populate('service', 'name') // Lấy tên ngành học
            .lean();

        if (!appointment || !appointment.customer) {
            throw new Error(`Không tìm thấy dữ liệu đầy đủ cho Appointment ID ${appointmentId}`);
        }

        // 2) Chuẩn hoá dữ liệu hiển thị mới
        const typeLabel = appointment.appointmentType === 'surgery' ? 'Hoàn tất thủ tục nhập học' : 'Tư vấn';
        const timeStr = new Date(appointment.appointmentDate).toLocaleString('vi-VN', { hour12: false });
        // Tên lịch hẹn giờ được ghép từ chương trình và ngành học
        const appointmentTitle = `${appointment.treatmentCourse} (${appointment.service?.name || 'N/A'})`;
        const noteStr = appointment.notes?.trim() ? appointment.notes.trim() : 'Không có';

        // 3) Soạn nội dung nhắc hẹn Zalo (đã cập nhật)
        const reminderMessage =
            `[NHẮC HẸN] ${appointment.customer.name || ''}\n` +
            `- Lịch hẹn: ${appointmentTitle}\n` +
            `- Loại hẹn: ${typeLabel}\n` +
            `- Thời gian: ${timeStr}\n` +
            `- Ghi chú: ${noteStr}`;

        // 4) Gửi tin nhắn Zalo tới KH (logic gửi giữ nguyên)
        let selectedZalo = appointment.customer.uid?.[0]?.zalo ? await Zalo.findById(appointment.customer.uid[0].zalo) : await Zalo.findOne();
        if (!selectedZalo) throw new Error('Không có tài khoản Zalo để gửi tin');

        const response = await actionZalo({
            phone: appointment.customer.phone,
            uidPerson: appointment.customer.uid?.[0]?.uid || '',
            actionType: 'sendMessage',
            message: reminderMessage,
            uid: selectedZalo.uid
        });

        await Logs.create({
            status: {
                status: response?.status || false,
                message: reminderMessage,
                data: {
                    error_code: response?.content?.error_code || null,
                    error_message: response?.content?.error_message || (response?.status ? '' : 'Invalid response from AppScript')
                }
            },
            type: 'sendMessage', // <-- Trường bị thiếu
            createBy: SYSTEM_USER_ID, // <-- Trường bị thiếu
            customer: customerId,
            zalo: selectedZalo._id, // <-- Trường bị thiếu
        });
        if (!response?.status) throw new Error(response?.message || 'Gửi tin nhắn nhắc hẹn qua Zalo thất bại');

        // 5) Gửi bell thông báo hệ thống (đã cập nhật)
        const bellText =
            `🔔 NHẮC HẸN KHÁCH HÀNG\n` +
            `--------------------\n` +
            `👤 Tên: ${appointment.customer.name || ''}\n` +
            `📞 SĐT: ${appointment.customer.phone || ''}\n` +
            `🗓️ Thời gian: ${timeStr}\n` +
            ` K- Ngành học: ${appointmentTitle}\n` +// Thêm dòng ngành học
            `📝 Ghi chú: ${noteStr}\n` +
            `--------------------\n` +
            `Người tạo lịch: ${appointment.createdBy?.name || 'Hệ thống'}`;

        const bellOk = await sendGP(bellText);
        if (!bellOk) {
            await logCareHistory(customerId, jobName, 'success', 'Đã gửi Zalo; bell lỗi.');
        } else {
            await logCareHistory(customerId, jobName, 'success');
        }

    } catch (error) {
        console.error(`[Job ${jobName}] Xảy ra lỗi: "${error.message}"`);
        await logCareHistory(customerId, jobName, 'failed', error.message);
        if (RETRYABLE_ERRORS.includes(error.message) && job) {
            await handleJobFailure(job, error, job?.attrs?.data?.cwId, jobName);
        }
    }
}

// =============================================================
// == Processor mới: preSurgeryReminder
// =============================================================
async function preSurgeryReminderProcessor(job) {
    const { appointmentId, customerId } = job.attrs.data || {};
    const jobName = 'preSurgeryReminder';

    try {
        // 1. Lấy dữ liệu cần thiết, populate đầy đủ service và customer
        const appointment = await Appointment.findById(appointmentId)
            .populate({
                path: 'service',
                select: 'preSurgeryMessages', // Chỉ lấy trường cần thiết từ service
            })
            .populate('customer', 'name phone uid') // Lấy các trường cần thiết từ customer
            .lean();
        if (!appointment || !appointment.customer || !appointment.service) {
            console.log(appointment);
            throw new Error(`Không tìm thấy dữ liệu đầy đủ cho Appointment ID ${appointmentId}`);
        }

        // 2. Tìm đúng tin nhắn dặn dò cho chương trình
        const preSurgeryMsgTemplate = appointment.service.preSurgeryMessages.find(
            msg => msg.appliesToCourse === appointment.treatmentCourse
        );

        if (!preSurgeryMsgTemplate || !preSurgeryMsgTemplate.content) {
            console.log(`[Job ${jobName}] Không tìm thấy tin nhắn dặn dò cho chương trình "${appointment.treatmentCourse}". Bỏ qua.`);
            // Ghi log care để biết job đã chạy nhưng không có tin nhắn để gửi
            await logCareHistory(customerId, jobName, 'success', `Không tìm thấy mẫu tin nhắn dặn dò cho chương trình "${appointment.treatmentCourse}".`);
            return;
        }

        // 3. Xử lý và gửi tin nhắn qua Zalo
        const messageContent = await processMessage(preSurgeryMsgTemplate.content, appointment.customer);

        // SỬA ĐỔI: Sử dụng 'appointment.customer' thay vì 'customer'
        let selectedZalo = appointment.customer.uid?.[0]?.zalo
            ? await Zalo.findById(appointment.customer.uid[0].zalo)
            : await Zalo.findOne();

        if (!selectedZalo) throw new Error('Không có tài khoản Zalo để gửi tin');

        const response = await actionZalo({
            phone: appointment.customer.phone,
            uidPerson: appointment.customer.uid?.[0]?.uid || '',
            actionType: 'sendMessage',
            message: messageContent,
            uid: selectedZalo.uid
        });

        // 4. Ghi log và lịch sử chăm sóc
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
            createBy: SYSTEM_USER_ID,
            customer: customerId,
            zalo: selectedZalo._id,
        });

        if (!response?.status) throw new Error(response?.message || 'Gửi tin nhắn dặn dò qua Zalo thất bại');

        await logCareHistory(customerId, jobName, 'success', `Gửi dặn dò: ${messageContent.substring(0, 100)}...`);

    } catch (error) {
        console.error(`[Job ${jobName}] Xảy ra lỗi: "${error.message}"`);
        await logCareHistory(customerId, jobName, 'failed', error.message);
    }
}

// =============================================================
// == Processor mới: postSurgeryMessage
// =============================================================
async function postSurgeryMessageProcessor(job) {
    const { customerId, appointmentId, messageContent } = job.attrs.data || {};
    const jobName = 'postSurgeryMessage';

    try {
        if (!customerId || !messageContent) {
            throw new Error(`Thiếu customerId hoặc messageContent trong job data.`);
        }

        const customer = await Customer.findById(customerId).lean();
        if (!customer) throw new Error(`Không tìm thấy Customer ID ${customerId}`);

        // Xử lý message (thay thế placeholder)
        const processedMessage = await processMessage(messageContent, customer);

        // Chọn tài khoản Zalo để gửi
        let selectedZalo = customer.uid?.[0]?.zalo ? await Zalo.findById(customer.uid[0].zalo) : await Zalo.findOne();
        if (!selectedZalo) throw new Error('Không có tài khoản Zalo để gửi tin');

        // Gửi tin nhắn
        const response = await actionZalo({
            phone: customer.phone,
            uidPerson: customer.uid?.[0]?.uid || '',
            actionType: 'sendMessage',
            message: processedMessage,
            uid: selectedZalo.uid
        });

        // Ghi log
        await Logs.create({
            status: { status: response?.status || false, message: processedMessage, data: { /* ... */ } },
            type: 'sendMessage',
            createBy: SYSTEM_USER_ID,
            customer: customerId,
            zalo: selectedZalo._id,
        });

        if (!response?.status) throw new Error(response?.message || 'Gửi tin nhắn sau tuyển sinh thất bại');

        // Ghi lịch sử chăm sóc
        await logCareHistory(customerId, jobName, 'success', `Gửi tin nhắn sau PT: ${processedMessage.substring(0, 100)}...`);

    } catch (error) {
        console.error(`[Job ${jobName}] Xảy ra lỗi: "${error.message}"`);
        await logCareHistory(customerId, jobName, 'failed', error.message);
    }
}

// =============================================================
// == 4.5. PROCESSOR CHO AUTO MESSAGE CUSTOMER
// =============================================================
/**
 * Job processor để tự động quét tin nhắn và tạo khách hàng
 */
async function autoMessageCustomerProcessor(job) {
    const startTime = Date.now();
    
    try {
        // Lấy danh sách pages
        const pages = await getPagesFromAPI();
        if (!pages || !Array.isArray(pages) || pages.length === 0) {
            console.warn('[AutoMessageCustomer] ⚠️ Không tìm thấy pages nào');
            return;
        }

        const PANCAKE_API_URL = 'https://pancake.vn/api/v1/conversations';
        let totalCreated = 0;
        let totalProcessed = 0;

        // Xử lý từng page
        for (const page of pages) {
            try {
                // Lấy conversations từ Pancake API cho page này
                // Thử cả unread_first và không có unread_first để lấy tất cả conversations mới nhất
                const pancakeApiUrl = new URL(PANCAKE_API_URL);
                const params = new URLSearchParams({
                    mode: 'NONE',
                    tags: '"ALL"',
                    except_tags: '[]',
                    access_token: page.accessToken,
                    cursor_mode: 'true',
                    from_platform: 'web',
                    limit: '50', // Lấy 50 conversations mới nhất
                });
                params.append(`pages[${page.id}]`, '0');
                pancakeApiUrl.search = params.toString();

                const response = await fetch(pancakeApiUrl.toString(), { cache: 'no-store' });
                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    console.error(`[AutoMessageCustomer] ❌ Lỗi khi lấy conversations cho page ${page.id}: ${response.status} - ${errorText.substring(0, 200)}`);
                    continue;
                }

                const conversationData = await response.json();
                const conversations = Array.isArray(conversationData?.conversations) 
                    ? conversationData.conversations 
                    : [];

                

                // Xử lý từng conversation có cập nhật gần đây
                for (const conv of conversations) {
                    try {
                        const convUpdatedAt = conv.updated_at ? new Date(conv.updated_at) : null;
                        const now = new Date();
                        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
                        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000); // Mở rộng thời gian lên 30 phút
                        
                        

                        // Xử lý nếu:
                        // 1. Có unread_count > 0 HOẶC
                        // 2. Có updated_at trong 30 phút gần đây
                        const hasUnread = conv.unread_count > 0;
                        const isRecent = convUpdatedAt && convUpdatedAt > thirtyMinutesAgo;
                        
                        if (!hasUnread && !isRecent) {
                            continue;
                        }

                        totalProcessed++;
                        

                        // Xử lý conversation với page info (bao gồm accessToken)
                        const pageInfo = {
                            ...page,
                            accessToken: page.accessToken
                        };

                        const result = await processMessageConversation(conv, pageInfo);
                        if (result.success) {
                            totalCreated++;
                        } else {
                            
                        }
                    } catch (convError) {
                        console.error(`[AutoMessageCustomer] ❌ Lỗi khi xử lý conversation ${conv.id}:`, convError?.message);
                    }
                }
            } catch (pageError) {
                console.error(`[AutoMessageCustomer] ❌ Lỗi khi xử lý page ${page.id}:`, pageError?.message);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
    } catch (error) {
        console.error('[AutoMessageCustomer] ❌ Lỗi nghiêm trọng:', error);
        throw error;
    }
}

/**
 * Processor để xử lý các nhiệm vụ lặp lại workflow con (repetitionTimes)
 * Chạy mỗi 1 giây để kiểm tra và thực thi các workflow con theo lịch
 */
async function processRepetitionTimesProcessor(job) {
    const startTime = Date.now();
    const now = new Date();
    
    try {
        // 1. Query những nhiệm vụ có status pending hoặc running
        // Lưu ý: MongoDB không thể query trực tiếp vào iterationIndex[indexAction] vì indexAction là động
        // Nên ta query tất cả, sau đó filter trong code
        const allTasks = await RepetitionTime.find({
            statusWorkflow: { $in: ['pending', 'running'] }
        }).lean();
        
        if (allTasks.length === 0) {
            // Không log mỗi giây để tránh spam log
            return;
        }
        
        // 2. Filter chỉ lấy những task đến hạn (iterationIndex[indexAction] <= now)
        const tasksToProcess = [];
        
        for (const task of allTasks) {
            const { 
                _id, 
                iterationIndex, 
                indexAction 
            } = task;
            
            // Kiểm tra dữ liệu hợp lệ
            if (!Array.isArray(iterationIndex) || iterationIndex.length === 0) {
                continue;
            }
            
            // Nếu đã chạy hết iterations, bỏ qua (sẽ được cập nhật status sau)
            if (indexAction >= iterationIndex.length) {
                continue;
            }
            
            // Lấy thời gian cần thực thi tại indexAction hiện tại
            const targetTime = new Date(iterationIndex[indexAction]);
            
            if (isNaN(targetTime.getTime())) {
                continue;
            }
            
            // Chỉ thêm vào danh sách xử lý nếu targetTime <= now (đã đến hạn)
            if (targetTime.getTime() <= now.getTime()) {
                tasksToProcess.push(task);
            }
        }
        
        if (tasksToProcess.length === 0) {
            // Không có task nào đến hạn
            return;
        }
        
        console.log(`[processRepetitionTimes] Tìm thấy ${tasksToProcess.length}/${allTasks.length} task(s) đến hạn cần xử lý.`);
        
        // 3. Xử lý từng task đến hạn
        for (const task of tasksToProcess) {
            try {
                const { 
                    _id, 
                    customerId, 
                    workflowTemplateId, 
                    iterationIndex, 
                    indexAction, 
                    units, 
                    statusWorkflow 
                } = task;
                
                // Xác định thời gian cần thực thi
                const targetTime = new Date(iterationIndex[indexAction]);
                
                // Log thông tin
                const diffSeconds = ((now.getTime() - targetTime.getTime()) / 1000).toFixed(1);
                console.log(`[processRepetitionTimes] ✅ Task ${_id}: targetTime=${targetTime.toISOString()}, now=${now.toISOString()}, diff=${diffSeconds}s`);
                
                // 4. Thực thi workflow con
                console.log(`[processRepetitionTimes] Đang chạy workflow con cho task ${_id}`);
                console.log(`[processRepetitionTimes] Customer: ${customerId}, Workflow: ${workflowTemplateId}, Index: ${indexAction}/${iterationIndex.length - 1}`);
                
                let executionSuccess = false;
                try {
                    executionSuccess = await runChildWorkflow(customerId, workflowTemplateId);
                    if (executionSuccess) {
                        console.log(`[processRepetitionTimes] ✅ Đã chạy workflow con thành công cho task ${_id}`);
                    } else {
                        console.error(`[processRepetitionTimes] ❌ Không thể chạy workflow con cho task ${_id}`);
                    }
                } catch (workflowError) {
                    console.error(`[processRepetitionTimes] ❌ Lỗi khi chạy workflow con cho task ${_id}:`, workflowError?.message || workflowError);
                    executionSuccess = false;
                }
                
                // 5. Cập nhật indexAction sau khi chạy workflow con
                const newIndexAction = indexAction + 1;
                const isLastIteration = newIndexAction >= iterationIndex.length;
                
                let newStatus = statusWorkflow;
                
                if (executionSuccess) {
                    // Đã schedule workflow con thành công
                    if (isLastIteration) {
                        // Đã chạy hết iterationIndex, nhưng chưa chắc workflow con đã hoàn thành
                        // Sẽ được kiểm tra bởi checkAndUpdateRepetitionTimeStatus
                        newStatus = 'running'; // Giữ running cho đến khi kiểm tra success
                    } else {
                        newStatus = 'running';
                    }
                } else {
                    // Không thể schedule workflow con
                    if (isLastIteration) {
                        newStatus = 'failed';
                    } else {
                        newStatus = 'pending'; // Giữ nguyên để retry
                    }
                }
                
                // 6. Update repetitionTimes (chỉ cập nhật indexAction, statusWorkflow sẽ được cập nhật sau)
                await RepetitionTime.updateOne(
                    { _id },
                    {
                        $set: {
                            indexAction: newIndexAction,
                            statusWorkflow: newStatus,
                            updatedAt: new Date()
                        }
                    }
                );
                
                console.log(`[processRepetitionTimes] ✅ Đã cập nhật task ${_id}: indexAction=${newIndexAction}, status=${newStatus}`);
                
                // 7. Nếu đã chạy hết iterationIndex, kiểm tra và cập nhật statusWorkflow dựa trên success
                if (isLastIteration && executionSuccess) {
                    // Đợi một chút để các steps có thời gian hoàn thành, sau đó kiểm tra
                    setTimeout(async () => {
                        await checkAndUpdateRepetitionTimeStatus(customerId, workflowTemplateId);
                    }, 2000); // Đợi 2 giây để các steps có thời gian hoàn thành
                }
                
            } catch (taskError) {
                console.error(`[processRepetitionTimes] ❌ Lỗi khi xử lý task ${task._id}:`, taskError?.message || taskError);
                // Tiếp tục xử lý task tiếp theo
            }
        }
        
        // 4. Xử lý các task đã chạy hết iterationIndex (indexAction >= iterationIndex.length)
        // Kiểm tra và cập nhật statusWorkflow dựa trên success của workflow con
        const completedTasks = allTasks.filter(task => {
            if (!Array.isArray(task.iterationIndex) || task.iterationIndex.length === 0) {
                return false;
            }
            return task.indexAction >= task.iterationIndex.length && 
                   task.statusWorkflow !== 'done' && 
                   task.statusWorkflow !== 'failed';
        });
        
        if (completedTasks.length > 0) {
            for (const task of completedTasks) {
                // Kiểm tra và cập nhật statusWorkflow dựa trên success
                await checkAndUpdateRepetitionTimeStatus(task.customerId, task.workflowTemplateId);
            }
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        if (tasksToProcess.length > 0 || completedTasks.length > 0) {
            console.log(`[processRepetitionTimes] Hoàn thành trong ${duration}s. Đã xử lý ${tasksToProcess.length} task(s) đến hạn, ${completedTasks.length} task(s) hoàn thành.`);
        }
        
    } catch (error) {
        console.error('[processRepetitionTimes] ❌ Lỗi nghiêm trọng:', error);
        throw error;
    }
}

// =============================================================
// == 5. HÀM KHỞI TẠO AGENDA
// =============================================================
/**
 * Khởi tạo và cấu hình instance của Agenda (singleton pattern).
 * @returns {Promise<Agenda>} Instance của Agenda đã được khởi động.
 */
const initAgenda = async () => {
    if (agendaInstance) return agendaInstance;

    const mongoConnectionString = process.env.MONGODB_URI;
    agendaInstance = new Agenda({
        db: { address: mongoConnectionString },
        collection: 'agendaJobs', processEvery: '20 seconds',
        maxConcurrency: 50, defaultConcurrency: 10, lockLifetime: 10000,
    });

    // Định nghĩa tất cả các job
    agendaInstance.define('message', { priority: 'high', concurrency: 10 }, genericJobProcessor);
    agendaInstance.define('friendRequest', genericJobProcessor);
    agendaInstance.define('checkFriend', genericJobProcessor);
    agendaInstance.define('tag', genericJobProcessor);
    agendaInstance.define('findUid', genericJobProcessor);
    agendaInstance.define('allocation', { concurrency: 10 }, allocationJobProcessor);
    agendaInstance.define('bell', { concurrency: 10 }, bellJobProcessor);
    agendaInstance.define('appointmentReminder', { priority: 'high', concurrency: 10 }, appointmentReminderProcessor);
    agendaInstance.define('preSurgeryReminder', { priority: 'normal', concurrency: 10 }, preSurgeryReminderProcessor);
    agendaInstance.define('postSurgeryMessage', { priority: 'high', concurrency: 10 }, postSurgeryMessageProcessor);
    agendaInstance.define('autoMessageCustomer', { priority: 'normal', concurrency: 1 }, autoMessageCustomerProcessor);
    agendaInstance.define('processRepetitionTimes', { priority: 'high', concurrency: 1 }, processRepetitionTimesProcessor);
    
    agendaInstance.on('fail', (err, job) => {
        console.error(`[Agenda fail] Job ${job.attrs.name} thất bại: ${err.message}`, {
            jobId: job.attrs._id?.toString(),
            jobData: job.attrs.data,
            stepId: job.attrs.data?.stepId,
            isStepDelay: job.attrs.data?.stepId === '6928f5f890519d95f67c7a6c'
        });
    });
    
    // 🔥 DEBUG: Thêm event listeners để theo dõi step delay
    agendaInstance.on('start', (job) => {
        const stepId = job.attrs.data?.stepId?.toString();
        if (stepId === '6928f5f890519d95f67c7a6c') {
            console.log(`[Agenda event: start] 🔥🔥🔥 STEP DELAY JOB STARTED: stepId=6928f5f890519d95f67c7a6c 🔥🔥🔥`, {
                jobId: job.attrs._id?.toString(),
                jobName: job.attrs.name,
                scheduledAt: job.attrs.nextRunAt?.toISOString() || job.attrs.lastRunAt?.toISOString(),
                now: new Date().toISOString(),
                jobData: job.attrs.data
            });
        }
    });
    
    agendaInstance.on('complete', (job) => {
        const stepId = job.attrs.data?.stepId?.toString();
        if (stepId === '6928f5f890519d95f67c7a6c') {
            console.log(`[Agenda event: complete] 🔥🔥🔥 STEP DELAY JOB COMPLETED: stepId=6928f5f890519d95f67c7a6c 🔥🔥🔥`, {
                jobId: job.attrs._id?.toString(),
                jobName: job.attrs.name,
                lastRunAt: job.attrs.lastRunAt?.toISOString(),
                now: new Date().toISOString()
            });
        }
    });

    await agendaInstance.start();
    console.log('[initAgenda] Agenda đã khởi động thành công.');
    
    // Schedule job tự động quét tin nhắn mỗi 30 giây
    try {
        // Kiểm tra xem job đã được schedule chưa
        const existingJobs = await agendaInstance.jobs({ name: 'autoMessageCustomer', type: 'single' });
        if (existingJobs.length === 0) {
            await agendaInstance.every('30 seconds', 'autoMessageCustomer', {}, { 
                timezone: 'Asia/Ho_Chi_Minh',
                skipImmediate: false // Chạy ngay lần đầu
            });
            console.log('[initAgenda] ✅ Đã schedule job autoMessageCustomer chạy mỗi 30 giây.');
        } else {
            console.log('[initAgenda] ℹ️ Job autoMessageCustomer đã được schedule.');
        }
    } catch (scheduleError) {
        console.error('[initAgenda] ❌ Lỗi khi schedule job autoMessageCustomer:', scheduleError?.message || scheduleError);
    }
    
    // Schedule job tự động xử lý repetitionTimes mỗi 1 giây
    try {
        // Xóa các job cũ nếu có (để tránh duplicate)
        const existingRepetitionJobs = await agendaInstance.jobs({ name: 'processRepetitionTimes' });
        if (existingRepetitionJobs.length > 0) {
            console.log(`[initAgenda] Tìm thấy ${existingRepetitionJobs.length} job processRepetitionTimes cũ, đang xóa...`);
            for (const job of existingRepetitionJobs) {
                await job.remove();
            }
        }
        
        // Schedule job mới
        await agendaInstance.every('1 second', 'processRepetitionTimes', {}, { 
            timezone: 'Asia/Ho_Chi_Minh',
            skipImmediate: false // Chạy ngay lần đầu
        });
        console.log('[initAgenda] ✅ Đã schedule job processRepetitionTimes chạy mỗi 1 giây.');
        
        // Verify job đã được schedule
        const verifyJobs = await agendaInstance.jobs({ name: 'processRepetitionTimes' });
        console.log(`[initAgenda] ✅ Xác minh: Có ${verifyJobs.length} job processRepetitionTimes đang được schedule.`);
    } catch (scheduleError) {
        console.error('[initAgenda] ❌ Lỗi khi schedule job processRepetitionTimes:', scheduleError?.message || scheduleError);
        console.error('[initAgenda] Stack trace:', scheduleError?.stack);
    }
    
    return agendaInstance;
};

export default initAgenda;
export { triggerSubWorkflowForPipelineStep, autoSetupRepetitionWorkflow };