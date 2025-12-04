// models/repetitionTime.model.js
import { Schema, model, models } from 'mongoose';

/**
 * Schema để lưu thông tin lặp lại workflow con
 * Mỗi record chứa một mảng iterationIndex với tất cả thời gian thực thi
 */
const repetitionTimeSchema = new Schema(
    {
        /** ID của khách hàng (dạng String) */
        customerId: {
            type: String,
            required: true,
            index: true
        },
        /** ID của workflow con (workflowTemplateId) - dạng String */
        workflowTemplateId: {
            type: String,
            required: true,
            index: true
        },
        /** Tên workflow con */
        workflowName: {
            type: String,
            required: true
        },
        /** Mảng các thời gian thực thi cho tương lai (iterationIndex) */
        iterationIndex: {
            type: [Date],
            required: true,
            default: []
        },
        /** Trạng thái thực thi workflow */
        statusWorkflow: {
            type: String,
            enum: ['pending', 'running', 'done', 'failed'],
            default: 'pending',
            index: true
        },
        /** Chỉ số action hiện tại (bắt đầu từ 0) */
        indexAction: {
            type: Number,
            default: 0,
            min: 0
        },
        /** Đơn vị thời gian (units) - ví dụ: "seconds", "minutes", "hours", "days" */
        units: {
            type: String,
            required: true
        },
        /** Thời gian tạo bản ghi */
        createdAt: {
            type: Date,
            default: Date.now
        },
        /** Thời gian cập nhật */
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

// Index để đảm bảo không trùng lặp: customerId + workflowTemplateId (một record duy nhất cho mỗi customer + workflow)
repetitionTimeSchema.index({ customerId: 1, workflowTemplateId: 1 }, { unique: true });

// Đảm bảo updatedAt được cập nhật tự động
repetitionTimeSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Xóa model cũ khỏi cache để force reload schema mới
if (models.RepetitionTime) {
    delete models.RepetitionTime;
}

const RepetitionTime = model('RepetitionTime', repetitionTimeSchema);

export default RepetitionTime;

