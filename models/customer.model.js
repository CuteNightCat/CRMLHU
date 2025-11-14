// models/customers.model.js
import { Schema, model, models } from 'mongoose';

/* ====================== Sub-schemas cho serviceDetails ====================== */
const PaymentSchema = new Schema(
    {
        amount: { type: Number, required: true, min: 0 },
        method: { type: String, enum: ['cash', 'card', 'transfer', 'momo', 'zalopay', 'other'], default: 'cash' },
        paidAt: { type: Date, default: Date.now },
        receivedBy: { type: Schema.Types.ObjectId, ref: 'user' },
        note: { type: String, trim: true },
    },
    { _id: false }
);

const CostSchema = new Schema(
    {
        label: { type: String, trim: true },
        amount: { type: Number, required: true, default: 0, min: 0 },
        createdAt: { type: Date, default: Date.now },
        createdBy: { type: Schema.Types.ObjectId, ref: 'user' },
    },
    { _id: false }
);

const CommissionSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'user', required: true },
        role: { type: String, trim: true }, // sale, doctor, referrer...
        percent: { type: Number, default: 0, min: 0 },
        amount: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

/**
 * Sub-schema để lưu trữ bản sao của chương trình đã chọn.
 * Giúp dữ liệu không bị ảnh hưởng nếu chương trình gốc trong model Service bị thay đổi.
 */
const SelectedCourseSchema = new Schema({
    name: { type: String, required: true },
    description: { type: String },
    costs: {
        basePrice: { type: Number, default: 0 },
        fullMedication: { type: Number, default: 0 },
        partialMedication: { type: Number, default: 0 },
        otherFees: { type: Number, default: 0 },
    }
}, { _id: false });


/** Mỗi phần tử trong mảng serviceDetails là 1 “đơn chốt / lịch chốt” */
const ServiceDetailSchema = new Schema(
    {
        // Trạng thái duyệt đơn
        approvalStatus: { type: String, enum: ['pending', 'approved'], default: 'pending' },
        approvedBy: { type: Schema.Types.ObjectId, ref: 'user' },
        approvedAt: { type: Date },

        // Ghi chú & xử lý chung của đơn
        status: { type: String, enum: ['new', 'in_progress', 'completed', 'rejected'], default: 'new' },
        notes: { type: String, trim: true },

        // Ngành học và chương trình liên quan
        interestedServices: { type: [{ type: Schema.Types.ObjectId, ref: 'service' }], default: [] },
        selectedService: { type: Schema.Types.ObjectId, ref: 'service' },

        // --- TRƯỜNG MỚI ---
        // Lưu lại thông tin chi tiết của chương trình đã chọn tại thời điểm chốt
        selectedCourse: { type: SelectedCourseSchema },

        // Giá/giảm giá/chốt
        pricing: {
            listPrice: { type: Number, default: 0, min: 0 },
            discountType: { type: String, enum: ['none', 'amount', 'percent'], default: 'none' },
            discountValue: { type: Number, default: 0, min: 0 },
            adjustmentType: { type: String, enum: ['none', 'discount', 'increase'], default: 'none' },
            adjustmentValue: { type: Number, default: 0, min: 0 },
            finalPrice: { type: Number, default: 0, min: 0 },
        },

        // Thanh toán nhiều đợt
        payments: { type: [PaymentSchema], default: [] },

        // Tổng đã nhận & công nợ
        amountReceivedTotal: { type: Number, default: 0, min: 0 },
        outstandingAmount: { type: Number, default: 0, min: 0 },

        // Chi phí & hoa hồng
        costs: { type: [CostSchema], default: [] },
        commissions: { type: [CommissionSchema], default: [] },

        // Thông tin kết sổ/invoice & doanh thu ghi nhận
        closedAt: { type: Date },
        closedBy: { type: Schema.Types.ObjectId, ref: 'user' },
        invoiceDriveIds: { type: [String], default: [] },
        customerPhotosDriveIds: { type: [String], default: [] }, // Ảnh khách hàng minh chứng
        revenue: { type: Number, default: 0, min: 0 },
    },
    { _id: true, versionKey: false }
);

// TÍNH LẠI TIỀN: KHÔNG chạm vào `revenue`
ServiceDetailSchema.methods.recalcMoney = function () {
    if (this.pricing) {
        const listPrice = Number(this.pricing.listPrice || 0);
        const discountType = this.pricing.discountType || 'none';
        const discountValue = Number(this.pricing.discountValue || 0);
        const adjustmentType = this.pricing.adjustmentType || 'none';
        const adjustmentValue = Number(this.pricing.adjustmentValue || 0);

        if (!this.pricing.finalPrice || this.pricing.finalPrice < 0) {
            if (adjustmentType === 'discount') {
                if (discountType === 'amount') {
                    this.pricing.finalPrice = Math.max(0, listPrice - discountValue);
                } else if (discountType === 'percent') {
                    this.pricing.finalPrice = Math.max(0, Math.round(listPrice * (1 - discountValue / 100)));
                } else {
                    this.pricing.finalPrice = listPrice;
                }
            } else if (adjustmentType === 'increase') {
                if (discountType === 'amount') {
                    this.pricing.finalPrice = Math.max(0, listPrice + adjustmentValue);
                } else if (discountType === 'percent') {
                    this.pricing.finalPrice = Math.max(0, Math.round(listPrice * (1 + adjustmentValue / 100)));
                } else {
                    this.pricing.finalPrice = listPrice;
                }
            } else {
                this.pricing.finalPrice = listPrice;
            }
        }
    }

    const paid = (this.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    this.amountReceivedTotal = paid;

    const fp = Number(this?.pricing?.finalPrice || 0);
    this.outstandingAmount = Math.max(0, fp - paid);
};

ServiceDetailSchema.pre('validate', function (next) {
    this.recalcMoney();
    next();
});

/* ====================== FormSchema (Customer) ====================== */
const FormSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        phone: { type: String, trim: true, unique: true, match: /^0\d{9}$/ },
        area: { type: String, trim: true },

        source: { type: Schema.Types.ObjectId, ref: 'form', required: true },
        sourceDetails: { type: String, trim: true },

        uid: {
            type: [{
                zalo: { type: Schema.Types.ObjectId, ref: 'user' },
                uid: String,
                isFriend: { type: Number, default: 0 },
                isReques: { type: Number, default: 0 },
            }],
        },
        bd: { type: Date },
        createAt: { type: Date, default: Date.now },

        care: {
            type: [{
                content: String,
                step: Number,
                createBy: { type: Schema.Types.ObjectId, ref: 'user' },
                createAt: { type: Date, default: Date.now },
            }],
            default: [],
        },

        zaloavt: String,
        zaloname: String,

        assignees: {
            type: [{
                user: { type: Schema.Types.ObjectId, ref: 'user' },
                group: { type: String, enum: ['telesale', 'care', 'noi_khoa', 'ngoai_khoa'] },
                assignedAt: { type: Date, default: Date.now },
            }],
            default: [],
        },

        pipelineStatus: {
            type: [String],
            enum: [
                'new_unconfirmed_1', 'missing_info_1', 'not_valid_1', 'msg_success_2', 'msg_error_2',
                'duplicate_merged_1', 'rejected_immediate_1', 'valid_1', 'noikhoa_3', 'ngoaikhoa_3',
                'undetermined_3', 'consulted_pending_4', 'scheduled_unconfirmed_4', 'callback_4',
                'not_interested_4', 'no_contact_4', 'confirmed_5', 'postponed_5', 'canceled_5',
                'serviced_completed_6', 'serviced_in_progress_6', 'rejected_after_consult_6',
            ],
            default: [],
        },

        zaloPhase: { type: String, enum: ['welcome', 'nurturing', 'pre_surgery', 'post_surgery', 'longterm'], default: null },
        tags: { type: [{ type: Schema.Types.ObjectId, ref: 'service' }], default: [] },
        roles: { type: [{ type: Schema.Types.ObjectId, ref: 'user', required: true }], default: [] },
        workflowTemplates: { type: [Schema.Types.ObjectId], ref: 'workflowtemplate', default: [] },
        assignee: { type: Schema.Types.ObjectId, ref: 'user', default: null },
        assignedBy: { type: Schema.Types.ObjectId, ref: 'user', default: null },
        assignedAt: { type: Date, default: null },
        isAutoAssigned: { type: Boolean, default: false },

        serviceDetails: { type: [ServiceDetailSchema], default: [] },
        
        id_phone_mes: { type: String, default: null }, // ID conversation từ Pancake
    },
    { timestamps: false, versionKey: false }
);

/* Chuẩn hóa trước khi save */
FormSchema.pre('save', function (next) {
    if (this.phone) this.phone = this.phone.replace(/\D/g, '');
    if (this.name)
        this.name = this.name
            .trim()
            .replace(/\s+/g, ' ')
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    next();
});

/* Indexes */
FormSchema.index({ phone: 1 }, { unique: true });
FormSchema.index({ source: 1 });
FormSchema.index({ tags: 1 });

const Customer = models.customer || model('customer', FormSchema);
export default Customer;