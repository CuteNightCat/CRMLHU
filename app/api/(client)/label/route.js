import { NextResponse } from 'next/server';
import dbConnect from '@/config/connectDB';
import Label from '@/models/label';

/* ------------------------------------------------------------------ */
/* ---------------------------  POST  --------------------------------*/
/* ------------------------------------------------------------------ */
export async function POST(req) {
    try {
        await dbConnect();

        const { title, content, desc = '' } = await req.json();

        /* ----- kiểm tra đầu vào ----- */
        if (!title || !content) {
            return NextResponse.json(
                {
                    status: 1,              // lỗi kiểm tra
                    data: [],
                    mes: 'Thiếu tiêu đề hoặc nội dung!',
                },
                { status: 200 },
            );
        }

        /* ----- kiểm tra trùng title (trim + phân biệt hoa thường) ----- */
        const existed = await Label.findOne({ title: title.trim() }).lean();
        if (existed) {
            return NextResponse.json(
                {
                    status: 1,
                    data: [],
                    mes: 'Tiêu đề đã tồn tại!',
                },
                { status: 200 },
            );
        }

        /* ----- ghi DB ----- */
        const newLabel = await Label.create({
            title: title.trim(),
            content: content.trim(),
            desc: desc.trim()
        });

        return NextResponse.json(
            {
                status: 2,          // thành công
                data: newLabel,
                mes: 'Tạo nhãn thành công!',
            },
            { status: 201 },
        );
    } catch (err) {
        console.error('[LABEL_CREATE]', err);
        return NextResponse.json(
            {
                status: 1,
                data: [],
                mes: 'Server error',
            },
            { status: 500 },
        );
    }
}

/* ------------------------------------------------------------------ */
/* ----------------------------  GET  --------------------------------*/
/* ------------------------------------------------------------------ */
export async function GET() {
    try {
        await dbConnect();

        const labels = await Label.find().sort({ at: -1 }).lean();

        return NextResponse.json(
            {
                status: 2,
                data: labels,
                mes: '',
            },
            { status: 200 },
        );
    } catch (err) {
        console.error('[LABEL_GET]', err);
        return NextResponse.json(
            {
                status: 1,
                data: [],
                mes: 'Server error',
            },
            { status: 500 },
        );
    }
}
