'use server';

import { unstable_cache as cache, revalidateTag } from 'next/cache';
import dbConnect from '@/config/connectDB';
import Label from '@/models/label.model'; // Đảm bảo đường dẫn này chính xác

/**
 * Lấy tất cả các nhãn từ database.
 * Dữ liệu được cache lại để tăng hiệu suất.
 * Cache sẽ được làm mới (revalidate) sau 1 giờ (3600s) hoặc khi có tag 'labels' được revalidate.
 */
export const getLabelData = cache(
    async () => {
        try {
            await dbConnect();
            const allLabels = await Label.find({}).sort({ createdAt: 'desc' });
            // Dùng JSON.parse(JSON.stringify(...)) để đảm bảo dữ liệu an toàn khi gửi tới client component.
            return JSON.parse(JSON.stringify(allLabels));
        } catch (error) {
            console.error("Lỗi khi lấy dữ liệu nhãn:", error);
            return [];
        }
    },
    ['getLabelData'], // Key cho cache
    {
        revalidate: 3600, // Cache trong 1 giờ
        tags: ['labels'], // Tag để có thể revalidate theo yêu cầu
    }
);

/**
 * Tạo một nhãn mới.
 */
export async function createLabel(formData) {
    const name = formData.get('name');
    const color = formData.get('color');

    if (!name || !color) {
        return { success: false, error: 'Tên và màu của nhãn là bắt buộc.' };
    }

    try {
        await dbConnect();

        const existingLabel = await Label.findOne({ name });
        if (existingLabel) {
            return { success: false, error: 'Tên nhãn đã tồn tại.' };
        }

        const newLabel = new Label({ name, color });
        await newLabel.save();

        // Xóa cache có tag 'labels' để hàm getLabelData lấy lại dữ liệu mới
        revalidateTag('labels');

        return { success: true, label: JSON.parse(JSON.stringify(newLabel)) };
    } catch (error) {
        return { success: false, error: 'Không thể tạo nhãn.' };
    }
}

/**
 * Cập nhật một nhãn đã có.
 */
export async function updateLabel(formData) {
    const id = formData.get('id');
    const name = formData.get('name');
    const color = formData.get('color');

    try {
        await dbConnect();

        const updatedLabel = await Label.findByIdAndUpdate(
            id,
            { name, color },
            { new: true, runValidators: true }
        );

        if (!updatedLabel) {
            return { success: false, error: 'Không tìm thấy nhãn.' };
        }

        revalidateTag('labels');

        return { success: true, label: JSON.parse(JSON.stringify(updatedLabel)) };
    } catch (error) {
        if (error.code === 11000) {
            return { success: false, error: 'Tên nhãn đã tồn tại.' };
        }
        return { success: false, error: 'Không thể cập nhật nhãn.' };
    }
}

/**
 * Xóa một nhãn.
 */
export async function deleteLabel(id) {
    try {
        await dbConnect();
        await Label.findByIdAndDelete(id);
        revalidateTag('labels');
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Không thể xóa nhãn.' };
    }
}

/**
 * Gán hoặc bỏ gán một nhãn cho một khách hàng (dựa trên PSID).
 */
export async function toggleLabelForCustomer({ labelId, psid }) {
    if (!labelId || !psid) {
        return { success: false, error: 'Thiếu thông tin nhãn hoặc khách hàng.' };
    }

    try {
        await dbConnect();
        const label = await Label.findById(labelId);

        if (!label) {
            return { success: false, error: 'Không tìm thấy nhãn.' };
        }

        const customerExists = label.customer.includes(psid);
        let updateOperation;

        if (customerExists) {
            // Nếu khách hàng đã có trong nhãn -> Bỏ gán (xóa psid khỏi mảng)
            updateOperation = { $pull: { customer: psid } };
        } else {
            // Nếu khách hàng chưa có trong nhãn -> Gán (thêm psid vào mảng)
            updateOperation = { $addToSet: { customer: psid } };
        }

        await Label.updateOne({ _id: labelId }, updateOperation);
        revalidateTag('labels');

        return { success: true, message: `Đã ${customerExists ? 'bỏ gán' : 'gán'} nhãn.` };
    } catch (error) {
        console.error('Lỗi khi cập nhật nhãn cho khách hàng:', error);
        return { success: false, error: 'Không thể cập nhật nhãn.' };
    }
}