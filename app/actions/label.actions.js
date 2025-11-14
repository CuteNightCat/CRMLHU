'use server';

import dbConnect from "@/config/connectDB";
import Label from "@/models/label";
import checkAuthToken from "@/utils/checktoken";
import { reloadLabel } from '@/data/actions/reload';

export async function createLabelAction(_previousState, formData) {
    await dbConnect();
    const title = formData.get('title');
    const desc = formData.get('desc');
    const content = formData.get('content'); 

    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }

    if (!title) return { message: 'Tên nhãn là bắt buộc.', status: false };
    if (title.length > 50) return { message: 'Tên nhãn phải ít hơn 50 kí tự.', status: false };
    if (desc && desc.length > 1000) return { message: 'Mô tả phải ít hơn 1000 kí tự.', status: false };

    try {
        const existingLabel = await Label.findOne({ title: title.toString().trim() });
        if (existingLabel) {
            return { message: 'Lỗi: Tên nhãn này đã tồn tại.', status: false };
        }

        const newLabel = new Label({
            title: title.toString().trim(),
            desc: desc?.toString().trim(),
            content: content?.toString().trim() // <-- Thêm 'content' vào object mới
        });

        await newLabel.save();
        reloadLabel();
        return { message: `Đã tạo thành công nhãn "${title}".`, status: true };
    } catch (error) {
        console.error("Lỗi tạo nhãn:", error);
        return { message: 'Lỗi hệ thống, không thể tạo nhãn.', status: false };
    }
}

/**
 * Updates an existing label including content.
 */
export async function updateLabelAction(_previousState, formData) {
    const id = formData.get('id');
    const title = formData.get('title');

    const desc = formData.get('desc');
    const content = formData.get('content'); // <-- Lấy dữ liệu 'content'

    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }

    if (!id || !title) return { message: 'Dữ liệu không hợp lệ (thiếu ID hoặc tên nhãn).', status: false };
    if (title.length > 50) return { message: 'Tên nhãn phải ít hơn 50 kí tự.', status: false };

    try {
        await dbConnect();
        const existingLabel = await Label.findOne({ title: title.toString().trim(), _id: { $ne: id } });
        if (existingLabel) {
            return { message: 'Lỗi: Tên nhãn này đã được sử dụng.', status: false };
        }

        const updatedLabel = await Label.findByIdAndUpdate(
            id,
            {
                title: title.toString().trim(),
                desc: desc?.toString().trim(),
                content: content?.toString().trim() // <-- Thêm 'content' vào object cập nhật
            },
            { new: true }
        );

        if (!updatedLabel) return { message: 'Không tìm thấy nhãn để cập nhật.', status: false };
        reloadLabel();
        return { message: `Đã cập nhật thành công nhãn "${title}".`, status: true };
    } catch (error) {
        console.error("Lỗi cập nhật nhãn:", error);
        return { message: 'Lỗi hệ thống, không thể cập nhật nhãn.', status: false };
    }
}

// Hàm deleteLabelAction không thay đổi
export async function deleteLabelAction(_previousState, formData) {
    const id = formData.get('id');
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập để thực hiện hành động này.', status: false };
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        return { message: 'Bạn không có quyền thực hiện chức năng này', status: false };
    }

    try {
        await dbConnect();
        const labelToDelete = await Label.findById(id);
        if (!labelToDelete) { return { status: false, message: 'Không tìm thấy nhãn để xóa.' }; }
        await Label.findByIdAndDelete(id);
        reloadLabel();
        return { status: true, message: 'Xóa nhãn thành công!' };
    } catch (error) {
        console.error('Lỗi khi xóa nhãn:', error);
        return { status: false, message: 'Đã xảy ra lỗi. Không thể xóa nhãn.' };
    }
}