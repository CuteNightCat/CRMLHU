// data/zalo/actions.js
'use server';

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * ZALO SESSION ACTIONS — Service (Server Actions) dùng model + zca-js
 *
 * - QR login: new Zalo().loginQR({ qrPath, userAgent? })  → lib tự ghi ảnh QR
 * - Cookie login: new Zalo().login({ cookie, imei, userAgent })
 * - Lưu session (cookies JSON + imei + userAgent) vào Mongo để tái đăng nhập
 * - Runtime Map giữ API đã đăng nhập (per-process)
 * - Hỗ trợ merge theo phone nếu có (tránh nhân bản khi đăng nhập trùng số)
 * - Cung cấp 2 cách hiển thị QR: public URL + cache busting, hoặc dataURL
 * ──────────────────────────────────────────────────────────────────────────────
 */

import 'server-only';

// Node built-ins
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import crypto from 'node:crypto';

// React cache (cho danh sách)
import { cache } from 'react';

// zca-js (đúng theo docs)
import { Zalo as ZCA } from 'zca-js';

// DB / Model
import { ZaloAccount } from '@/models/zalo-account.model';
import connectMongo from '@/config/connectDB';


/* ================================ Runtime (per-process) ================================ */

// accountKey -> { api, startedAt }
const runtime = new Map();

// loginId -> { status: 'waiting'|'success'|'failed', qrPath, accountKey?, error?, createdAt, lastServedAt }
const qrSessions = new Map();

/** Lưu api đang chạy vào RAM */
function setRuntimeApi(accountKey, api) {
    runtime.set(accountKey, { api, startedAt: Date.now() });
}

/** Lấy api runtime (nếu có) */
function getRuntimeApi(accountKey) {
    const item = runtime.get(accountKey);
    return item?.api || null;
}

/** Xoá api runtime */
function removeRuntimeApi(accountKey) {
    runtime.delete(accountKey);
}

/* ================================ Helpers ================================ */

/** Đảm bảo connect Mongo */
async function ensureMongo() {
    await connectMongo();
}

/** Sinh id ngẫu nhiên cho phiên QR */
function newId() {
    return crypto.randomUUID().replace(/-/g, '');
}

/** Tạo thư mục chứa ảnh QR trong /public (dev/prod máy chủ tự host) */
function ensureQrDir() {
    const dir = path.join(process.cwd(), 'public', '_zalo_qr');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

/** Lấy cookie JSON an toàn (ưu tiên CookieJar.toJSON) để lưu vào Mongo */
async function extractCookieJSON(api) {
    try {
        const jar = await api.getCookie(); // CookieJar hoặc object
        if (jar && typeof jar.toJSON === 'function') return jar.toJSON();
        return jar || null;
    } catch {
        return null;
    }
}

/** Chuẩn hoá profile từ fetchAccountInfo() */
function normalizeProfile(ownId, info) {
    const phone = info?.phoneNumber ? String(info.phoneNumber) : '';
    return {
        zaloId: String(ownId),
        displayName: info?.displayName || String(ownId),
        avatar: info?.avatar || '',
        phoneMasked: phone
            ? phone.replace(
                /^(\+?\d{0,3})?(\d{3})(\d{3})(\d{0,3})$/,
                (_, $cc, a, b, c) => `${$cc || ''}${a}***${c ? '***' + c : '***'}`
            )
            : '',
        // nếu không muốn lưu số thật → đổi sang phoneHash trước khi set
        phone: phone || ''
    };
}

/**
 * (Tuỳ chọn) Merge doc theo phone:
 * - Nếu đã tồn tại doc có profile.phone = phone → ghi đè doc đó bằng ownId mới
 * - Trả về _id doc đã merge, hoặc null nếu không merge
 */
async function mergeAccountByPhoneIfNeeded({ phone, ownId, profile, device, cookies }) {
    if (!phone) return null;
    await ensureMongo();

    const existed = await ZaloAccount.findOne({ 'profile.phone': phone }).lean();
    if (!existed) return null;
    if (existed.accountKey === ownId) return existed._id;

    await ZaloAccount.updateOne(
        { _id: existed._id },
        {
            $set: {
                accountKey: ownId,
                profile,
                device,
                session: {
                    cookies,
                    lastActiveAt: new Date(),
                    lastLoginAt: new Date(),
                    lastLoginMethod: 'qr',
                    sessionVersion: 1,
                },
                status: 'active',
            },
        }
    );

    // giữ unique theo accountKey
    await ZaloAccount.deleteMany({ accountKey: ownId, _id: { $ne: existed._id } });
    return existed._id;
}

/* ================================ Public Actions ================================ */

/**
 * listZaloAccounts()
 * - Lấy danh sách tài khoản (ẩn cookies)
 * - Dùng cache() để giảm query
 */
export const listZaloAccounts = cache(async function listZaloAccounts() {
    await ensureMongo();
    const docs = await ZaloAccount.find({}, { 'session.cookies': 0 })
        .sort({ updatedAt: -1 })
        .lean();
    return docs;
});

/**
 * getZaloAccount(accountKey)
 * - Lấy 1 tài khoản (ẩn cookies)
 */
export async function getZaloAccount(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();
    const doc = await ZaloAccount.findOne({ accountKey }, { 'session.cookies': 0 }).lean();
    if (!doc) throw new Error('Zalo account not found');
    return doc;
}

/**
 * upsertFromQrLogin(payload)
 * - Dùng khi bạn đang có api đã login sẵn ở chỗ khác và chỉ muốn upsert DB
 */
export async function upsertFromQrLogin(payload) {
    await ensureMongo();
    const doc = await ZaloAccount.upsertFromLoginResult({
        ...payload,
        loginMethod: 'qr',
    });
    return {
        ok: true,
        accountKey: doc.accountKey,
        status: doc.status,
        updatedAt: doc.updatedAt,
    };
}

/**
 * attemptCookieLogin(accountKey)
 * - Đăng nhập lại bằng cookie JSON từ DB
 * - Thành công: bật listener + set runtime
 */
export async function attemptCookieLogin(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();

    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');

    const can =
        acc.status !== 'blocked' &&
        !!acc?.session?.cookies &&         // cookie JSON
        !!acc?.device?.imei &&
        !!acc?.device?.userAgent;

    if (!can) {
        return { ok: false, message: 'Account cannot login by cookies. Missing session/device or status blocked.' };
    }

    if (acc.ops.isLockedForLogin) {
        return { ok: false, message: 'Login is locked by another process.' };
    }

    try {
        await acc.lockForLogin('attemptCookieLogin');

        // đã có runtime → chỉ đánh dấu active
        const already = getRuntimeApi(accountKey);
        if (already) {
            await acc.markActive();
            await acc.unlockForLogin();
            return { ok: true, message: 'Already logged in (runtime).', accountKey };
        }

        // cookie login đúng chữ ký docs (cookie JSON)
        const zalo = new ZCA();
        const api = await zalo.login({
            cookie: acc.session.cookies,
            imei: acc.device.imei,
            userAgent: acc.device.userAgent,
        });

        if (api?.listener?.start) api.listener.start();

        await acc.updateSession({ cookies: acc.session.cookies, loginMethod: 'cookie' });
        await acc.markActive();

        setRuntimeApi(accountKey, api);

        await acc.unlockForLogin();
        return { ok: true, message: 'Cookie login success.', accountKey };
    } catch (err) {
        await acc.markDisconnected(err?.message || 'cookie login failed');
        await acc.unlockForLogin();
        removeRuntimeApi(accountKey);
        return { ok: false, message: `Cookie login failed: ${err?.message || 'unknown error'}` };
    }
}

/**
 * markDisconnected(accountKey, reason?)
 * - Đánh dấu mất phiên & xoá runtime api
 */
export async function markDisconnected(accountKey, reason = '') {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();
    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');
    await acc.markDisconnected(reason);
    removeRuntimeApi(accountKey);
    return { ok: true, message: 'Marked disconnected.' };
}

/** lockForLogin(accountKey, by?) — Khoá login cạnh tranh thủ công */
export async function lockForLogin(accountKey, by = 'manual') {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();
    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');
    await acc.lockForLogin(by);
    return { ok: true };
}

/** unlockForLogin(accountKey) — Mở khoá login */
export async function unlockForLogin(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();
    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');
    await acc.unlockForLogin();
    return { ok: true };
}

/**
 * touchActive(accountKey)
 * - Cập nhật lastActiveAt (khi có keep-alive/tác vụ liên quan)
 */
export async function touchActive(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');
    await ensureMongo();
    const acc = await ZaloAccount.findOne({ accountKey });
    if (!acc) throw new Error('Zalo account not found');

    acc.session.lastActiveAt = new Date();
    await acc.save();
    return { ok: true, lastActiveAt: acc.session.lastActiveAt };
}

/**
 * stopRuntimeListener(accountKey)
 * - Dừng listener (RAM) — không đổi trạng thái DB
 */
export async function stopRuntimeListener(accountKey) {
    if (!accountKey) throw new Error('accountKey is required');
    const api = getRuntimeApi(accountKey);
    if (api?.listener?.stop) api.listener.stop();
    removeRuntimeApi(accountKey);
    return { ok: true, message: 'Runtime listener stopped.' };
}

/**
 * tryAutoStartFirstReconnectable()
 * - Thử tự động cookie-login account đầu tiên có thể kết nối lại
 */
export async function tryAutoStartFirstReconnectable() {
    await ensureMongo();
    const docs = await ZaloAccount.findActiveOrReconnectable();
    for (const acc of docs) {
        try {
            const r = await attemptCookieLogin(acc.accountKey);
            if (r.ok) return r;
        } catch {
            // ignore
        }
    }
    return { ok: false, message: 'No reconnectable account found or all cookie logins failed.' };
}

/* ================================ QR LOGIN (NO API ROUTE) ================================ */

/**
 * startQrLogin({ userAgent? })
 * - Tạo phiên QR:
 *   · loginId + qrPath (/public/_zalo_qr/{loginId}.png)
 *   · gọi zalo.loginQR({ qrPath, userAgent }) — QR được ghi file
 *   · trả sớm { loginId, qrPublicUrl }
 * - Nền: khi quét xong -> lấy cookie/context/profile -> upsert DB (merge phone nếu có)
 * - Bật listener và lưu runtime
 */
export async function startQrLogin({ userAgent = '' } = {}) {
    await ensureMongo();

    const loginId = newId();
    const dir = ensureQrDir();
    const qrPath = path.join(dir, `${loginId}.png`);
    const qrPublicUrl = `/_zalo_qr/${loginId}.png`;

    qrSessions.set(loginId, { status: 'waiting', qrPath, createdAt: Date.now(), lastServedAt: 0 });

    // chạy nền: chờ user quét
    (async () => {
        try {
            const zalo = new ZCA({ selfListen: false, checkUpdate: true, logging: true });
            const api = await zalo.loginQR({ userAgent, qrPath }); // lib tự ghi ảnh QR

            // -> đăng nhập thành công, lấy data chuẩn
            const cookieJSON = await extractCookieJSON(api);  // cookie JSON để lưu & cookie-login sau này
            const ownId = String(await api.getOwnId());       // định danh tài khoản
            const ctx = api.getContext();                     // chứa imei, userAgent, uid, ...
            const info = await api.fetchAccountInfo().catch(() => null);

            const imei = ctx?.imei || 'unknown_imei';
            const ua = ctx?.userAgent || userAgent || 'Mozilla/5.0';
            const profile = normalizeProfile(ownId, info);
            const device = { imei, userAgent: ua, deviceName: 'bot-web' };

            // Merge theo phone nếu có, không thì upsert theo ownId
            const mergedId = await mergeAccountByPhoneIfNeeded({
                phone: profile.phone,
                ownId,
                profile,
                device,
                cookies: cookieJSON,
            });

            if (!mergedId) {
                await ZaloAccount.upsertFromLoginResult({
                    accountKey: ownId,
                    profile,
                    device,
                    cookies: cookieJSON,
                    loginMethod: 'qr',
                });
            }

            // start listener + set runtime
            if (api?.listener?.start) api.listener.start();
            setRuntimeApi(ownId, api);

            qrSessions.set(loginId, { status: 'success', qrPath, accountKey: ownId });
        } catch (err) {
            qrSessions.set(loginId, { status: 'failed', qrPath, error: err?.message || 'QR login failed' });
        }
    })();

    // trả sớm cho UI
    return { ok: true, loginId, qrPublicUrl };
}

/**
 * getQrStatus(loginId)
 * - FE poll 1–2s/lần để biết: waiting | success | failed
 * - Khi success → FE gọi router.refresh() để cập nhật danh sách tài khoản
 */
export async function getQrStatus(loginId) {
    const s = qrSessions.get(loginId);
    if (!s) return { ok: false, status: 'not_found' };
    return {
        ok: true,
        status: s.status,
        accountKey: s.accountKey || null,
        error: s.error || null,
    };
}

/**
 * getQrDataUrl(loginId)
 * - Trả ảnh QR dạng dataURL (base64) để tránh vấn đề cache/public serving
 * - FE có thể poll mỗi ~1s cho đến khi có ảnh
 * - Gợi ý: cứ 10s gọi lại để “refresh” UI (cache-bust), QR mới (nếu lib đã xoay) sẽ hiện
 */
export async function getQrDataUrl(loginId) {
    const s = qrSessions.get(loginId);
    if (!s?.qrPath) return { ok: false, dataUrl: null, ts: 0 };
    try {
        const buf = await fs.readFile(s.qrPath);
        const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        return { ok: true, dataUrl, ts: Date.now() };
    } catch {
        return { ok: false, dataUrl: null, ts: 0 };
    }
}

/**
 * pollQrLogin(loginId)
 * - Alias tương thích UI cũ (equivalent getQrStatus)
 */
export async function pollQrLogin(loginId) {
    const s = qrSessions.get(loginId);
    if (!s) return { status: 'failed', message: 'session not found' };
    return { status: s.status, message: s.error || null };
}
