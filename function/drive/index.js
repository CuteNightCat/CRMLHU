// function/drive/index.ts (or .js)
import { google } from 'googleapis';

export const runtime = 'nodejs'; // ⬅️ đảm bảo không chạy Edge

export default async function getDriveClient() {
    const email =
        process.env.GOOGLE_CLIENT_EMAIL ||
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    let key = process.env.GOOGLE_PRIVATE_KEY || '';

    if (!email || !key) {
        throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');
    }

    // 1) \n -> newline
    key = key.replace(/\\n/g, '\n');

    // 2) bỏ nháy bao ngoài nếu có
    key = key.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');

    // 3) cắt khoảng trắng thừa
    key = key.trim();

    // Tuỳ chọn: kiểm tra header/footer
    if (!key.startsWith('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('Invalid private key (missing BEGIN header)');
    }

    const auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    // sẽ throw ngay nếu key sai
    await auth.authorize();

    return google.drive({ version: 'v3', auth });
}
