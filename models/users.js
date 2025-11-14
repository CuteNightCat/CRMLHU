import { Schema, model, models } from 'mongoose'

const postUser = new Schema({
  name: {
    type: String,
  },
  address: {
    type: String,
  },
  avt: {
    type: String,
  },
  role: {
    type: Array,
  },
  phone: {
    type: String,
  },
  email: {
    type: String,
  },
  zalo: {
    type: Schema.Types.ObjectId, ref: 'zalo'
  },
  uid: {
    type: String,
  },
  group: {
    type: String,
    enum: ['telesale', 'care', 'noi_khoa', 'ngoai_khoa'],
    required: true
  }
}, { timestamps: true })

const users = models.user || model('user', postUser)

export default users