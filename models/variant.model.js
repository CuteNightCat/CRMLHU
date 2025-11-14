import { Schema, model, models } from 'mongoose'

const VariantSchema = new Schema(
    {
        name: {
            type: String,
            required: [true, "Vui lòng nhập tên biến thể."],
            trim: true,
            unique: true
        },
        description: {
            type: String,
            trim: true
        },
        phrases: {
            type: [String],
            default: []
        }
    },
    { timestamps: true }
)

const Variant = models.variant || model('variant', VariantSchema)
export default Variant