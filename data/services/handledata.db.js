// data/services/handledata.db.js
import mongoose from 'mongoose';
import Service from '@/models/services.model';
import connectMongo from '@/config/connectDB';
import { cacheData } from '@/lib/cache';

function toObjectId(id) {
  try { return new mongoose.Types.ObjectId(id); } catch { return null; }
}

async function dataService(id) {
  await connectMongo();

  const matchStage = id ? [{ $match: { _id: toObjectId(id) } }] : [];

  const pipeline = [
    ...matchStage,
    { $sort: { createdAt: -1 } },
    // Đếm số lead đang tham chiếu service này (nếu có collection 'leads')
    {
      $lookup: {
        from: 'leads',
        let: { sid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$serviceId', '$$sid'] } } },
          { $count: 'c' }
        ],
        as: 'leadAgg'
      }
    },
    {
      $addFields: {
        leadCount: { $ifNull: [{ $arrayElemAt: ['$leadAgg.c', 0] }, 0] }
      }
    },
    { $project: { leadAgg: 0 } }
  ];

  const docs = await Service.aggregate(pipeline);
  return JSON.parse(JSON.stringify(id ? docs[0] || null : docs));
}

export async function getServiceAll() {
  const cached = cacheData(() => dataService(), ['services']);
  return cached();
}

export async function getServiceOne(id) {
  const cached = cacheData(() => dataService(id), ['services', String(id)]);
  return cached();
}
