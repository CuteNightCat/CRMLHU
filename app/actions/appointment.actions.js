'use server';

import connectDB from "@/config/connectDB";
import Appointment from "@/models/appointment.model";
import Customer from "@/models/customer.model";
import checkAuthToken from '@/utils/checktoken';
import { reloadAppointments } from '@/data/appointment_db/wraperdata.db';
import { revalidateData } from '@/app/actions/customer.actions';

/**
 * Action để tạo lịch hẹn mới.
 * Đồng thời cập nhật pipelineStatus của khách hàng.
 */

function calculateSendTime(baseTime, sendAfter) {
    const now = new Date(baseTime);
    const { value, unit } = sendAfter;
    switch (unit) {
        case 'hours': now.setHours(now.getHours() + value); break;
        case 'days': now.setDate(now.getDate() + value); break;
        case 'weeks': now.setDate(now.getDate() + (value * 7)); break;
        case 'months': now.setMonth(now.getMonth() + value); break;
        default: break; // Không làm gì nếu unit không hợp lệ
    }
    return now;
}

export async function createAppointmentAction(prevState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) {
        // SỬA ĐỔI: Trả về { success: false, error: '...' }
        return { success: false, error: 'Bạn cần đăng nhập để thực hiện chức năng này.' };
    }

    const customerId = formData.get('customerId');
    const serviceId = formData.get('serviceId');
    const treatmentCourse = formData.get('treatmentCourse');
    const appointmentType = formData.get('appointmentType') || 'interview';
    const appointmentDate = formData.get('appointmentDate');
    const notes = formData.get('notes');

    if (!customerId || !serviceId || !treatmentCourse || !appointmentDate) {
        // SỬA ĐỔI: Trả về { success: false, error: '...' }
        return { success: false, error: 'Vui lòng điền đầy đủ thông tin ngành học, chương trình và ngày hẹn.' };
    }

    const appointmentDateTime = new Date(appointmentDate);
    const now = new Date();
    now.setMinutes(now.getMinutes() - 2);

    if (appointmentDateTime < now) {
        // SỬA ĐỔI: Trả về { success: false, error: '...' }
        return { success: false, error: 'Không thể tạo lịch hẹn trong quá khứ. Vui lòng chọn một thời điểm trong tương lai.' };
    }

    try {
        await connectDB();

        const newAppointment = await Appointment.create({
            customer: customerId,
            service: serviceId,
            treatmentCourse,
            appointmentType,
            appointmentDate: appointmentDateTime,
            notes,
            status: 'pending',
            createdBy: user.id,
        });

        // Lên lịch job nhắc hẹn (Agenda)
        const { default: initAgenda } = await import('@/config/agenda');
        const agenda = await initAgenda();
        const apptTime = appointmentDateTime.getTime();
        const nowForScheduling = new Date();

        // 1. Đặt lịch nhắc hẹn chung (trước 1 ngày)
        const remindAt1Day = new Date(apptTime - 24 * 60 * 60 * 1000);
        // Nếu thời gian nhắc đã qua, lên lịch để gửi ngay. Nếu chưa, lên lịch đúng thời điểm.
        const scheduledTime1Day = remindAt1Day > nowForScheduling
            ? remindAt1Day
            : new Date(nowForScheduling.getTime() + 30 * 1000); // Gửi sau 30 giây

        await agenda.schedule(scheduledTime1Day, 'appointmentReminder', {
            appointmentId: newAppointment._id.toString(),
            customerId: customerId.toString(),
        });
        console.log(`[Agenda] Đã lên lịch nhắc hẹn (1 ngày) cho Appointment: ${newAppointment._id} vào lúc: ${scheduledTime1Day}`);

        // 2. Nếu là lịch hoàn tất nhập học, đặt thêm lịch gửi dặn dò (trước 3 ngày)
        if (appointmentType === 'surgery') {
            const remindAt3Days = new Date(apptTime - 3 * 24 * 60 * 60 * 1000);
            // Tương tự, nếu thời gian dặn dò đã qua, gửi ngay
            const scheduledTime3Days = remindAt3Days > nowForScheduling
                ? remindAt3Days
                : new Date(nowForScheduling.getTime() + 30 * 1000); // Gửi sau 30 giây

            await agenda.schedule(scheduledTime3Days, 'preSurgeryReminder', {
                appointmentId: newAppointment._id.toString(),
                customerId: customerId.toString(),
            });
            console.log(`[Agenda] Đã lên lịch gửi dặn dò (3 ngày) cho Appointment: ${newAppointment._id} vào lúc: ${scheduledTime3Days}`);
        }

        // Cập nhật Customer
        const newPipelineStatus = 'scheduled_unconfirmed_4';
        const careEntry = {
            content: `Đặt lịch hẹn (${appointmentType}): ${treatmentCourse} vào ${appointmentDateTime.toLocaleString('vi-VN')}`,
            createBy: user.id,
            step: 5,
            createAt: new Date()
        };

        await Customer.findByIdAndUpdate(customerId, {
            $push: { care: careEntry },
            $set: {
                'pipelineStatus.0': newPipelineStatus,
                'pipelineStatus.5': newPipelineStatus,
            }
        });
        console.log(`🐳[pipelineStatus] Đặt lịch hẹn Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newPipelineStatus}, pipelineStatus.5=${newPipelineStatus}`);

        // Kích hoạt workflow auto cho Step 5 ngay sau khi tạo appointment thành công
        // startDay = appointment.createdAt (thời gian tạo appointment)
        const { autoSetupRepetitionWorkflow } = await import('@/config/agenda');
        setImmediate(() => {
            autoSetupRepetitionWorkflow(customerId, 5, newAppointment.createdAt).catch(err => {
                console.error('[createAppointmentAction] Lỗi khi kích hoạt workflow auto cho step 5:', err);
            });
        });

        // Revalidate data
        await reloadAppointments();
        await revalidateData();

        // SỬA ĐỔI: Trả về { success: true, message: '...' }
        return { success: true, message: 'Đã tạo lịch hẹn thành công!' };

    } catch (error) {
        console.error('Lỗi khi tạo lịch hẹn:', error);
        // SỬA ĐỔI: Trả về { success: false, error: '...' }
        return { success: false, error: 'Đã xảy ra lỗi phía máy chủ khi tạo lịch hẹn.' };
    }
}

/**
 * Action để cập nhật trạng thái lịch hẹn.
 * Đồng thời cập nhật pipelineStatus của khách hàng tương ứng.
 */
export async function updateAppointmentStatusAction(prevState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { success: false, error: 'Bạn cần đăng nhập để thực hiện chức năng này' };
    }

    const appointmentId = formData.get('appointmentId');
    const newStatus = formData.get('newStatus');

    if (!appointmentId || !newStatus) {
        return { success: false, error: 'Thiếu thông tin cần thiết để cập nhật' };
    }

    try {
        await connectDB();

        // Lấy thông tin lịch hẹn và populate đầy đủ service
        const appointment = await Appointment.findById(appointmentId)
            .populate('service') // Lấy toàn bộ object service
            .lean();

        if (!appointment) {
            return { success: false, error: 'Không tìm thấy lịch hẹn' };
        }

        const customerDocument = await Customer.findById(appointment.customer).select('pipelineStatus').lean();
        if (!customerDocument) {
            return { success: false, error: 'Không tìm thấy khách hàng liên quan' };
        }

        // Cập nhật trạng thái lịch hẹn
        await Appointment.findByIdAndUpdate(appointmentId, { status: newStatus });

        // Mapping trạng thái sang pipelineStatus và care log
        const appointmentTitleForLog = `${appointment.treatmentCourse} (${appointment.service?.name || 'N/A'})`;
        const statusMap = {
            completed: { pipeline: 'serviced_completed_6', care: `Hoàn thành lịch hẹn: ${appointmentTitleForLog}` },
            confirmed: { pipeline: 'confirmed_5', care: `Xác nhận lịch hẹn thành công: ${appointmentTitleForLog}` },
            missed: { pipeline: 'canceled_5', care: `Khách vắng mặt trong lịch hẹn: ${appointmentTitleForLog}` },
            postponed: { pipeline: 'postponed_5', care: `Hoãn lịch hẹn: ${appointmentTitleForLog}` },
            cancelled: { pipeline: 'canceled_5', care: `Đã hủy lịch hẹn: ${appointmentTitleForLog}` },
        };

        const updateInfo = statusMap[newStatus];

        // Logic đặt lịch gửi tin nhắn sau tuyển sinh
        if (newStatus === 'completed' && appointment.appointmentType === 'surgery' && appointment.service) {
            const messagesToSchedule = appointment.service.postSurgeryMessages.filter(
                msg => msg.appliesToCourse === appointment.treatmentCourse
            );

            if (messagesToSchedule.length > 0) {
                const { default: initAgenda } = await import('@/config/agenda');
                const agenda = await initAgenda();
                const completionTime = new Date(); // Lấy thời điểm hoàn thành là "bây giờ"

                for (const message of messagesToSchedule) {
                    const sendAt = calculateSendTime(completionTime, message.sendAfter);
                    await agenda.schedule(sendAt, 'postSurgeryMessage', {
                        customerId: appointment.customer.toString(),
                        appointmentId: appointment._id.toString(),
                        messageContent: message.content,
                    });
                    console.log(`[Agenda] Đã lên lịch gửi tin sau PT cho KH ${appointment.customer} vào lúc: ${sendAt}`);
                }
            }
        }

        if (!updateInfo) {
            await reloadAppointments();
            return { success: true, message: 'Cập nhật thành công nhưng không thay đổi pipeline.' };
        }

        const allAppointments = await Appointment.find({ customer: appointment.customer }).select('status').lean();
        const allowedFinalStatuses = new Set(['completed', 'missed', 'cancelled']);
        const hasCompletedAppointment = allAppointments.some(a => a.status === 'completed');
        const allAppointmentsFinal = allAppointments.length > 0 && allAppointments.every(a => allowedFinalStatuses.has(a.status));
        const shouldMoveToStep6 = allAppointmentsFinal && hasCompletedAppointment;

        const fallbackPipelineMap = {
            completed: 'confirmed_5',
            confirmed: 'confirmed_5',
            missed: 'canceled_5',
            cancelled: 'canceled_5',
            postponed: 'postponed_5'
        };

        const existingPipeline = Array.isArray(customerDocument.pipelineStatus)
            ? customerDocument.pipelineStatus
            : (customerDocument.pipelineStatus ? [customerDocument.pipelineStatus] : []);

        let desiredPipelineCode = updateInfo.pipeline;
        if (shouldMoveToStep6) {
            desiredPipelineCode = 'serviced_completed_6';
        } else if (desiredPipelineCode?.endsWith('_6')) {
            desiredPipelineCode = fallbackPipelineMap[newStatus] || existingPipeline[0] || 'confirmed_5';
        }

        const stageMatch = desiredPipelineCode?.match(/_(\d)$/);
        const desiredPipelineStage = stageMatch ? Number(stageMatch[1]) : null;

        const careEntry = {
            content: updateInfo.care,
            createBy: user.id,
            step: shouldMoveToStep6 ? 6 : (desiredPipelineStage || 5),
            createAt: new Date()
        };

        const pipelineUpdates = {};
        if (desiredPipelineCode) {
            pipelineUpdates['pipelineStatus.0'] = desiredPipelineCode;
            if (desiredPipelineStage) {
                pipelineUpdates[`pipelineStatus.${desiredPipelineStage}`] = desiredPipelineCode;
            }
        }

        const customerUpdate = {
            $push: { care: careEntry },
        };

        if (Object.keys(pipelineUpdates).length > 0) {
            customerUpdate.$set = pipelineUpdates;
        }

        if (!shouldMoveToStep6) {
            customerUpdate.$unset = { 'pipelineStatus.6': '' };
        }

        await Customer.findByIdAndUpdate(appointment.customer, customerUpdate);
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${appointment.customer}:`, JSON.stringify(pipelineUpdates));

        // Revalidate data
        await reloadAppointments();
        await revalidateData();

        return {
            success: true,
            message: 'Đã cập nhật trạng thái lịch hẹn thành công!',
            newStatus,
            movedToStep6: shouldMoveToStep6,
            pipelineStage: shouldMoveToStep6 ? 6 : desiredPipelineStage
        };
    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái lịch hẹn:', error);
        return { success: false, error: 'Đã xảy ra lỗi khi cập nhật trạng thái' };
    }
}

/**
 * Action để hủy lịch hẹn.
 * Đồng thời cập nhật pipelineStatus của khách hàng thành 'canceled_5'.
 */
export async function cancelAppointmentAction(prevState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { status: false, message: 'Bạn cần đăng nhập để thực hiện chức năng này' };
    }

    const appointmentId = formData.get('appointmentId');
    if (!appointmentId) {
        return { status: false, message: 'Thiếu ID lịch hẹn cần hủy' };
    }

    try {
        await connectDB();

        // CẬP NHẬT: Lấy thông tin lịch hẹn và populate service
        const appointment = await Appointment.findById(appointmentId).populate('service', 'name').lean();
        if (!appointment) {
            return { status: false, message: 'Không tìm thấy lịch hẹn' };
        }

        await Appointment.findByIdAndUpdate(appointmentId, { status: 'cancelled' });

        // CẬP NHẬT: Nội dung care log
        const appointmentTitleForLog = `${appointment.treatmentCourse} (${appointment.service.name})`;
        const newPipelineStatus = 'canceled_5';
        const careEntry = {
            content: `Đã hủy lịch hẹn: ${appointmentTitleForLog} (${new Date(appointment.appointmentDate).toLocaleString('vi-VN')})`,
            createBy: user.id,
            step: 5,
            createAt: new Date()
        };

        await Customer.findByIdAndUpdate(appointment.customer, {
            $push: { care: careEntry },
            $set: {
                'pipelineStatus.0': newPipelineStatus,
                'pipelineStatus.5': newPipelineStatus,
            }
        });
        console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${appointment.customer}: pipelineStatus.0=${newPipelineStatus}, pipelineStatus.5=${newPipelineStatus}`);

        await reloadAppointments();
        await revalidateData();

        return { status: true, message: 'Đã hủy lịch hẹn thành công!' };
    } catch (error) {
        console.error('Lỗi khi hủy lịch hẹn:', error);
        return { status: false, message: 'Đã xảy ra lỗi khi hủy lịch hẹn' };
    }
}

/**
 * Lấy lịch hẹn theo ngày (Không thay đổi)
 */
export async function getAppointmentsByDateAction(prevState, formData) {
    const user = await checkAuthToken();
    if (!user || !user.id) {
        return { status: false, message: 'Bạn cần đăng nhập để thực hiện chức năng này' };
    }

    const date = formData.get('date');
    if (!date) {
        return { status: false, message: 'Vui lòng chọn ngày cần xem lịch hẹn' };
    }

    try {
        await connectDB();

        const selectedDate = new Date(date);
        const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));

        const appointments = await Appointment.find({
            appointmentDate: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        }).populate('customer', 'name phone zaloname').lean();

        return { status: true, data: JSON.parse(JSON.stringify(appointments)) };
    } catch (error) {
        console.error('Lỗi khi lấy lịch hẹn theo ngày:', error);
        return { status: false, message: 'Đã xảy ra lỗi khi lấy lịch hẹn' };
    }
}