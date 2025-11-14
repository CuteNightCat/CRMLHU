import { Schema, model, models } from 'mongoose'

const RoomSchema = new Schema(
    {
        status: { type: Boolean, default: false },
        message: { type: String, trim: true },
        data: {
            type: Schema.Types.Mixed, default: {}
        }
    },
    { _id: false, versionKey: false }
)

const logs = new Schema(
    {
        status: { type: RoomSchema },
        type: { type: String, required: true, enum: ["sendMessage", "addFriend", "findUid", "checkFriend", "tag"] },
        createdAt: { type: Date, default: Date.now },
        createBy: { type: Schema.Types.ObjectId, ref: 'user', required: true },
        customer: { type: Schema.Types.ObjectId, ref: 'customer' },
        zalo: { type: Schema.Types.ObjectId, ref: 'zalo', required: true },
        schedule: { type: Schema.Types.ObjectId, ref: 'scheduledjob', default: null },
    },
    { timestamps: false, versionKey: false }
)

const Logs = models.logmes || model('logmes', logs)
export default Logs
