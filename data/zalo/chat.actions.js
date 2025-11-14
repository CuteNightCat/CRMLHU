// data/zalo/chat.actions.js
'use server';

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * ZALO CHAT ACTIONS — Tác vụ nhắn tin / tìm user / alias / nhóm / listener
 *
 * Chức năng:
 *  - ensureApi(accountKey): đảm bảo có phiên API (ưu tiên reuse, nếu chưa có → cookie login)
 *  - findUserUid({ accountKey, phoneOrUid }): trả về uid + profile cơ bản
 *  - sendUserMessage({ accountKey, userId, text, attachments? })
 *  - changeFriendAlias({ accountKey, userId, alias })
 *  - sendGroupMessage({ accountKey, groupId, text, attachments? })
 *  - startMessageListener({ accountKey }): bật listener & đệm tin vào RAM
 *  - getRecentMessages({ accountKey, limit? }): lấy tin đã đệm để FE poll
 *  - stopMessageListener({ accountKey }) (tuỳ chọn)
 *
 * Thiết kế:
 *  - Dùng globalThis.__zalo_api_registry để tránh HMR/nhân đôi registry
 *  - Chỉ login bằng COOKIE (đọc từ Mongo) nếu chưa có api
 *  - Lắng nghe tin nhắn: on('message', ...) → normalize nhẹ → push vào ring buffer
 * ──────────────────────────────────────────────────────────────────────────────
 */

import 'server-only';

import { Zalo as ZCA } from 'zca-js';
import connectMongo from '@/config/connectDB';
import { ZaloAccount } from '@/models/zalo-account.model';

/* ================================ Global registries ================================ */

// Registry API: accountKey -> { api, startedAt }
if (!globalThis.__zalo_api_registry) {
    globalThis.__zalo_api_registry = new Map();
}
const API_REG = globalThis.__zalo_api_registry;

// Registry messages: accountKey -> { buf: [], max: number }
if (!globalThis.__zalo_msg_registry) {
    globalThis.__zalo_msg_registry = new Map();
}
const MSG_REG = globalThis.__zalo_msg_registry;

// Giới hạn bộ đệm tin
const BUF_MAX = 200;


function looksLikePhone(s) { return /^[+\d][\d\s-]*$/.test(s); }
function cleanPhone(s) { return String(s).trim().replace(/[\s-]/g, ''); }
function mapFindError(err, fallback = 'Find user failed') {
    const msg = String(err?.message || fallback);
    let code = 'unknown';
    if (/not.*found|404/i.test(msg)) code = 'not_found';
    else if (/rate|429/i.test(msg)) code = 'rate_limited';
    else if (/login|cookie|unauth|forbidden|401|403/i.test(msg)) code = 'unauthorized';
    return { ok: false, code, message: msg };
}
/* ================================ Utils ================================ */

async function ensureMongo() {
    await connectMongo();
}

/** Lấy api đang chạy (nếu có) */
function getRuntimeApi(accountKey) {
    return API_REG.get(accountKey)?.api || null;
}

/** Lưu api vào registry */
function setRuntimeApi(accountKey, api) {
    API_REG.set(accountKey, { api, startedAt: Date.now() });
}

/** Xoá api khỏi registry */
function removeRuntimeApi(accountKey) {
    API_REG.delete(accountKey);
}

/** Push 1 message vào buffer account */
function pushMsg(accountKey, msg) {
    const entry = MSG_REG.get(accountKey) || { buf: [], max: BUF_MAX };
    entry.buf.push(msg);
    if (entry.buf.length > entry.max) entry.buf.splice(0, entry.buf.length - entry.max);
    MSG_REG.set(accountKey, entry);
}

/** Lấy N tin gần nhất từ buffer */
function recentMsgs(accountKey, limit = 50) {
    const entry = MSG_REG.get(accountKey);
    if (!entry) return [];
    const { buf } = entry;
    if (limit <= 0 || limit >= buf.length) return buf.slice();
    return buf.slice(buf.length - limit);
}

/** Chuẩn hoá event message (giảm tải) */
function normalizeMessage(ev) {
    const d = ev?.data || {};
    const ts = d?.ts ? Number(d.ts) : Date.now();
    const text =
        typeof d?.content === 'string' ? d.content :
            (d?.content?.text || '');

    const imgs = Array.isArray(d?.content?.images) ? d.content.images : [];
    const attachments = Array.isArray(d?.attachments) ? d.attachments : [];
    const att = [
        ...attachments.map(a => ({
            name: a?.name || a?.filename || '',
            mime: a?.mime || '',
            size: Number(a?.size || 0),
            url: a?.url || '',
            type: a?.type || 'file'
        })),
        ...imgs.map((u, i) => ({ name: `image_${i + 1}.jpg`, mime: 'image/jpeg', url: u, size: 0, type: 'image' }))
    ];

    return {
        threadId: String(ev?.threadId || ''),
        isSelf: !!ev?.isSelf,
        ts,
        text,
        attachments: att,
        rawType: ev?.type ?? null
    };
}

/* ================================ Core: ensure API ================================ */

/**
 * ensureZaloApi(accountKey)
 * - Trả về phiên API đã đăng nhập. Nếu chưa có → login bằng cookie từ MongoDB.
 * - KHÔNG quét QR trong file này (để tránh nghi ngờ); QR làm ở file actions khác.
 */
async function ensureZaloApi(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');

    // Reuse nếu đã có
    {
        const api = getRuntimeApi(accountKey);
        if (api) return api;
    }

    // Login cookie 1 lần
    await ensureMongo();
    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');

    const can =
        acc.status !== 'blocked' &&
        !!acc?.session?.cookies &&
        !!acc?.device?.imei &&
        !!acc?.device?.userAgent;

    if (!can) {
        throw new Error('Account cannot login by cookies. Missing session/device or blocked.');
    }

    // Thực hiện cookie login
    const zalo = new ZCA();
    const api = await zalo.login({
        cookie: acc.session.cookies,   // cookie JSON đã lưu
        imei: acc.device.imei,
        userAgent: acc.device.userAgent
    });

    // Bật listener tối thiểu
    try {
        api.listener?.on?.('message', (ev) => {
            pushMsg(accountKey, normalizeMessage(ev));
        });
        api.listener?.start?.();
    } catch { /* optional */ }

    setRuntimeApi(accountKey, api);
    return api;
}

/* ================================ Public Actions ================================ */

/**
 * findUserUid({ accountKey, phoneOrUid })
 * - Nếu truyền số điện thoại → dùng api.findUser(phone) để lấy thông tin & uid
 * - Nếu đã có uid → có thể gọi api.getUserInfo(uid) (nếu cần chi tiết)
 */
export async function findUserUid({ accountKey, phoneOrUid }) {
    // Không throw — trả lỗi "ok:false" để UI xử lý mượt
    if (!accountKey) return { ok: false, code: 'bad_request', message: 'accountKey is required' };
    if (!phoneOrUid) return { ok: false, code: 'bad_request', message: 'phoneOrUid is required' };

    try {
        const api = await ensureZaloApi(accountKey); // có thể throw nếu cookie hỏng
        const q = String(phoneOrUid).trim();

        // Trường hợp số điện thoại
        if (looksLikePhone(q)) {
            const phone = cleanPhone(q);
            try {
                const info = await api.findUser(phone); // có thể throw nếu không có
                console.log(info);
                
                const u = info || {};
                const uid = u?.userId ?? u?.uid ?? null;
                if (!uid) {
                    return { ok: false, code: 'not_found', message: 'Không tìm thấy tài khoản Zalo cho số điện thoại này.' };
                }
                return {
                    ok: true,
                    uid: String(uid),
                    displayName: u?.displayName || u?.name || '',
                    avatar: u?.avatar || '',
                    phone: u?.phoneNumber || phone,
                    raw: u
                };
            } catch (err) {
                console.log(err);
                
                return mapFindError(err, 'Không tìm thấy tài khoản theo số điện thoại.');
            }
        }

        // Trường hợp UID
        try {
            const u = await api.getUserInfo?.(q).catch(() => null);
            if (!u) {
                return { ok: false, code: 'not_found', message: 'Không tìm thấy người dùng theo UID.' };
            }
            return {
                ok: true,
                uid: String(q),
                displayName: u?.displayName || u?.name || '',
                avatar: u?.avatar || '',
                phone: u?.phoneNumber || '',
                raw: u
            };
        } catch (err) {
            return mapFindError(err, 'Không tìm thấy người dùng theo UID.');
        }
    } catch (err) {
        // Lỗi bước chuẩn bị phiên (cookie hỏng/chưa từng login)
        return { ok: false, code: 'bootstrap_failed', message: err?.message || 'Không thể khởi tạo phiên Zalo.' };
    }
}

/**
 * sendUserMessage({ accountKey, userId, text, attachments? })
 * - Gửi tin nhắn đến 1 người dùng
 * - attachments: mảng đường dẫn file trên server (nếu cần gửi file)
 */
export async function sendUserMessage({ accountKey, userId, text = '', attachments = [] }) {
    if (!accountKey) throw new Error('accountKey is required');
    if (!userId) throw new Error('userId is required');
    const api = await ensureZaloApi(accountKey);

    const payload = { msg: text || '', attachments: Array.isArray(attachments) ? attachments : [] };
    const ack = await api.sendMessage(payload, String(userId));
    return { ok: true, ack };
}

/**
 * changeFriendAlias({ accountKey, userId, alias })
 * - Đổi tên gợi nhớ cho bạn bè
 */
export async function changeFriendAlias({ accountKey, userId, alias }) {
    if (!accountKey) throw new Error('accountKey is required');
    if (!userId) throw new Error('userId is required');
    if (typeof alias !== 'string') throw new Error('alias must be string');

    const api = await ensureZaloApi(accountKey);
    const res = await api.changeFriendAlias(userId, alias);
    return { ok: true, result: res };
}

/**
 * sendGroupMessage({ accountKey, groupId, text, attachments? })
 * - Gửi tin nhắn tới group
 * - Tuỳ bản zca-js: sendMessage tự hiểu theo threadId, hoặc cần đúng groupId
 */
export async function sendGroupMessage({ accountKey, groupId, text = '', attachments = [] }) {
    if (!accountKey) throw new Error('accountKey is required');
    if (!groupId) throw new Error('groupId is required');
    const api = await ensureZaloApi(accountKey);

    const payload = { msg: text || '', attachments: Array.isArray(attachments) ? attachments : [] };
    const ack = await api.sendMessage(payload, String(groupId));
    return { ok: true, ack };
}

/**
 * startMessageListener({ accountKey })
 * - Bật listener & gắn handler đẩy tin vào buffer.
 * - Nếu listener đã bật trước đó, hàm này idempotent.
 */
export async function startMessageListener({ accountKey }) {
    if (!accountKey) throw new Error('accountKey is required');
    const api = await ensureZaloApi(accountKey);

    try {
        // bảo đảm on('message') đã gắn
        api.listener?.on?.('message', (ev) => {
            pushMsg(accountKey, normalizeMessage(ev));
        });
        api.listener?.start?.();
    } catch { /* ignore */ }

    return { ok: true };
}

/**
 * getRecentMessages({ accountKey, limit? })
 * - FE có thể poll định kỳ để lấy tin mới nhất trong buffer
 */
export async function getRecentMessages({ accountKey, limit = 50 }) {
    if (!accountKey) throw new Error('accountKey is required');
    // không bắt buộc ensureZaloApi ở đây (đọc buffer hiện có),
    // nhưng muốn chắc chắn có listener thì bật:
    await startMessageListener({ accountKey }).catch(() => { });
    const list = recentMsgs(accountKey, limit);
    return { ok: true, messages: list };
}

/**
 * stopMessageListener({ accountKey }) — tuỳ chọn
 * - Dừng listener (và bỏ api khỏi registry nếu muốn)
 */
export async function stopMessageListener({ accountKey, remove = false }) {
    if (!accountKey) throw new Error('accountKey is required');
    const api = getRuntimeApi(accountKey);
    if (api?.listener?.stop) api.listener.stop();
    if (remove) removeRuntimeApi(accountKey);
    return { ok: true };
}
