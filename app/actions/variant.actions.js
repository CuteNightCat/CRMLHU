'use server';
import dbConnect from "@/config/connectDB";
import Variant from "@/models/variant.model";
import checkAuthToken from "@/utils/checktoken";
import { unstable_cache as nextCache, revalidateTag } from 'next/cache';

export async function variant_data() {
    const cachedData = nextCache(
        async () => {
            await dbConnect();
            const variants = await Variant.find({}).sort({ createdAt: -1 }).lean();
            return JSON.parse(JSON.stringify(variants));
        },
        ['variants-data'],
        { tags: ['variants'] }
    );
    return cachedData();
}

export async function createVariantAction(_previousState, formData) {
    await dbConnect();
    const name = formData.get('name');
    const description = formData.get('description');
    const phrasesStr = formData.get('phrases');
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập.', status: false };
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        return { message: 'Bạn không có quyền thực hiện chức năng này.', status: false };
    }
    if (!name) return { message: 'Tên biến thể là bắt buộc.', status: false };
    try {
        const existingVariant = await Variant.findOne({ name: name.toString().trim() });
        if (existingVariant) {
            return { message: 'Lỗi: Tên biến thể này đã tồn tại.', status: false };
        }
        const phrases = phrasesStr ? phrasesStr.toString().split('\n').map(p => p.trim()).filter(Boolean) : [];
        const newVariant = new Variant({
            name: name.toString().trim(),
            description: description?.toString().trim(),
            phrases: phrases
        });
        await newVariant.save();
        revalidateTag('variants');
        return { message: `Đã tạo thành công biến thể "${name}".`, status: true };
    } catch (error) {
        return { message: 'Lỗi hệ thống, không thể tạo biến thể.', status: false };
    }
}
export async function updateVariantAction(_previousState, formData) {
    const id = formData.get('id');
    const name = formData.get('name');
    const description = formData.get('description');
    const phrasesStr = formData.get('phrases');
    const user = await checkAuthToken();
    if (!user || !user.id) return { message: 'Bạn cần đăng nhập.', status: false };
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        return { message: 'Bạn không có quyền thực hiện chức năng này.', status: false };
    }
    if (!id || !name) return { message: 'Dữ liệu không hợp lệ.', status: false };
    try {
        await dbConnect();
        const existingVariant = await Variant.findOne({ name: name.toString().trim(), _id: { $ne: id } });
        if (existingVariant) {
            return { message: 'Lỗi: Tên biến thể này đã được sử dụng.', status: false };
        }
        const phrases = phrasesStr ? phrasesStr.toString().split('\n').map(p => p.trim()).filter(Boolean) : [];
        const updatedVariant = await Variant.findByIdAndUpdate(id, {
            name: name.toString().trim(),
            description: description?.toString().trim(),
            phrases: phrases
        }, { new: true });
        if (!updatedVariant) return { message: 'Không tìm thấy biến thể để cập nhật.', status: false };
        revalidateTag('variants');
        return { message: `Đã cập nhật thành công biến thể "${name}".`, status: true };
    } catch (error) {
        return { message: 'Lỗi hệ thống, không thể cập nhật.', status: false };
    }
}