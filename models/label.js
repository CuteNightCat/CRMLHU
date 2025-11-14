import { Schema, model, models } from 'mongoose';

const labelSchema = new Schema(
    {
        title: { type: String, required: true, trim: true },
        desc: { type: String, default: '' },
        content: { type: String, default: '' }
    },
    { timestamps: true },
);

const Label = models.label || model('label', labelSchema);
export default Label;