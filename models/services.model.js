// models/services.model.js
import { Schema, model, models } from 'mongoose';

const SERVICE_TYPES = [
    'dai_hoc',
    'lien_thong',
    'dao_tao_tu_xa',
    'duoc_si_chuyen_khoa_i',
    'thac_si',
    'tien_si',
    'tu_xa',
];
const SALE_GROUP_TYPES = ['telesale', 'care'];

function toSlug(input) {
    return String(input)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

/** Ngành học tối giản + các counters */
const serviceSchema = new Schema({
    /** Tên hiển thị */
    name: { type: String, required: true, trim: true },

    /** Slug duy nhất để truy vấn/SEO */
    slug: { type: String, required: true, unique: true, index: true },

    /** Loại ngành học */
    type: { type: String, enum: SERVICE_TYPES, required: true, index: true },

    /** Nhóm phụ trách (tùy chọn) */
    saleGroup: { type: String, enum: [...SALE_GROUP_TYPES, null], default: null },

    /** Nhân sự phụ trách mặc định (ID người dùng) */
    defaultSale: { type: String, default: null },

    /** Mô tả ngắn */
    description: { type: String },

    /** Ảnh nền/cover hiển thị cho ngành học */
    cover: { type: String, default: '' },

    /** Trạng thái (soft delete) */
    isActive: { type: Boolean, default: true, index: true },

    /** Counters: số người quan tâm, số đánh giá, số khách hoàn tất */
    stats: {
        interest: { type: Number, default: 0 }, // số người quan tâm
        reviews: { type: Number, default: 0 }, // số đánh giá
        completed: { type: Number, default: 0 }, // số khách đã chốt hoàn thành
    },

    // =================================================================
    // CÁC TRƯỜNG MỚI ĐƯỢC THÊM VÀO
    // =================================================================

    /**
     * Trường 1: Quy định các chương trình và chi phí tương ứng
     * Mảng các chương trình, mỗi chương trình có tên, mô tả và cấu trúc chi phí linh hoạt.
     */
    treatmentCourses: [{
        name: { type: String, required: true, trim: true },
        description: { type: String },
        costs: {
            basePrice: { type: Number, required: true, default: 0 },
            otherFees: { type: Number, default: 0 },
        }
    }],

    /**
     * Trường 2: Lưu trữ tin nhắn gửi trước tuyển sinh
     * Mảng các tin nhắn, mỗi tin nhắn gắn với một chương trình cụ thể.
     */
    preSurgeryMessages: [{
        /** Tên của chương trình trong mảng treatmentCourses mà tin nhắn này áp dụng */
        appliesToCourse: { type: String, required: true },
        /** Nội dung tin nhắn */
        content: { type: String, required: true }
    }],

    /**
     * Trường 3: Lưu trữ tin nhắn tự động gửi sau tuyển sinh
     * Mảng các tin nhắn được lên lịch gửi sau một khoảng thời gian nhất định.
     */
    postSurgeryMessages: [{
        /** Tên của chương trình trong mảng treatmentCourses mà tin nhắn này áp dụng */
        appliesToCourse: { type: String, required: true },
        /** Thời gian gửi sau khi chương trình hoàn tất */
        sendAfter: {
            value: { type: Number, required: true },
            unit: { type: String, required: true, enum: ['days', 'hours', 'weeks', 'months'] }
        },
        /** Nội dung tin nhắn */
        content: { type: String, required: true }
    }],

}, { timestamps: true });

serviceSchema.pre('validate', function (next) {
    if (!this.slug && this.name) this.slug = toSlug(this.name);
    next();
});

serviceSchema.index({ name: 'text', description: 'text' });

const Service = models.service || model('service', serviceSchema);
export default Service;