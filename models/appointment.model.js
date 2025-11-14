// models/appointment.model.js

import mongoose, { Schema, model, models } from "mongoose";

const AppointmentSchema = new Schema(
    {
        // Ngành học được chọn cho cuộc hẹn (liên kết tới model Service)
        service: {
            type: Schema.Types.ObjectId,
            ref: 'service',
            required: true,
            index: true,
        },
        // Tên của chương trình được chọn từ ngành học
        treatmentCourse: {
            type: String,
            required: true,
            trim: true,
        },
        // Khách hàng được đặt lịch hẹn (liên kết tới model Customer)
        customer: {
            type: Schema.Types.ObjectId,
            ref: 'customer',
            required: true,
            index: true,
        },
        // Loại cuộc hẹn: tư vấn (interview) hay hoàn tất nhập học (surgery)
        appointmentType: {
            type: String,
            required: true,
            enum: ['interview', 'surgery'],
            default: 'interview',
            index: true,
        },
        // Thời gian diễn ra cuộc hẹn
        appointmentDate: {
            type: Date,
            required: true,
        },
        // Ghi chú thêm cho cuộc hẹn
        notes: {
            type: String,
            trim: true,
            default: ""
        },
        // Trạng thái của cuộc hẹn
        status: {
            type: String,
            required: true,
            enum: ['pending', 'completed', 'cancelled', 'missed'],
            default: 'pending',
        },
        // Người tạo lịch hẹn (nhân viên, liên kết tới model User)
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'user',
            required: true,
        }
    },
    {
        timestamps: true // Tự động thêm createdAt và updatedAt
    }
);

const Appointment = models.appointment || model("appointment", AppointmentSchema);
export default Appointment;