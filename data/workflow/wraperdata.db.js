// actions/workflow.actions.js (tách riêng hoặc merge vào wraperdata.db)

'use server';

import { getWorkflowAll, getWorkflowOne } from '@/data/workflow/handledata.db';
import { WorkflowTemplate, CustomerWorkflow } from '@/models/workflows.model';
import connectDB from '@/config/connectDB';
import { revalidateTag } from 'next/cache';
import initAgenda from '@/config/agenda';
import Customer from '@/models/customer.model'; // Giả sử để update zaloPhase

// Hàm sẵn (giả định): findUID, sendMessage, sendFriendRequest, checkFriendStatus, changeZaloName
// import { findUID, sendMessage, sendFriendRequest, checkFriendStatus, changeZaloName } from '@/lib/zaloFunctions';

export async function workflow_data(id, filterType = 'all') {
  if (id) {
    return await getWorkflowOne(id);
  }
  return await getWorkflowAll(filterType);
}

export async function reloadWorkflow() {
  revalidateTag('workflows');
}

export async function createWorkflow(formData) {
  try {
    await connectDB();
    let { name, type, steps, excludedSources } = formData;
    if (type === 'fixed') {
      // Fixed: Steps cố định cho CRM hoặc Zalo
      steps = getFixedSteps(type); // Hàm helper định nghĩa 6/5 steps fixed
    }
    const newTemplate = new WorkflowTemplate({
      name,
      type,
      steps,
      excludedSources: excludedSources || [],
    });
    await newTemplate.save();
    revalidateTag('workflows');
    return { success: true };
  } catch (error) {
    console.error('Lỗi tạo workflow:', error);
    return { success: false, error: 'Không thể tạo workflow.' };
  }
}

export async function updateWorkflow(id, formData) {
  try {
    await connectDB();
    const { name, steps, excludedSources, applyMode } = formData;
    const template = await WorkflowTemplate.findById(id);
    if (!template) throw new Error('Workflow không tồn tại.');
    if (template.type === 'fixed') {
      // Chỉ update params/delay, giữ action
      template.steps = template.steps.map((s, i) => ({ ...s, params: steps[i]?.params || s.params, delay: steps[i]?.delay || s.delay }));
    } else {
      template.steps = steps;
    }
    template.name = name;
    template.excludedSources = excludedSources || [];
    await template.save();
    if (applyMode === 'immediate') {
      const customerWorkflows = await CustomerWorkflow.find({ templateId: id });
      for (const cw of customerWorkflows) {
        cw.steps = template.steps.map(step => ({
          action: step.action,
          scheduledTime: new Date(cw.startTime.getTime() + step.delay),
          status: 'pending',
          params: step.params,
          retryCount: 0,
        }));
        cw.nextStepTime = cw.steps.length > 0 ? new Date(Math.min(...cw.steps.map(s => s.scheduledTime.getTime()))) : null;
        await cw.save();
        await scheduleCustomerWorkflow(cw); // Re-schedule jobs
      }
    }
    revalidateTag('workflows');
    return { success: true };
  } catch (error) {
    console.error('Lỗi cập nhật workflow:', error);
    return { success: false, error: 'Không thể cập nhật workflow.' };
  }
}

export async function assignCustomToFixed(customId, fixedId) {
  try {
    await connectDB();
    const custom = await WorkflowTemplate.findById(customId);
    if (!custom || custom.type !== 'custom') throw new Error('Invalid custom workflow.');
    custom.attachedTo = fixedId;
    await custom.save();
    // Trigger re-schedule cho customers của fixed nếu cần
    revalidateTag('workflows');
    return { success: true };
  } catch (error) {
    console.error('Lỗi gán workflow:', error);
    return { success: false, error: 'Không thể gán.' };
  }
}

export async function unassignCustom(customId) {
  try {
    await connectDB();
    const custom = await WorkflowTemplate.findById(customId);
    if (!custom) throw new Error('Workflow không tồn tại.');
    custom.attachedTo = null;
    await custom.save();
    revalidateTag('workflows');
    return { success: true };
  } catch (error) {
    console.error('Lỗi gỡ gán:', error);
    return { success: false, error: 'Không thể gỡ gán.' };
  }
}

export async function createWorkflowScheduleAction(prevState, formData) {
  try {
    await connectDB();
    const actionType = formData.get('actionType');
    if (actionType !== 'workflow') {
      return { success: false, error: 'Hành động không hợp lệ.' };
    }
    const selectedCustomersJSON = formData.get('selectedCustomersJSON');
    const customersArray = JSON.parse(selectedCustomersJSON);
    const workflowId = formData.get('workflowId');
    const startTimeStr = formData.get('startTime');
    const startTime = new Date(startTimeStr);

    const template = await WorkflowTemplate.findById(workflowId);
    if (!template) {
      return { success: false, error: 'Không tìm thấy workflow.' };
    }

    // Nếu custom và attachedTo, merge steps với fixed
    let mergedSteps = template.steps;
    if (template.type === 'custom' && template.attachedTo) {
      const fixedTemplate = await WorkflowTemplate.findById(template.attachedTo);
      mergedSteps = [...fixedTemplate.steps, ...template.steps]; // Chạy fixed trước, custom sau
    }

    for (const customer of customersArray) {
      const customerId = customer._id;
      const steps = mergedSteps.map(step => ({
        action: step.action,
        scheduledTime: new Date(startTime.getTime() + step.delay),
        status: 'pending',
        params: step.params,
        retryCount: 0,
      }));
      const nextStepTime = steps.length > 0 ? new Date(Math.min(...steps.map(s => s.scheduledTime.getTime()))) : null;

      const newCustomerWorkflow = new CustomerWorkflow({
        customerId,
        templateId: workflowId,
        startTime,
        steps,
        nextStepTime,
        status: 'active',
      });
      await newCustomerWorkflow.save();
      await scheduleCustomerWorkflow(newCustomerWorkflow); // Schedule jobs
      // Update zaloPhase nếu Zalo workflow
      if (template.name.includes('Zalo')) {
        const cust = await Customer.findById(customerId);
        cust.zaloPhase = 'welcome'; // Ví dụ
        await cust.save();
      }
    }

    revalidateTag('workflows');
    return { success: true, message: 'Lên lịch workflow thành công.' };
  } catch (error) {
    console.error('Lỗi lên lịch workflow:', error);
    return { success: false, error: 'Không thể lên lịch workflow.' };
  }
}

// Helper schedule jobs với Agenda
async function scheduleCustomerWorkflow(cw) {
  const agenda = await initAgenda();
  for (const step of cw.steps) {
    if (step.status === 'pending') {
      agenda.schedule(step.scheduledTime, step.action, { customerId: cw.customerId, params: step.params, cwId: cw._id });
    }
  }
}

// Helper fixed steps cho CRM/Zalo
function getFixedSteps(type) {
  if (type === 'fixed' && name.includes('CRM')) {
    return [
      { action: 'message', delay: 0, params: { message: 'Chào mừng' } }, // Bước 1
      { action: 'friendRequest', delay: 60000, params: {} }, // Bước 2 v.v.
      // Định nghĩa 6 steps fixed theo PDF
    ];
  } else if (name.includes('Zalo')) {
    // 5 giai đoạn Zalo
  }
  return [];
}

export async function deleteWorkflow(id) {
  try {
    await connectDB();
    const template = await WorkflowTemplate.findById(id);
    if (!template || template.type !== 'custom') {
      throw new Error('Workflow không tồn tại hoặc không thể xóa.');
    }
    await template.deleteOne();
    revalidateTag('workflows');
    return { success: true };
  } catch (error) {
    console.error('Lỗi xóa workflow:', error);
    return { success: false, error: 'Không thể xóa workflow.' };
  }
}