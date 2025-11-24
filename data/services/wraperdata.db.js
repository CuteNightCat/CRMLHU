'use server';

import { revalidateTag } from 'next/cache';
import connectMongo from '@/config/connectDB';
import Service from '@/models/services.model';
import { getServiceAll, getServiceOne } from '@/data/services/handledata.db';
import checkAuthToken from '@/utils/checktoken';
import { uploadBufferToDrive } from '@/lib/drive';
import { Readable } from 'node:stream';

// ====== LOG HELPERS ======
const SERVICE_DEBUG = process.env.SERVICE_DEBUG === 'true';
const modTag = '[services.actions]';

function now() {
  const d = new Date();
  return d.toISOString();
}
function rid() {
  try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2, 10); }
}

// ====== HELPERS ======

function parseNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// data:image/<mime>;base64,<...>
function dataURLtoParts(dataURL) {
  if (typeof dataURL !== 'string') return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataURL);
  if (!m) return null;
  const mime = m[1];
  const base64 = m[2];
  return { mime, buffer: Buffer.from(base64, 'base64') };
}

function fileNameFor(name = 'service') {
  const base = String(name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  return `service-cover-${base || 'item'}-${Date.now()}.jpg`;
}

/** Upload banner (nếu là dataURL); trả về driveId (string) hoặc null nếu không đổi */
async function ensureDriveIdFromCover(cover, nameHint, reqId) {
  if (!cover) return null;
  const parts = dataURLtoParts(cover);
  if (!parts) {
    return null;
  }
  try {
    // Sử dụng folder ID từ Shared Drive (không tạo folder mới)
    const folderId = '1M-lSX-URoyvX-IU7e-TK-nhgkl7ptda3';
    
    const info = await uploadBufferToDrive({
      name: fileNameFor(nameHint),
      mime: parts.mime,
      buffer: parts.buffer,
      folderId: folderId
    });
    return info?.id || null;
  } catch (err) {
    console.error(modTag, now(), reqId, 'ensureDriveIdFromCover: upload error', err?.message, err?.response?.data || err);
    return null;
  }
}


// =================================================================
// CÁC HÀM HELPER MỚI ĐỂ XỬ LÝ DỮ LIỆU ĐẦU VÀO
// =================================================================

/**
 * Xử lý và chuẩn hóa mảng chương trình
 * @param {Array} courses - Mảng chương trình từ formData
 * @returns {Array} Mảng chương trình đã được làm sạch
 */
function parseTreatmentCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses.map(course => ({
    name: String(course.name || '').trim(),
    description: String(course.description || '').trim(),
    costs: {
      basePrice: parseNumber(course.costs?.basePrice, 0),
      fullMedication: parseNumber(course.costs?.fullMedication, 0),
      partialMedication: parseNumber(course.costs?.partialMedication, 0),
      otherFees: parseNumber(course.costs?.otherFees, 0),
    }
  })).filter(course => course.name); // Chỉ giữ lại các chương trình có tên
}

/**
 * Xử lý và chuẩn hóa mảng tin nhắn trước tuyển sinh
 * @param {Array} messages - Mảng tin nhắn từ formData
 * @returns {Array} Mảng tin nhắn đã được làm sạch
 */
function parsePreSurgeryMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(msg => ({
    appliesToCourse: String(msg.appliesToCourse || '').trim(),
    content: String(msg.content || '').trim(),
  })).filter(msg => msg.appliesToCourse && msg.content); // Chỉ giữ lại tin nhắn hợp lệ
}

/**
 * Xử lý và chuẩn hóa mảng tin nhắn sau tuyển sinh
 * @param {Array} messages - Mảng tin nhắn từ formData
 * @returns {Array} Mảng tin nhắn đã được làm sạch
 */
function parsePostSurgeryMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const validUnits = ['days', 'hours', 'weeks', 'months'];
  return messages.map(msg => ({
    appliesToCourse: String(msg.appliesToCourse || '').trim(),
    sendAfter: {
      value: parseNumber(msg.sendAfter?.value, 1),
      unit: validUnits.includes(msg.sendAfter?.unit) ? msg.sendAfter.unit : 'days',
    },
    content: String(msg.content || '').trim(),
  })).filter(msg => msg.appliesToCourse && msg.content); // Chỉ giữ lại tin nhắn hợp lệ
}


// ====== EXPORTED ACTIONS ======

export async function service_data(id) {
  const reqId = rid();
  try {
    const res = id ? await getServiceOne(id) : await getServiceAll();
    return res;
  } catch (err) {
    console.error(modTag, now(), reqId, 'service_data: error', err?.message);
    throw err;
  }
}

export async function reloadServices() {
  revalidateTag('services');
}

/* -----------------------
   CREATE
----------------------- */
export async function createService(formData) {
  const reqId = rid();
  try {
    const me = await checkAuthToken();
    if (!me || !me.id) {
      return { success: false, error: 'Không xác thực được người dùng.' };
    }
    await connectMongo();

    // Destructure các trường mới từ formData
    const {
      name,
      type,
      saleGroup,
      defaultSale,
      description = '',
      cover,
      treatmentCourses,
      preSurgeryMessages,
      postSurgeryMessages,
    } = formData || {};

    const payload = {
      name: String(name || '').trim(),
      type,
      saleGroup: saleGroup || null,
      defaultSale: defaultSale || null,
      description: String(description || '').trim(),
      // Xử lý các trường mảng bằng helper
      treatmentCourses: parseTreatmentCourses(treatmentCourses),
      preSurgeryMessages: parsePreSurgeryMessages(preSurgeryMessages),
      postSurgeryMessages: parsePostSurgeryMessages(postSurgeryMessages),
    };

    // upload banner nếu có
    if (cover) {
      const driveId = await ensureDriveIdFromCover(cover, payload.name, reqId);
      if (driveId) {
        payload.cover = driveId;
      }
    }

    const created = await Service.create(payload);
    revalidateTag('services');

    return { success: true, data: { id: String(created._id), slug: created.slug, cover: created.cover } };
  } catch (err) {
    if (err && err.code === 11000) {
      return { success: false, error: 'Tên/slug ngành học đã tồn tại.' };
    }
    console.error(modTag, now(), reqId, 'createService: error', err?.message, err?.response?.data || err);
    return { success: false, error: 'Không thể tạo ngành học.' };
  }
}

/* -----------------------
   UPDATE
----------------------- */
export async function updateService(id, formData) {
  const reqId = rid();
  try {
    const me = await checkAuthToken();
    if (!me || !me.id) {
      return { success: false, error: 'Không xác thực được người dùng.' };
    }
    await connectMongo();

    // Destructure các trường mới
    const {
      name,
      type,
      saleGroup,
      defaultSale,
      description,
      cover,
      isActive,
      treatmentCourses,
      preSurgeryMessages,
      postSurgeryMessages,
    } = formData || {};

    const svc = await Service.findById(id);
    if (!svc) {
      return { success: false, error: 'Ngành học không tồn tại.' };
    }

    // Cập nhật các trường cơ bản nếu có
    if (name != null) svc.name = String(name).trim();
    if (type != null) svc.type = type;
    if (saleGroup != null) svc.saleGroup = saleGroup;
    if (defaultSale != null) svc.defaultSale = defaultSale;
    if (description != null) svc.description = String(description).trim();
    if (typeof isActive === 'boolean') svc.isActive = isActive;

    // Cập nhật các trường mảng nếu có trong formData
    if (treatmentCourses) {
      svc.treatmentCourses = parseTreatmentCourses(treatmentCourses);
    }
    if (preSurgeryMessages) {
      svc.preSurgeryMessages = parsePreSurgeryMessages(preSurgeryMessages);
    }
    if (postSurgeryMessages) {
      svc.postSurgeryMessages = parsePostSurgeryMessages(postSurgeryMessages);
    }

    if (cover) {
      const driveId = await ensureDriveIdFromCover(cover, svc.name, reqId);
      if (driveId) {
        svc.cover = driveId;
      }
    }

    await svc.save();
    revalidateTag('services');
    // Revalidate combined-data để cập nhật customer.tags (services) trong UI
    revalidateTag('combined-data');
    return { success: true, data: { cover: svc.cover } };
  } catch (err) {
    if (err && err.code === 11000) {
      return { success: false, error: 'Tên/slug ngành học đã tồn tại.' };
    }
    console.error(modTag, now(), reqId, 'updateService: error', err?.message, err?.response?.data || err);
    return { success: false, error: 'Không thể cập nhật ngành học.' };
  }
}

/* -----------------------
   TOGGLE ACTIVE
----------------------- */
export async function setServiceActive(id, active) {
  const reqId = rid();
  try {
    const me = await checkAuthToken();
    if (!me || !me.id) {
      return { success: false, error: 'Không xác thực được người dùng.' };
    }
    await connectMongo();
    const svc = await Service.findById(id);
    if (!svc) {
      return { success: false, error: 'Ngành học không tồn tại.' };
    }
    svc.isActive = !!active;
    await svc.save();
    revalidateTag('services');
    return { success: true, data: { isActive: svc.isActive } };
  } catch (err) {
    console.error(modTag, now(), reqId, 'setServiceActive: error', err?.message, err?.response?.data || err);
    return { success: false, error: 'Không thể đổi trạng thái ngành học.' };
  }
}