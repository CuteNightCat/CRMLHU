import { Schema, model, models } from "mongoose";

const ZaloSchema = new Schema(
    {
        uid: { type: String, required: true, unique: true, trim: true },
        name: { type: String, required: true, trim: true },
        phone: { type: String, required: true },
        avt: { type: String },
        
        // THAY ĐỔI QUAN TRỌNG: Đưa rate limit ra ngoài và đổi tên cho khớp
        rateLimitPerHour: { type: Number, default: 30 },
        rateLimitPerDay: { type: Number, default: 200 },
        
        // Giữ lại các trường khác
        action: { type: [{ type: Schema.Types.ObjectId, ref: 'scheduledjob' }], default: [] },
        roles: {
            type: [{ type: Schema.Types.ObjectId, ref: 'user' }],
            default: []
        },
    },
    { timestamps: true },
);

// Đổi tên model để nhất quán (thường import Zalo from '...')
const Zalo = models.zalo || model("zalo", ZaloSchema);

export default Zalo;