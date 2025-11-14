'use server';
import connectToDatabase from "@/config/connectDB";
import "@/models/users";
import ZaloAccount from "@/models/zalo.model";
import ScheduledJob from "@/models/schedule";
import checkAuthToken from "@/utils/checktoken";
import { user_data } from '@/data/actions/get';
import { revalidateData } from "./customer.actions";
import { reloadRunningSchedules } from "@/data/actions/reload";
import { unstable_cache as nextCache } from 'next/cache';

export async function getRunningSchedulesAction() {
    try {
        const user = await checkAuthToken();
        const getSchedules = nextCache(async (currentUser) => {
            await connectToDatabase();
            const filter = {};
            const roleList = Array.isArray(currentUser.role) ? currentUser.role : [currentUser.role];
            const isEnrollmentStaff = roleList.some(role => ['Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role));
            const isAdminRole = roleList.some(role => ['Admin', 'Manager', 'Admin Sale'].includes(role));
            if (isEnrollmentStaff && !isAdminRole) {
                const permittedAccountIds = (await ZaloAccount.find({ roles: currentUser.id }).select('_id').lean()).map(acc => acc._id);
                if (permittedAccountIds.length === 0) return [];
                filter.zaloAccount = { $in: permittedAccountIds };
            }
            return ScheduledJob.find(filter)
                .populate('zaloAccount', 'name avt')
                .populate('createdBy', 'name')
                .populate({
                    path: 'tasks',
                    populate: {
                        path: 'history',
                        model: 'logmes',
                        select: 'status'
                    }
                })
                .sort({ createdAt: -1, _id: -1 })
                .lean();
        }, ['running-schedules', user.id], { tags: ['running-schedules'] });
        const data = await getSchedules(user);
        return { success: true, data: JSON.parse(JSON.stringify(data)) };
    } catch (err) {
        console.error("Error getting running schedules:", err);
        return { success: false, error: err.message || "Lỗi không xác định từ máy chủ khi lấy danh sách lịch trình." };
    }
}

function schedulePersonsSmart(persons, account, actionsPerHour, actionType, startTime = null) {
    const scheduledTasks = [];
    const baseIntervalMs = 3600000 / actionsPerHour;
    const now = new Date();
    let currentTime = startTime ? new Date(startTime) : new Date(Math.max(now.getTime(), account.rateLimitHourStart?.getTime() || 0));
    let rateLimitHourStart = new Date(account.rateLimitHourStart || now);
    let rateLimitDayStart = new Date(account.rateLimitDayStart || now);
    let actionsUsedThisHour = account.actionsUsedThisHour || 0;
    let actionsUsedThisDay = account.actionsUsedThisDay || 0;
    const getNextDayStart = (date) => {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);
        return nextDay;
    };
    for (const person of persons) {
        if (actionType !== "sendMessage") {
            let safeTimeFound = false;
            while (!safeTimeFound) {
                const currentHourStartRef = new Date(currentTime);
                currentHourStartRef.setMinutes(0, 0, 0);
                if (currentTime.getTime() >= rateLimitHourStart.getTime() + 3600000) {
                    rateLimitHourStart = new Date(currentHourStartRef);
                    actionsUsedThisHour = 0;
                }
                if (currentTime.getTime() >= getNextDayStart(rateLimitDayStart).getTime()) {
                    rateLimitDayStart = new Date(currentTime);
                    rateLimitDayStart.setHours(0, 0, 0, 0);
                    actionsUsedThisDay = 0;
                    actionsUsedThisHour = 0;
                }
                if (actionsUsedThisHour >= account.rateLimitPerHour) {
                    currentTime = new Date(rateLimitHourStart.getTime() + 3600000);
                    continue;
                }
                if (actionsUsedThisDay >= account.rateLimitPerDay) {
                    currentTime = getNextDayStart(rateLimitDayStart);
                    continue;
                }
                safeTimeFound = true;
            }
        }
        const jitterMs = (Math.random() - 0.5) * baseIntervalMs * 0.3;
        const finalScheduledTime = new Date(currentTime.getTime() + jitterMs);
        scheduledTasks.push({
            person: {
                name: person.name || '',
                phone: person.phone || '',
                uid: person.uid || '',
                _id: person._id || '',
                type: person.type || false
            },
            scheduledFor: finalScheduledTime,
            status: false
        });
        actionsUsedThisHour++;
        actionsUsedThisDay++;
        currentTime.setTime(currentTime.getTime() + baseIntervalMs);
    }
    return {
        scheduledTasks,
        estimatedCompletion: new Date(currentTime.getTime()),
        finalCounters: { actionsUsedThisHour, rateLimitHourStart, actionsUsedThisDay, rateLimitDayStart },
    };
}


export async function createScheduleAction(prevState, formData) {
    try {
        const user = await checkAuthToken();
        if (!user || !user.id) throw new Error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.");
        const roleList = Array.isArray(user.role) ? user.role : [user.role];
        if (!roleList.some(role => ['Admin', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
            throw new Error("Bạn không có quyền thực hiện chức năng này.");
        }

        await connectToDatabase();

        const { jobName, actionType, actionsPerHour, messageTemplate, selectedCustomersJSON } = Object.fromEntries(formData);
        const tasksToSchedule = JSON.parse(selectedCustomersJSON);

        if (!tasksToSchedule || tasksToSchedule.length === 0) throw new Error("Không có khách hàng nào được chọn.");

        let dbUser = await user_data({ _id: user.id });
        dbUser = dbUser[0] || {};
        if (!dbUser?.zalo?._id) throw new Error("Chưa chọn tài khoản Zalo hoạt động.");

        const zaloAccountId = dbUser.zalo._id;
        const account = await ZaloAccount.findById(zaloAccountId);
        if (!account) throw new Error("Không tìm thấy tài khoản Zalo.");

        // --- THÊM MỚI: LỌC KHÁCH HÀNG KHÔNG HỢP LỆ ---
        let validTasks = tasksToSchedule;
        let removedCount = 0;

        // Chỉ lọc nếu hành động không phải là 'findUid'
        if (actionType !== 'findUid') {
            const originalCount = validTasks.length;
            validTasks = validTasks.filter(task =>
                task.uid && Array.isArray(task.uid) && task.uid.some(
                    u => u.zalo?.toString() === zaloAccountId.toString() && u.uid
                )
            );
            removedCount = originalCount - validTasks.length;

            if (validTasks.length === 0) {
                return { success: true, message: `Tất cả ${originalCount} người đã bị loại bỏ do không có UID hợp lệ cho tài khoản Zalo này.` };
            }
        }
        // Từ đây, tất cả logic sẽ sử dụng `validTasks` thay vì `tasksToSchedule`

        let finalActionsPerHour = Math.min(Number(actionsPerHour) || 30, 30);

        if (actionType === "findUid") {
            const existingJob = await ScheduledJob.findOne({
                zaloAccount: zaloAccountId,
                actionType: 'findUid',
                $expr: { $lt: [{ $add: ["$statistics.completed", "$statistics.failed"] }, "$statistics.total"] }
            }).sort({ createdAt: -1 });

            if (existingJob) {
                const existingPhones = new Set(existingJob.tasks.map(task => task.person.phone));
                const uniqueTasksToSchedule = validTasks.filter(task => !existingPhones.has(task.phone));
                const duplicateCount = validTasks.length - uniqueTasksToSchedule.length;

                if (uniqueTasksToSchedule.length === 0) {
                    return { success: true, message: `Tất cả ${validTasks.length} người trong danh sách mới đã tồn tại trong lịch chạy. Không có gì để thêm.` };
                }

                const { scheduledTasks, estimatedCompletion, finalCounters } = schedulePersonsSmart(uniqueTasksToSchedule, account, finalActionsPerHour, actionType, existingJob.estimatedCompletionTime);

                await ScheduledJob.updateOne({ _id: existingJob._id }, {
                    $push: { tasks: { $each: scheduledTasks } },
                    $inc: { 'statistics.total': uniqueTasksToSchedule.length },
                    $set: { estimatedCompletionTime: estimatedCompletion }
                });
                await ZaloAccount.updateOne({ _id: zaloAccountId }, { $set: finalCounters });

                let message = `Đã có lịch tìm UID đang chạy. Đã thêm ${uniqueTasksToSchedule.length} người mới vào cuối lịch trình.`;
                if (duplicateCount > 0) message += ` Đã bỏ qua ${duplicateCount} người do bị trùng.`;
                if (removedCount > 0) message += ` Đã loại bỏ ${removedCount} người do thiếu UID.`; // Thông báo thêm
                return { success: true, message: message };
            }
        }

        const { scheduledTasks, estimatedCompletion, finalCounters } = schedulePersonsSmart(validTasks, account, finalActionsPerHour, actionType);
        await ZaloAccount.updateOne({ _id: zaloAccountId }, { $set: finalCounters });

        const newJob = await ScheduledJob.create({
            jobName: jobName || `Lịch trình ngày ${new Date().toLocaleDateString("vi-VN")}`,
            actionType,
            zaloAccount: zaloAccountId,
            tasks: scheduledTasks,
            config: {
                actionsPerHour: finalActionsPerHour,
                // --- SỬA LỖI: Cho phép `addFriend` cũng lưu `messageTemplate` ---
                messageTemplate: ['sendMessage', 'addFriend'].includes(actionType) ? messageTemplate : null
            },
            statistics: {
                total: validTasks.length, // Dùng số lượng task hợp lệ
                completed: 0,
                failed: 0
            },
            createdBy: user.id,
            estimatedCompletionTime: estimatedCompletion,
        });

        await ZaloAccount.findByIdAndUpdate(zaloAccountId, { $push: { action: newJob._id } });

        const duration = estimatedCompletion.getTime() - new Date().getTime();
        const hours = Math.floor(duration / 3600000);
        const minutes = Math.floor((duration % 3600000) / 60000);
        let message = `Đã tạo lịch trình "${newJob.jobName}" cho ${validTasks.length} người. Ước tính hoàn thành trong ${hours} giờ ${minutes} phút.`;
        if (removedCount > 0) {
            message += ` Đã tự động loại bỏ ${removedCount} người do không có UID hợp lệ.`;
        }

        revalidateData();
        reloadRunningSchedules();
        return { success: true, message: message };
    } catch (err) {
        console.error("Error creating schedule:", err);
        return { success: false, error: err.message || "Lỗi không xác định từ máy chủ." };
    }
}

export async function cancelScheduleAction(prevState, formData) {
    try {
        const user = await checkAuthToken();
        if (!user || !user.id) throw new Error("Phiên đăng nhập không hợp lệ.");
        const roleList = Array.isArray(user.role) ? user.role : [user.role];
        if (!roleList.some(role => ['Admin', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
            throw new Error("Bạn không có quyền thực hiện chức năng này.");
        }
        await connectToDatabase();
        const jobId = formData.get('jobId');
        if (!jobId) throw new Error("Thiếu ID của lịch trình.");
        const jobToDelete = await ScheduledJob.findById(jobId);
        if (!jobToDelete) throw new Error("Không tìm thấy lịch trình để hủy.");
        await ScheduledJob.deleteOne({ _id: jobId });
        await ZaloAccount.updateOne(
            { _id: jobToDelete.zaloAccount },
            { $pull: { action: jobId } }
        );
        revalidateData();
        reloadRunningSchedules();
        return { success: true, message: `Đã hủy thành công lịch trình "${jobToDelete.jobName}".` };
    } catch (err) {
        return { success: false, error: err.message || "Lỗi không xác định từ máy chủ." };
    }
}
