import mongoose from 'mongoose';

const LabelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Vui lòng cung cấp tên nhãn.'],
        trim: true,
        unique: true,
        maxlength: [50, 'Tên nhãn không được vượt quá 50 ký tự.'],
    },
    color: {
        type: String,
        required: [true, 'Vui lòng cung cấp màu cho nhãn.'],
        trim: true,
    },
    customer: {
        type: [],
        default: [],
    },
}, { timestamps: true });

export default mongoose.models.Labelfb || mongoose.model('Labelfb', LabelSchema);
