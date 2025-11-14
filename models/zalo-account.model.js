// models/zalo-account.model.js
import mongoose, { Schema, model, models } from 'mongoose';

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * ZALO ACCOUNT + SESSION MODEL — Lưu & duy trì trạng thái đăng nhập zca-js
 *
 * Mục tiêu:
 *  - Lưu danh sách các tài khoản Zalo (1 document ~ 1 account) + dữ liệu phiên
 *  - Sau khi đăng nhập bằng QR lần đầu → lưu cookies/imei/userAgent để lần sau
 *    đăng nhập lại bằng cookies (tránh quét QR nhiều, giảm rủi ro bị nghi ngờ)
 *  - Theo dõi trạng thái hoạt động, thời điểm cập nhật, khóa tránh login cạnh tranh
 *
 * Gợi ý sử dụng trong luồng:
 *  1) Đăng nhập lần đầu (QR):
 *     - Nhận được api (đã login) → lấy cookie/ownId/userAgent/imei → upsert vào DB
 *  2) Khởi động lại server:
 *     - Tìm account trong DB → nếu có cookies/imei/userAgent hợp lệ → login by cookies
 *  3) Khi phát hiện mất phiên:
 *     - Cập nhật status, có thể xóa cookies hoặc đặt cờ yêu cầu QR lại
 *
 * Lưu ý:
 *  - cookies là dữ liệu nhạy cảm → KHÔNG trả về cho frontend.
 *  - Nên giữ imei + userAgent nhất quán để Zalo nhận diện cùng 1 thiết bị.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/* ================================ Sub-schemas ================================ */

/**
 * Thông tin hiển thị cơ bản của tài khoản (không nhạy cảm)
 * - Dùng để render UI danh sách tài khoản: tên, avatar, phone (mask)
 */
const ZaloProfileSchema = new Schema(
  {
    zaloId: { type: String, required: true, trim: true }, // VD: api.getOwnId()
    displayName: { type: String, default: '', trim: true },
    avatar: { type: String, default: '', trim: true },
    phoneMasked: { type: String, default: '', trim: true }, // không lưu số thật nếu không cần
  },
  { _id: false, strict: true }
);

/**
 * Dấu vết/metadata cho “thiết bị” đăng nhập mô phỏng (web)
 * - Giữ cố định imei (z_uuid) + userAgent → giúp Zalo “nhận ra” cùng 1 môi trường
 */
const DeviceFingerprintSchema = new Schema(
  {
    imei: { type: String, required: true, trim: true },        // z_uuid
    userAgent: { type: String, required: true, trim: true },   // navigator.userAgent
    deviceName: { type: String, default: 'bot-web', trim: true }, // để phân biệt nếu bạn muốn
  },
  { _id: false, strict: true }
);

/**
 * Dữ liệu phiên đăng nhập
 * - cookies: toàn bộ cookie sau khi login (đủ để login lại)
 * - lastActiveAt: lần cuối xác nhận session còn "sống"
 * - lastLoginMethod: cách login gần nhất (qr|cookie)
 * - sessionVersion: để bạn chủ động rotate/upgrade logic (tùy chọn)
 */
const SessionSchema = new Schema(
  {
    cookies: { type: Schema.Types.Mixed, required: true }, // JSON/array cookie — không gửi ra FE
    lastActiveAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: Date.now },
    lastLoginMethod: { type: String, enum: ['qr', 'cookie'], default: 'qr' },
    sessionVersion: { type: Number, default: 1 },
  },
  { _id: false, strict: true }
);

/* ================================ Main schema ================================ */

const ZaloAccountSchema = new Schema(
  {
    /**
     * Khóa nhận diện chính của tài khoản Zalo (own id).
     * - unique để đảm bảo mỗi tài khoản chỉ có 1 bản ghi.
     */
    accountKey: { type: String, required: true, unique: true, trim: true },

    /**
     * Thông tin hiển thị (không nhạy cảm)
     */
    profile: { type: ZaloProfileSchema, required: true },

    /**
     * Dấu vết “thiết bị” login web (giữ cố định để hạn chế nghi ngờ)
     */
    device: { type: DeviceFingerprintSchema, required: true },

    /**
     * Trạng thái tổng thể của tài khoản trong hệ thống
     * - active: đang dùng bình thường (đã đăng nhập, api listener hoạt động)
     * - disconnected: mất phiên, cần login lại (thường là QR)
     * - blocked: tạm khóa manual (vd nghi ngờ)
     */
    status: {
      type: String,
      enum: ['active', 'disconnected', 'blocked'],
      default: 'active',
      index: true,
    },

    /**
     * Dữ liệu phiên đăng nhập hiện tại (cookies…)
     * - ĐỦ để login lại bằng cookies nếu còn hợp lệ
     */
    session: { type: SessionSchema, required: true },

    /**
     * Cờ & metadata vận hành:
     * - isLockedForLogin: tránh 2 tiến trình/2 request cùng lúc khởi login lại
     * - lockedAt / lockedBy: audit cờ khóa
     * - notes: ghi chú nội bộ
     */
    ops: {
      isLockedForLogin: { type: Boolean, default: false },
      lockedAt: { type: Date, default: null },
      lockedBy: { type: String, default: null, trim: true }, // userId|serviceId
      notes: { type: String, default: '', trim: true },
    },

    /**
     * Tham chiếu chủ sở hữu/bối cảnh workspace (tùy hệ thống của bạn)
     * - Không bắt buộc, nhưng hữu ích khi đa tenant
     */
    ownerId: { type: Schema.Types.ObjectId, ref: 'account', default: null },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'workspace', default: null },
  },
  {
    timestamps: true, // createdAt, updatedAt
    strict: true,
  }
);

/* ================================ Indexes ================================ */

ZaloAccountSchema.index({ accountKey: 1 }, { unique: true });
ZaloAccountSchema.index({ 'profile.zaloId': 1 });
ZaloAccountSchema.index({ status: 1, updatedAt: -1 });

/* ================================ Virtuals ================================ */

/**
 * Có thể đăng nhập lại bằng cookies không?
 * - Điều kiện tối thiểu: status !== 'blocked' & có đủ cookies/imei/userAgent
 */
ZaloAccountSchema.virtual('canReloginWithCookies').get(function () {
  const hasEssentials =
    !!this?.session?.cookies &&
    !!this?.device?.imei &&
    !!this?.device?.userAgent;
  return this.status !== 'blocked' && hasEssentials;
});

/* ================================ Methods (instance) ================================ */

/**
 * markActive() — đánh dấu tài khoản hoạt động bình thường
 * - cập nhật lastActiveAt để theo dõi “sống”
 */
ZaloAccountSchema.methods.markActive = async function () {
  this.status = 'active';
  if (this.session) {
    this.session.lastActiveAt = new Date();
  }
  await this.save();
  return this;
};

/**
 * markDisconnected(reason) — đánh dấu mất phiên (cần QR lại)
 */
ZaloAccountSchema.methods.markDisconnected = async function (reason = '') {
  this.status = 'disconnected';
  if (reason) {
    this.ops.notes = `[${new Date().toISOString()}] disconnected: ${reason}\n${this.ops.notes || ''}`;
  }
  await this.save();
  return this;
};

/**
 * lockForLogin(by) — khóa tạm để tránh 2 lần login cạnh tranh
 * - nhớ gọi unlockForLogin() sau khi hoàn tất
 */
ZaloAccountSchema.methods.lockForLogin = async function (by = 'system') {
  if (this.ops.isLockedForLogin) {
    throw new Error('Account already locked for login. Avoid concurrent logins.');
  }
  this.ops.isLockedForLogin = true;
  this.ops.lockedAt = new Date();
  this.ops.lockedBy = by;
  await this.save();
  return this;
};

ZaloAccountSchema.methods.unlockForLogin = async function () {
  this.ops.isLockedForLogin = false;
  this.ops.lockedAt = null;
  this.ops.lockedBy = null;
  await this.save();
  return this;
};

/**
 * updateSession({ cookies, loginMethod }) — cập nhật cookies sau login (QR/cookie)
 * - giữ nguyên imei/userAgent trong this.device để nhất quán thiết bị
 */
ZaloAccountSchema.methods.updateSession = async function ({
  cookies,
  loginMethod = 'cookie',
} = {}) {
  if (!cookies) throw new Error('cookies is required to update session');
  this.session.cookies = cookies;
  this.session.lastLoginAt = new Date();
  this.session.lastLoginMethod = loginMethod;
  this.session.lastActiveAt = new Date();
  this.status = 'active';
  await this.save();
  return this;
};

/* ================================ Statics (model) ================================ */

/**
 * upsertFromLoginResult(loginPayload)
 * - Dùng NGAY SAU khi đăng nhập thành công (QR hoặc cookie) để lưu DB
 * - loginPayload gợi ý:
 *   {
 *     accountKey,               // bắt buộc (ownId)
 *     profile: { zaloId, displayName, avatar, phoneMasked? },
 *     device:  { imei, userAgent, deviceName? },
 *     cookies,                  // từ api.getCookie()
 *     ownerId?, workspaceId?
 *     loginMethod: 'qr' | 'cookie'
 *   }
 */
ZaloAccountSchema.statics.upsertFromLoginResult = async function (loginPayload) {
  const {
    accountKey,
    profile,
    device,
    cookies,
    ownerId = null,
    workspaceId = null,
    loginMethod = 'cookie',
  } = loginPayload || {};

  if (!accountKey) throw new Error('accountKey (ownId) is required');
  if (!profile?.zaloId) throw new Error('profile.zaloId is required');
  if (!device?.imei || !device?.userAgent) {
    throw new Error('device.imei and device.userAgent are required');
  }
  if (!cookies) throw new Error('cookies is required');

  const now = new Date();

  const updateDoc = {
    profile: {
      zaloId: profile.zaloId,
      displayName: profile.displayName || '',
      avatar: profile.avatar || '',
      phoneMasked: profile.phoneMasked || '',
    },
    device: {
      imei: device.imei,
      userAgent: device.userAgent,
      deviceName: device.deviceName || 'bot-web',
    },
    session: {
      cookies,
      lastActiveAt: now,
      lastLoginAt: now,
      lastLoginMethod: loginMethod,
      sessionVersion: 1,
    },
    status: 'active',
    ownerId,
    workspaceId,
  };

  const doc = await this.findOneAndUpdate(
    { accountKey },
    { $set: updateDoc },
    { new: true, upsert: true }
  );

  return doc;
};

/**
 * findActiveOrReconnectable()
 * - Lấy danh sách account có thể sử dụng hoặc có thể login lại bằng cookies
 * - Hữu ích cho tiến trình khởi động server: thử loginByCookies theo thứ tự
 */
ZaloAccountSchema.statics.findActiveOrReconnectable = async function () {
  const docs = await this.find({
    status: { $in: ['active', 'disconnected'] },
  })
    .sort({ updatedAt: -1 })
    .lean();
  return docs;
};

/* ================================ Model export ================================ */

export const ZaloAccount =
  models.zalo_account || model('zalo_account', ZaloAccountSchema);

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * HƯỚNG DẪN TÍCH HỢP (tham khảo nhanh)
 * 
 * 1) Sau khi login bằng QR (lần đầu):
 *    const ownId = await api.getOwnId();
 *    const cookies = await api.getCookie();
 *    await ZaloAccount.upsertFromLoginResult({
 *      accountKey: ownId,
 *      profile: { zaloId: ownId, displayName, avatar },
 *      device:  { imei, userAgent },          // giữ cố định để lần sau login cookie
 *      cookies,
 *      loginMethod: 'qr',
 *      ownerId, workspaceId,
 *    });
 * 
 * 2) Khởi động server → thử login bằng cookies:
 *    const accounts = await ZaloAccount.findActiveOrReconnectable();
 *    for (const acc of accounts) {
 *      if (!acc.canReloginWithCookies) continue;
 *      try {
 *        const api = await zalo.login({
 *          cookie: acc.session.cookies,
 *          imei: acc.device.imei,
 *          userAgent: acc.device.userAgent,
 *        });
 *        api.listener.start();
 *        await ZaloAccount.updateOne(
 *          { _id: acc._id },
 *          { $set: { status: 'active', 'session.lastActiveAt': new Date(), 'session.lastLoginMethod': 'cookie' } }
 *        );
 *        break; // thành công → dùng account này, nếu bạn chỉ dùng 1 tài khoản
 *      } catch (e) {
 *        await ZaloAccount.updateOne(
 *          { _id: acc._id },
 *          { $set: { status: 'disconnected' }, $push: { 'ops.notes': `[${new Date().toISOString()}] cookie login failed: ${e?.message}` } }
 *        );
 *        // chuyển sang account kế (nếu có) hoặc kích hoạt flow login QR
 *      }
 *    }
 * 
 * 3) Khi mất phiên trong lúc chạy:
 *    - Gọi acc.markDisconnected('reason');
 *    - Kích hoạt lại quy trình login (ưu tiên login bằng cookie, nếu fail → QR).
 * 
 * 4) Tránh login cạnh tranh:
 *    - Trước khi bắt đầu login lại: await acc.lockForLogin(userId)
 *    - Sau khi xong: await acc.unlockForLogin()
 * 
 * 5) Bảo mật:
 *    - Không trả cookies ra FE.
 *    - Có thể mã hóa cookies trước khi lưu (tùy yêu cầu bảo mật nội bộ).
 * ──────────────────────────────────────────────────────────────────────────────
 */
