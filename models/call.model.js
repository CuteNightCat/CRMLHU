import mongoose from 'mongoose';

const { Schema } = mongoose;

const CallStatus = [
    'completed',   // gọi thành công và có kết nối
    'missed',      // bỏ lỡ
    'rejected',    // bị từ chối
    'no_answer',   // không bắt máy
    'busy',        // máy bận
    'failed',      // lỗi kỹ thuật
    'voicemail',   // vào hộp thư thoại
];

const CallSchema = new Schema(
    {
        customer: {
            type: Schema.Types.ObjectId,
            ref: 'customer',
            required: true,
            index: true
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'user',
            required: true,
            index: true
        },
        file: {
            type: String,
            default: ''
        },
        createdAt: {
            type: Date,
            default: () => new Date(),
            index: true
        },
        duration: {
            type: Number,
            min: 0,
            default: 0
        },
        status: {
            type: String,
            enum: CallStatus,
            required: true,
            default: 'ongoing',
            index: true
        },
        note: {
            type: String,
            default: ''
        },
        meta: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    {
        versionKey: false,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Index kết hợp để truy vấn nhanh
CallSchema.index({ customer: 1, user: 1, createdAt: -1 });

const Call = mongoose.models.Call || mongoose.model('Call', CallSchema);
export default Call;