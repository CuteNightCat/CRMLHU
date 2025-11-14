import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const SHEET_ID = '1ZQsHUyVD3vmafcm6_egWup9ErXfxIg4U-TfVDgDztb8';
const SHEET_NAME = 'Data';

/* ───────── Google Sheets client ───────── */
function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        projectId: process.env.GOOGLE_PROJECT_ID,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

/* ───────── helpers ───────── */
const normalize = s => s.toString().trim().toLowerCase();
const stdPhone = p => {
    p = p.toString().trim();
    if (p[0] === '0') p = '84' + p.slice(1);
    if (!p.startsWith('84')) p = '84' + p;
    return p;
};
const parseArray = raw => {
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; }
    catch { return []; }
};

/* ───────── main ───────── */
export async function POST(req) {
    /* body */
    let body;
    try { body = await req.json(); }
    catch { return NextResponse.json({ status: 1, mes: '', data: [] }); }

    const { phone, mes, labels } = body;
    if (!phone || typeof mes !== 'string')
        return NextResponse.json({ status: 1, mes, data: [] });

    /* sheets client */
    let sheets;
    try { sheets = getSheetsClient(); }
    catch { return NextResponse.json({ status: 0, mes, data: [] }); }

    /* ── lấy trước dữ liệu A:M để biết UID, label, row ── */
    const { data: { values = [] } } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:M`,
        fields: 'values',
    });

    const targetPhone = stdPhone(phone);
    let rowIdx = null;           // 1-based, null nếu chưa có
    let rawLabel = '';
    let rawUid = '';

    values.forEach((row, i) => {
        const ph = row[1];
        if (ph && stdPhone(ph) === targetPhone) {
            rowIdx = i + 1;
            rawLabel = row[11] || '';   
            rawUid = row[12] || '';   
        }
    });

    const result = { phone, status: 'failed' };
    try {
        const url = new URL('https://script.google.com/macros/s/AKfycbx17JMuK_X-OhUAjin3IlDTAvhBgOOocoWMrTqT7q7_lWNq0eES-GHLwD4MKMIQ43p9eg/exec');
        
        if (rawUid) url.searchParams.set('uid', rawUid);
        else url.searchParams.set('phone', phone);
        url.searchParams.set('mes', mes);
       
        
        const r = await fetch(url.toString());
        const json = await r.json();

        if (json.status === 2) {
            result.status = 'success';
            if (json.data?.uid) result.uid = json.data.uid;
            if (json.data?.name) result.name = json.data.name;
            else result.mes = mes;
        } else {
            result.error = json.mes;
        }
    } catch (e) { result.error = e.message; }
    const updates = [];
    const addLabels = Array.isArray(labels)
        ? labels.map(String).map(s => s.trim()).filter(Boolean)
        : [];

    if (rowIdx && addLabels.length) {
        const existed = parseArray(rawLabel);
        const merged = [...new Map([...existed, ...addLabels]
            .map(lb => [normalize(lb), lb])).values()];

        if (JSON.stringify(existed) !== JSON.stringify(merged)) {
            updates.push({
                range: `${SHEET_NAME}!L${rowIdx}`,
                values: [[JSON.stringify(merged)]]
            });
        }
    }

    if (rowIdx && !rawUid && result.uid) {
        updates.push({
            range: `${SHEET_NAME}!M${rowIdx}`,
            values: [[`[${result.uid},${result.name}]`]]
        });
    }

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: updates }
        });
    }
    
    return NextResponse.json({
        status: result.status === 'success' ? 2 : 1,
        mes,
        data: [result]
    });
}
