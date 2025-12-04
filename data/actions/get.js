'use server'

import { getAreaOne, getAreaAll } from '@/data/database/area'
import { getUserAll, getUserOne } from '@/data/database/user'
import { getLabelAll } from '../database/label'
import { getFormAll } from '../database/form'
import { getZaloAll, getZaloOne } from '../database/zalo'
import Logs from '@/models/log.model'
import Customer from '@/models/customer.model'
import Zalo from '@/models/zalo.model'
import RepetitionTime from '@/models/repetitionTime.model'
import { WorkflowTemplate } from '@/models/workflows.model'
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

// Map tên action để hiển thị
const actionToNameMap = {
    message: 'Gửi tin nhắn Zalo',
    friendRequest: 'Gửi lời mời kết bạn',
    checkFriend: 'Kiểm tra trạng thái bạn bè',
    tag: 'Gắn thẻ Zalo',
    findUid: 'Tìm UID Zalo',
    allocation: 'Phân bổ cho đội tuyển sinh',
    bell: 'Gửi thông báo hệ thống',
    appointmentReminder: 'Nhắc lịch hẹn',
    preSurgeryReminder: 'Nhắc trước phẫu thuật',
    postSurgeryMessage: 'Tin nhắn sau phẫu thuật',
    autoMessageCustomer: 'Tin nhắn tự động',
    processRepetitionTimes: 'Xử lý workflow lặp lại'
};

// Lấy các hành động tương lai từ agendaJobs và repetitiontimes
export async function future_actions_data(customerId) {
    try {
        await connectDB();

        if (!customerId) {
            return { success: false, error: "customer id không được để trống." };
        }

        if (!mongoose.isValidObjectId(customerId)) {
            return { success: false, error: "customer id không hợp lệ." };
        }

        const customerIdStr = customerId.toString();
        const now = new Date();
        const futureActions = [];

        // 1. Lấy các job từ agendaJobs (collection do Agenda.js quản lý)
        try {
            const agendaJobsCollection = mongoose.connection.db.collection('agendaJobs');
            
            // Query các job có nextRunAt > now và có customerId trong data
            const agendaJobs = await agendaJobsCollection.find({
                nextRunAt: { $gt: now },
                'data.customerId': customerIdStr,
                disabled: { $ne: true } // Chỉ lấy job chưa bị disable
            }).toArray();

            for (const job of agendaJobs) {
                const jobData = job.data || {};
                const actionName = actionToNameMap[job.name] || job.name || 'Hành động';
                
                // Lấy nội dung từ params nếu có
                const messageContent = jobData.params?.message || null;
                
                futureActions.push({
                    _id: job._id.toString(),
                    type: job.name,
                    actionName: actionName,
                    actionType: job.name, // Loại hành động
                    scheduledAt: job.nextRunAt,
                    status: 'scheduled', // Trạng thái: đã lên lịch
                    source: 'agendaJobs',
                    workflowTemplateId: jobData.workflowTemplateId || null,
                    subWorkflowName: jobData.subWorkflowName || null,
                    stepId: jobData.stepId || null,
                    params: jobData.params || {},
                    message: messageContent, // Nội dung tin nhắn nếu có
                    createdAt: job.createdAt || job.nextRunAt
                });
            }
        } catch (agendaError) {
            console.error("Error getting agendaJobs:", agendaError);
            // Không throw, tiếp tục lấy repetitiontimes
        }

        // 2. Lấy các workflow lặp lại từ repetitiontimes
        try {
            const repetitionTimes = await RepetitionTime.find({
                customerId: customerIdStr,
                statusWorkflow: { $in: ['pending', 'running'] }
            }).lean();

            for (const rt of repetitionTimes) {
                const { iterationIndex, indexAction, workflowTemplateId, workflowName } = rt;
                
                // Lấy thông tin chi tiết từ WorkflowTemplate để biết các hành động và nội dung
                let workflowActions = []; // Danh sách các hành động sẽ làm
                
                if (workflowTemplateId) {
                    try {
                        const template = await WorkflowTemplate.findById(workflowTemplateId).lean();
                        if (template && template.steps && Array.isArray(template.steps)) {
                            workflowActions = template.steps.map(step => ({
                                action: step.action,
                                actionName: actionToNameMap[step.action] || step.action || 'Hành động',
                                message: step.params?.message || null,
                                delay: step.delay
                            }));
                        }
                    } catch (templateError) {
                        console.error("Error getting template for repetitiontimes:", templateError);
                    }
                }
                
                if (Array.isArray(iterationIndex) && iterationIndex.length > 0) {
                    // Lấy các thời gian tương lai (từ indexAction trở đi)
                    for (let i = indexAction; i < iterationIndex.length; i++) {
                        const scheduledTime = new Date(iterationIndex[i]);
                        
                        // Chỉ lấy các thời gian trong tương lai
                        if (scheduledTime > now) {
                            futureActions.push({
                                _id: `${rt._id.toString()}_${i}`,
                                type: 'workflow_repetition',
                                actionName: `Workflow: ${workflowName || 'Không tên'}`,
                                scheduledAt: scheduledTime,
                                status: rt.statusWorkflow, // pending hoặc running
                                source: 'repetitiontimes',
                                workflowTemplateId: workflowTemplateId,
                                workflowName: workflowName,
                                iterationIndex: i,
                                units: rt.units,
                                workflowActions: workflowActions, // Danh sách các hành động sẽ làm
                                createdAt: rt.createdAt
                            });
                        }
                    }
                }
            }
        } catch (repetitionError) {
            console.error("Error getting repetitiontimes:", repetitionError);
        }

        // Sắp xếp theo thời gian scheduledAt (tăng dần)
        futureActions.sort((a, b) => {
            const timeA = new Date(a.scheduledAt).getTime();
            const timeB = new Date(b.scheduledAt).getTime();
            return timeA - timeB;
        });

        return {
            success: true,
            data: JSON.parse(JSON.stringify(futureActions))
        };
    } catch (err) {
        console.error("Error getting future actions:", err);
        return { success: false, error: "Lỗi máy chủ khi lấy hành động tương lai." };
    }
}