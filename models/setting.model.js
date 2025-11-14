// models/setting.ts
import { Schema, model, models } from "mongoose";

const SettingSchema = new Schema(
    {
        key: { type: String, unique: true, required: true, index: true },
        value: { type: Schema.Types.Mixed, default: {} },
        content: { type: String, default: "" }
    },
    { timestamps: true }
);

const Setting = models.setting || model("setting", SettingSchema);
export default Setting;
