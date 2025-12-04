// app/models/WorkflowTemplate.js
// This file defines Mongoose schemas and models for WorkflowTemplate and CustomerWorkflow in a Next.js 15 app router project using MongoDB.

import mongoose, { Schema } from 'mongoose';

// Connect to MongoDB if not already connected (in a real setup, this would be handled in a separate db connection file)
if (!mongoose.connection.readyState) {
    mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    }).catch((err) => console.error('MongoDB connection error:', err));
}

/** Schema for WorkflowTemplate to store predefined workflow templates. */
const workflowTemplateSchema = new Schema({
    /** Unique name of the workflow template. */
    name: { type: String, required: true },
    type: { type: String, enum: ['fixed', 'custom'], default: 'custom', required: true }, // Distinguishes between fixed and custom templates
    /** Array of steps in the workflow with actions and delays. */
    steps: [
        {
            /** Action type like 'message' or 'friendRequest'. */
            action: { type: String, enum: ['message', 'friendRequest', 'checkFriend', 'tag', 'findUid'], required: true },
            /** Delay in milliseconds from the start. */
            delay: { type: Number, required: true },
            /** Flexible parameters for the action. */
            params: { type: Object },
        },
    ],
    attachedTo: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', default: null }, // Custom attached to fixed
    excludedSources: { type: [String], default: [] }, // Excluded sources
    /** Vị trí step trong pipeline mà workflow con sẽ chạy sau bước đó (1-6) */
    workflow_position: { type: Number, min: 1, max: 6, default: null },
    /** Nhận biết đây có phải workflow con không */
    isSubWorkflow: { type: Boolean, default: false },
    /** Nhận biết đây có phải workflow con tự động (chạy ngay khi bước cha hoàn thành) */
    autoWorkflow: { type: Boolean, default: false },
});

/** Schema for CustomerWorkflow to manage workflows assigned to customers. */
const customerWorkflowSchema = new Schema({
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true },
    startTime: { type: Date, default: Date.now },
    steps: [
        {
            action: String,
            scheduledTime: Date,
            status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
            params: Object,
            retryCount: { type: Number, default: 0 },
            /** Nhận biết step này có phải sub-workflow không */
            isSubWorkflow: { type: Boolean, default: false },
            /** ID của step cha (nếu là step con) */
            parentStepId: { type: Schema.Types.ObjectId, default: null },
            /** ID của sub-workflow template (nếu là step con) */
            subWorkflowId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', default: null },
        },
    ],
    nextStepTime: Date,
    status: { type: String, enum: ['active', 'paused', 'completed', 'cancelled'], default: 'active' },
});

// Define models, reusing if they already exist to avoid overwrite errors
const WorkflowTemplate = mongoose.models.WorkflowTemplate || mongoose.model('WorkflowTemplate', workflowTemplateSchema);
const CustomerWorkflow = mongoose.models.CustomerWorkflow || mongoose.model('CustomerWorkflow', customerWorkflowSchema);

export { WorkflowTemplate, CustomerWorkflow };