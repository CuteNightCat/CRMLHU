import { Schema, model, models } from 'mongoose'

const postInvoices = new Schema({
    studentId: { type: Schema.Types.ObjectId, required: true, ref: 'student' },
    courseId: { type: Schema.Types.ObjectId, required: true, ref: 'course' },
    amountInitial: { type: Number },
    amountPaid: { type: Number },
    paymentMethod: { type: Number, enum: [0, 1], default: 0 }, // 0: Tiền mặt, 1: Chuyển khoản
    discount: { type: Number, default: 0 }, // Giảm giá
    createBy: { type: Schema.Types.ObjectId, required: true, ref: 'user' },
}, { timestamps: true })

const invoices = models.invoice || model('invoice', postInvoices)

export default invoices