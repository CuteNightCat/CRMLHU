'use server';

import { revalidateTag } from 'next/cache';
import mongoose from 'mongoose';
import connectDB from '@/config/connectDB';
import checkAuthToken from '@/utils/checktoken';
import { uploadFileToDrive } from '@/function/drive/image';

import Call from '@/models/call.model';
import Customer from '@/models/customer.model';

import { getCallsAll, getCallsByCustomer } from './handledata.db';
import { revalidateData } from '@/app/actions/customer.actions';
import { triggerSubWorkflowForPipelineStep } from '@/config/agenda';

/**
 * API lấy dữ liệu (dùng file data đã cache)
 * @param {{ customerId?: string }} params
 */
export async function call_data(params = {}) {
  const { customerId } = params || {};
  if (customerId) {
    return await getCallsByCustomer(customerId);
  }
  return await getCallsAll();
}

/**
 * Revalidate toàn bộ cache calls
 */
export async function reloadCalls() {
  revalidateTag('calls');
}

/**
 * Revalidate cache calls theo customer
 */
export async function reloadCallsByCustomer(customerId) {
  revalidateTag('calls');
  if (customerId) revalidateTag(`calls:${customerId}`);
}

function sipToCallStatus(sipCode, durationSec) {
  // Nếu có thời lượng > 0 thì coi là completed
  if (Number(durationSec) > 0) return 'completed';
  const code = Number(sipCode) || 0;
  if (code === 486) return 'busy';         // Busy Here
  if (code === 603) return 'rejected';     // Decline
  if (code === 480) return 'no_answer';    // Temporarily Unavailable
  if (code === 408) return 'no_answer';    // Request Timeout
  if (code === 487) return 'missed';       // Request Terminated (caller cancel)
  if (code >= 500) return 'failed';
  if (code >= 400) return 'failed';
  return 'failed';
}

/**
 * Chỉ cập nhật pipelineStatus cho step 4 mà không lưu Call record
 * Dùng cho trường hợp: đã có ringing (đổ chuông) nhưng không có recording data
 * 
 * @param {string} customerId - ID khách hàng
 * @param {string} callStatus - Trạng thái cuộc gọi ('missed', 'no_answer', 'rejected', 'busy', etc.)
 * @param {boolean} hasRinging - Đã có ringing event (đổ chuông) chưa
 * @param {number} duration - Thời lượng cuộc gọi (giây)
 * @param {string} crmStatus - CRM status từ popup (nếu có)
 * @returns {Promise<{success: boolean, pipelineStatus4?: string, error?: string}>}
 */
export async function updatePipelineStatusForCall(customerId, callStatus, hasRinging, duration = 0, crmStatus = '') {
  try {
    await connectDB();
    const session = await checkAuthToken();
    if (!session?.id) {
      return { success: false, error: 'Yêu cầu đăng nhập.' };
    }

    if (!customerId) {
      return { success: false, error: 'Thiếu customerId.' };
    }

    // Xác định pipelineStatus cho step 4 dựa trên callStatus và crmStatus
    let pipelineStatus4 = 'consulted_pending_4'; // Mặc định: Đã tư vấn, chờ quyết định
    
    if (crmStatus) {
      // ƯU TIÊN 1: Nếu có crmStatus, map sang pipelineStatus tương ứng
      const crmStatusMap = {
        'callback': 'callback_4',
        'not_interested': 'not_interested_4',
        'no_contact': 'no_contact_4',
        'scheduled': 'scheduled_unconfirmed_4',
        'consulted': 'consulted_pending_4',
      };
      pipelineStatus4 = crmStatusMap[crmStatus.toLowerCase()] || 'consulted_pending_4';
    } else if (callStatus === 'completed' && duration > 0) {
      // ƯU TIÊN 2: Nếu cuộc gọi thành công và có thời lượng, coi như đã tư vấn
      pipelineStatus4 = 'consulted_pending_4';
    } else if (callStatus === 'no_answer' || callStatus === 'missed') {
      // ƯU TIÊN 3: Nếu không trả lời
      // Nếu đã có ringing event (đổ chuông) nhưng cuộc gọi không thành công → cần gọi lại
      if (hasRinging) {
        pipelineStatus4 = 'callback_4'; // Đã đổ chuông nhưng không nghe → cần gọi lại
      } else {
        pipelineStatus4 = 'no_contact_4'; // Không đổ chuông → không liên lạc được
      }
    } else if (callStatus === 'rejected' || callStatus === 'busy') {
      // ƯU TIÊN 4: Nếu từ chối hoặc máy bận
      pipelineStatus4 = 'callback_4';
    }

    // Ghi care log
    const callTimeStr = new Date().toLocaleString('vi-VN');
    const lines = [
      `Cuộc gọi lúc ${callTimeStr}`,
      `• Trạng thái cuộc gọi: ${callStatus}`,
      `• Thời lượng: ${duration}s`,
      `• Đã đổ chuông: ${hasRinging ? 'Có' : 'Không'}`,
    ];
    if (crmStatus) lines.unshift(`KQ sau gọi (Step 4): ${crmStatus}`);
    
    const careNote = {
      content: lines.join(' — '),
      createBy: session.id,
      createAt: new Date(),
      step: 4
    };

    // Cập nhật Customer: CHỈ cập nhật pipelineStatus[0] và pipelineStatus[4]
    // KHÔNG ảnh hưởng đến pipelineStatus[3] (step 3 - phân bổ)
    await Customer.findByIdAndUpdate(customerId, { 
      $push: { care: careNote },
      $set: {
        'pipelineStatus.0': pipelineStatus4,
        'pipelineStatus.4': pipelineStatus4,
        // KHÔNG set pipelineStatus.3 để giữ nguyên trạng thái phân bổ
      }
    });
    console.log(`[updatePipelineStatusForCall] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${pipelineStatus4}, pipelineStatus.4=${pipelineStatus4}`);

    // Kích hoạt workflow con tự động cho Step 4 ngay sau khi cập nhật pipelineStatus
    // 🔥 QUAN TRỌNG: Chỉ trigger workflow auto nếu doneAuto !== 'done' VÀ chưa có RepetitionTime record
    // startDay = thời gian hiện tại (vì không có recording data, dùng thời gian cập nhật)
    const callEndTime = new Date();
    const { autoSetupRepetitionWorkflow } = await import('@/config/agenda');
    const { WorkflowTemplate } = await import('@/models/workflows.model');
    const RepetitionTime = (await import('@/models/repetitionTime.model')).default;
    
    // Lấy customer để kiểm tra doneAuto và workflowTemplates
    const currentCustomer = await Customer.findById(customerId).select('workflowTemplates').lean();
    
    const allSubWorkflows = await WorkflowTemplate.find({
        isSubWorkflow: true,
        workflow_position: 4,
        autoWorkflow: true
    }).lean();
    
    if (allSubWorkflows.length > 0) {
        const autoWorkflow = allSubWorkflows[0];
        const autoWorkflowIdStr = autoWorkflow._id.toString();
        const existingAutoWorkflowConfig = currentCustomer?.workflowTemplates?.[autoWorkflowIdStr];
        const doneAutoValue = existingAutoWorkflowConfig?.doneAuto;
        
        // 🔥 KIỂM TRA 1: doneAuto === 'done' → không trigger
        if (doneAutoValue === 'done') {
            console.log(`[updatePipelineStatusForCall] Workflow auto đã chạy 1 lần (doneAuto="done") → KHÔNG trigger workflow auto`);
        } else {
            // 🔥 KIỂM TRA 2: Đã có RepetitionTime record → không trigger (tránh duplicate)
            const existingRepetitionTime = await RepetitionTime.findOne({
                customerId: customerId.toString(),
                workflowTemplateId: autoWorkflowIdStr
            }).lean();
            
            if (existingRepetitionTime) {
                console.log(`[updatePipelineStatusForCall] ⚠️ Đã có RepetitionTime record (ID: ${existingRepetitionTime._id}) → KHÔNG trigger workflow auto để tránh duplicate`);
            } else {
                // Workflow auto chưa chạy và chưa có RepetitionTime → trigger ngay
                console.log(`[updatePipelineStatusForCall] Workflow auto chưa chạy (doneAuto="${doneAutoValue || 'pending'}") và chưa có RepetitionTime → trigger workflow auto`);
                setImmediate(() => {
                    autoSetupRepetitionWorkflow(customerId, 4, callEndTime).catch(err => {
                        console.error('[updatePipelineStatusForCall] Lỗi khi kích hoạt workflow auto cho step 4:', err);
                    });
                });
            }
        }
    } else {
        console.log(`[updatePipelineStatusForCall] Không có workflow auto cho step 4`);
    }

    return { success: true, pipelineStatus4 };
  } catch (error) {
    console.error('[updatePipelineStatusForCall] Lỗi:', error);
    return { success: false, error: error.message };
  }
}

export async function saveCallAction(prevState, formData) {
  const session = await checkAuthToken();
  if (!session?.id) {
    return { success: false, error: 'Yêu cầu đăng nhập.' };
  }

  const customerId = formData.get('customerId');
  const userId = formData.get('userId');          // 🔴 BẮT BUỘC có
  const crmStatus = formData.get('crmStatus') || ''; // ✅ trạng thái Step 4 từ popup
  // Cho phép UI truyền 'callStatus' (đúng enum) hoặc 'status' cũ:
  let callStatus = formData.get('callStatus') || formData.get('status') || '';
  const duration = Number(formData.get('duration') || 0);           // ✅ SỐ GIÂY
  const startTime = formData.get('startTime') ? new Date(formData.get('startTime')) : new Date();
  const sipStatusCode = Number(formData.get('sipStatusCode') || 0);

  const recordingFile = formData.get('recordingFile');
  const recordingFileName = formData.get('recordingFileName') || '';

  if (!customerId || !userId) {
    return { success: false, error: 'Thiếu customerId hoặc userId.' };
  }
  if (!recordingFile || recordingFile.size === 0) {
    return { success: false, error: 'Thiếu file ghi âm cuộc gọi.' };
  }

  try {
    await connectDB();

    // 1) Upload audio lên Drive - upload ghi âm cuộc gọi lên drive 
    const folderId = '1-hEbowYfqj-rY9gjVDo5vzHusmyA732c';
    const uploadedFile = await uploadFileToDrive(recordingFile, folderId);
    if (!uploadedFile?.id) {
      throw new Error('Tải file ghi âm lên Drive thất bại.');
    }

    // 2) Nội suy callStatus nếu UI chưa gửi đúng enum
    if (!callStatus) {
      callStatus = sipToCallStatus(sipStatusCode, duration);
    }

    // 3) Tạo Call
    const newCall = await Call.create({
      customer: new mongoose.Types.ObjectId(customerId),
      user: new mongoose.Types.ObjectId(userId),
      file: uploadedFile.id,
      createdAt: startTime,
      duration,
      status: callStatus
    });

    // 4) Ghi care Step 4 vào Customer và cập nhật pipelineStatus
    const callTimeStr = startTime.toLocaleString('vi-VN');
    const audioLink = uploadedFile.webViewLink || '';
    const lines = [
      `Cuộc gọi lúc ${callTimeStr}`,
      `• Trạng thái cuộc gọi: ${callStatus}`,
      `• Thời lượng: ${duration}s`,
      `• Ghi âm: ${audioLink || `fileId=${uploadedFile.id}`}`,
    ];
    if (crmStatus) lines.unshift(`KQ sau gọi (Step 4): ${crmStatus}`);
    const careNote = {
      content: lines.join(' — '),
      createBy: session.id,
      createAt: new Date(),
      step: 4
    };

    // Xác định pipelineStatus cho step 4 dựa trên callStatus và crmStatus
    let pipelineStatus4 = 'consulted_pending_4'; // Mặc định: Đã tư vấn, chờ quyết định
    
    if (crmStatus) {
      // Nếu có crmStatus, map sang pipelineStatus tương ứng
      const crmStatusMap = {
        'callback': 'callback_4',
        'not_interested': 'not_interested_4',
        'no_contact': 'no_contact_4',
        'scheduled': 'scheduled_unconfirmed_4',
        'consulted': 'consulted_pending_4',
      };
      pipelineStatus4 = crmStatusMap[crmStatus.toLowerCase()] || 'consulted_pending_4';
    } else if (callStatus === 'completed' && duration > 0) {
      // Nếu cuộc gọi thành công và có thời lượng, coi như đã tư vấn
      pipelineStatus4 = 'consulted_pending_4';
    } else if (callStatus === 'no_answer' || callStatus === 'missed') {
      pipelineStatus4 = 'no_contact_4';
    } else if (callStatus === 'rejected' || callStatus === 'busy') {
      pipelineStatus4 = 'callback_4';
    }

    // Cập nhật Customer: thêm care log và cập nhật pipelineStatus
    await Customer.findByIdAndUpdate(customerId, { 
      $push: { care: careNote },
      $set: {
        'pipelineStatus.0': pipelineStatus4,
        'pipelineStatus.4': pipelineStatus4,
      }
    });
    console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${pipelineStatus4}, pipelineStatus.4=${pipelineStatus4}`);

    // 5) Kích hoạt workflow con tự động cho Step 4 ngay sau khi cập nhật pipelineStatus
    // 🔥 QUAN TRỌNG: Chỉ trigger workflow auto nếu doneAuto !== 'done' VÀ chưa có RepetitionTime record
    // startDay = thời gian kết thúc cuộc gọi (startTime + duration)
    const callEndTime = new Date(startTime.getTime() + duration * 1000);
    const { autoSetupRepetitionWorkflow } = await import('@/config/agenda');
    const { WorkflowTemplate } = await import('@/models/workflows.model');
    const RepetitionTime = (await import('@/models/repetitionTime.model')).default;
    
    // Lấy customer để kiểm tra doneAuto và workflowTemplates
    const currentCustomer = await Customer.findById(customerId).select('workflowTemplates').lean();
    
    const allSubWorkflows = await WorkflowTemplate.find({
        isSubWorkflow: true,
        workflow_position: 4,
        autoWorkflow: true
    }).lean();
    
    if (allSubWorkflows.length > 0) {
        const autoWorkflow = allSubWorkflows[0];
        const autoWorkflowIdStr = autoWorkflow._id.toString();
        const existingAutoWorkflowConfig = currentCustomer?.workflowTemplates?.[autoWorkflowIdStr];
        const doneAutoValue = existingAutoWorkflowConfig?.doneAuto;
        
        // 🔥 KIỂM TRA 1: doneAuto === 'done' → không trigger
        if (doneAutoValue === 'done') {
            console.log(`[saveCallAction] Workflow auto đã chạy 1 lần (doneAuto="done") → KHÔNG trigger workflow auto`);
        } else {
            // 🔥 KIỂM TRA 2: Đã có RepetitionTime record → không trigger (tránh duplicate)
            const existingRepetitionTime = await RepetitionTime.findOne({
                customerId: customerId.toString(),
                workflowTemplateId: autoWorkflowIdStr
            }).lean();
            
            if (existingRepetitionTime) {
                console.log(`[saveCallAction] ⚠️ Đã có RepetitionTime record (ID: ${existingRepetitionTime._id}) → KHÔNG trigger workflow auto để tránh duplicate`);
            } else {
                // Workflow auto chưa chạy và chưa có RepetitionTime → trigger ngay
                console.log(`[saveCallAction] Workflow auto chưa chạy (doneAuto="${doneAutoValue || 'pending'}") và chưa có RepetitionTime → trigger workflow auto`);
                setImmediate(() => {
                    autoSetupRepetitionWorkflow(customerId, 4, callEndTime).catch(err => {
                        console.error('[saveCallAction] Lỗi khi kích hoạt workflow auto cho step 4:', err);
                    });
                });
            }
        }
    } else {
        console.log(`[saveCallAction] Không có workflow auto cho step 4`);
    }

    // 6) Trigger sub-workflow cho step 4 (nếu có) - workflow con không phải auto
    // Chỉ trigger nếu cuộc gọi thành công (completed)
    if (callStatus === 'completed' && duration > 0) {
      setImmediate(() => {
        triggerSubWorkflowForPipelineStep(customerId, 4).catch(err => {
          console.error('[saveCallAction] Lỗi khi trigger sub-workflow:', err);
        });
      });
    }

    // 7) Revalidate
    revalidateTag('calls');
    revalidateTag(`calls:${customerId}`);
    revalidateData()
    return {
      success: true,
      message: 'Lưu cuộc gọi thành công!',
      callId: String(newCall._id),
      driveFileId: uploadedFile.id,
      webViewLink: uploadedFile.webViewLink || null,
      fileName: recordingFileName || null
    };
  } catch (error) {
    console.error('Lỗi khi lưu cuộc gọi:', error);
    return { success: false, error: `Đã xảy ra lỗi phía máy chủ: ${error.message}` };
  }
}