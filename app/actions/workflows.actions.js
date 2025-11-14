'use server';
import initAgenda from '@/config/agenda';
import CustomerWorkflow from '@/models/ctWorkflow.model'; // Mongoose models

export async function createWorkflowForCustomer(formData) {
    const customerId = formData.get('customerId');
    const agenda = await initAgenda(); // Init nếu chưa

    // Chạy action mặc định ngay
    await agenda.now('findUIDAndAddCustomer', { customerData: { id: customerId } });

    // Tạo CustomerWorkflowinstance (như trước)
    const template = await WorkflowTemplate.findById(templateId);
    const startTime = Date.now();
    const steps = template.steps.map(step => ({
        ...step,
        scheduledTime: new Date(startTime + step.delay),
    }));

    // Schedule jobs cho từng step
    for (const step of steps) {
        await agenda.schedule(step.scheduledTime, step.action, { customerId, params: step.params });
    }

    // Lưu instance
    const workflow = new CustomerWorkflow({ customerId, steps, nextStepTime: steps[0].scheduledTime });
    await workflow.save();
}