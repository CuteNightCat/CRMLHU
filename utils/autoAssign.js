import mongoose from 'mongoose';
import Customer from '@/models/customer.model';
import Service from '@/models/services.model';
import User from '@/models/users';
import Setting from '@/models/setting.model';
import { revalidateData } from '@/app/actions/customer.actions';

const PRIORITY_ENROLLMENT_ROLES = ['Telesale', 'Care'];
const ENROLLMENT_ROLES = ['Telesale', 'Care', 'Sale', 'Admin Sale'];
const matchesRoleList = (roles, list) =>
    Array.isArray(roles) && roles.some((role) => list.includes(role));

async function pickNextUserByGroup(group) {
    console.log(`[AutoAssign] Looking for users in group: ${group}`);
    // Ưu tiên những nhân sự thuộc nhóm tuyển sinh chính (Telesale/Care)
    let candidates = await User.find({
        group,
        role: { $in: PRIORITY_ENROLLMENT_ROLES }
    }).sort({ _id: 1 }).lean();
    // Nếu không có, fallback sang bất kỳ nhân sự nào có role liên quan tới tuyển sinh
    if (!candidates?.length) {
        candidates = await User.find({
            group,
            role: { $elemMatch: { $regex: /(sale|care)/i } }
        }).sort({ _id: 1 }).lean();
    }
    
    console.log(`[AutoAssign] Found ${candidates.length} candidates (prioritizing enrollment roles):`, candidates.map(c => ({
        id: c._id,
        name: c.name,
        role: c.role,
        group: c.group
    })));
    
    if (!candidates?.length) return null;
    const key = `auto_rr_${group}`;
    const rec = await Setting.findOne({ key });
    const last = rec ? Number(rec.value) : -1;
    const nextIndex = (last + 1) % candidates.length;
    await Setting.updateOne({ key }, { $set: { value: String(nextIndex) } }, { upsert: true });
    const selected = candidates[nextIndex];
    console.log(`[AutoAssign] Selected user at index ${nextIndex}:`, selected ? {
        id: selected._id,
        name: selected.name,
        role: selected.role,
        group: selected.group
    } : 'NONE');
    return selected;
}

async function findAnyEnrollmentStaff() {
    // Tìm bất kỳ nhân sự nào thuộc nhóm tuyển sinh
    let user = await User.findOne({ role: { $in: ENROLLMENT_ROLES } }).sort({ _id: 1 }).lean();
    if (!user) {
        user = await User.findOne({ role: { $elemMatch: { $regex: /(sale|care)/i } } }).sort({ _id: 1 }).lean();
    }
    return user || null;
}

function isValidObjectId(id) {
    try { return mongoose.Types.ObjectId.isValid(id); } catch { return false; }
}

export async function autoAssignForCustomer(customerId, options = {}) {
    // console.log('🚩Đi qua hàm autoAssignForCustomer');
    // console.log(`🚩[DEBUG] CustomerId: ${customerId}`);
    // console.log(`🚩[DEBUG] Options:`, JSON.stringify(options, null, 2));
    // console.log(`[AutoAssign] Starting for customer ${customerId}, options:`, options);
    
    let customer;
    try {
        customer = await Customer.findById(customerId);
        // console.log('🚩[DEBUG] Customer lookup result:', customer ? 'FOUND' : 'NOT FOUND');
    } catch (error) {
        // console.error('🚩[ERROR] Lỗi khi tìm customer:', error?.message || error);
        return { ok: false, reason: 'db_error', error: error?.message };
    }
    
    if (!customer) {
        // console.log(`🚩[SKIP] Customer not found: ${customerId}`);
        return { ok: false, reason: 'not_found' };
    }
    
    console.log('🚩[DEBUG] Customer assignees check:', {
        hasAssignees: !!customer.assignees?.length,
        assigneesCount: customer.assignees?.length || 0,
        assignees: customer.assignees
    });
    
    if (customer.assignees?.length) {
        // console.log(`🚩[SKIP] Customer already has assignees:`, customer.assignees);
        return { ok: false, reason: 'already_assigned' };
    }

    // If static assignment is requested, short-circuit and assign Ngọc Cúc
    if (options?.forceStaticAssign) {
        const staticUser = await User.findOne({ email: 'noikhoa@gmail.com' }).lean();
        if (staticUser) {
            customer.assignees.push({
                user: new mongoose.Types.ObjectId(staticUser._id),
                group: staticUser.group,
                assignedAt: new Date()
            });
            const newStatus = (staticUser.group === 'telesale' || staticUser.group === 'noi_khoa')
                ? 'noikhoa_3'
                : ((staticUser.group === 'care' || staticUser.group === 'ngoai_khoa')
                    ? 'ngoaikhoa_3'
                    : 'undetermined_3');
            customer.pipelineStatus[0] = newStatus;
            customer.pipelineStatus[3] = newStatus;
            customer.care.push({
                content: `Hệ thống tự động gán nhân sự phụ trách ${staticUser.name} (gán tĩnh).`,
                createBy: staticUser._id,
                step: 3,
                createAt: new Date()
            });
            await customer.save();
            try { await revalidateData(); } catch {}
            return { ok: true, user: staticUser, service: null, static: true };
        }
    }

    // Nếu có targetGroup được chỉ định trực tiếp, ưu tiên sử dụng
    if (options?.targetGroup) {
        const targetGroupUser = await pickNextUserByGroup(options.targetGroup);
        if (targetGroupUser) {
            customer.assignees.push({
                user: new mongoose.Types.ObjectId(targetGroupUser._id),
                group: targetGroupUser.group,
                assignedAt: new Date()
            });
            const newStatus = (targetGroupUser.group === 'telesale' || targetGroupUser.group === 'noi_khoa')
                ? 'noikhoa_3'
                : ((targetGroupUser.group === 'care' || targetGroupUser.group === 'ngoai_khoa')
                    ? 'ngoaikhoa_3'
                    : 'undetermined_3');
            customer.pipelineStatus[0] = newStatus;
            customer.pipelineStatus[3] = newStatus;
            customer.care.push({
                content: `Hệ thống tự động gán nhân sự phụ trách ${targetGroupUser.name} (nhóm ${options.targetGroup}).`,
                createBy: targetGroupUser._id,
                step: 3,
                createAt: new Date()
            });
            await customer.save();
            try { await revalidateData(); } catch {}
            return { ok: true, user: targetGroupUser, service: null, targetGroup: options.targetGroup };
        }
    }

    const serviceRef = options.serviceId || customer.tags?.[0];
    // console.log(`🚩[DEBUG] Service reference:`, serviceRef);
    // console.log(`🚩[DEBUG] Options.serviceId:`, options.serviceId);
    // console.log(`🚩[DEBUG] Customer.tags[0]:`, customer.tags?.[0]);
    // console.log(`[AutoAssign] Service reference:`, serviceRef);
    
    if (!serviceRef) {
        // console.log(`🚩[FALLBACK] No service reference found -> try default group / any sale`);
        // Fallback 1: dùng group mặc định trong Setting nếu có
        let defaultGroup = null;
        try {
            const rec = await Setting.findOne({ key: 'defaultAllocationGroup' }).lean();
            defaultGroup = rec?.value || null;
        } catch (_) {}

        let fallbackUser = null;
        if (defaultGroup) {
            fallbackUser = await pickNextUserByGroup(defaultGroup);
        }
        // Fallback 2: nếu chưa có, lấy bất kỳ nhân sự tuyển sinh nào
        if (!fallbackUser) {
            fallbackUser = await findAnyEnrollmentStaff();
        }
        if (!fallbackUser) {
            console.log(`[AutoAssign] No enrollment staff found in system`);
            return { ok: false, reason: 'no_mapping' };
        }

        customer.assignees.push({
            user: new mongoose.Types.ObjectId(fallbackUser._id),
            group: fallbackUser.group,
            assignedAt: new Date()
        });
        const fbStatus = (fallbackUser.group === 'telesale' || fallbackUser.group === 'noi_khoa')
            ? 'noikhoa_3'
            : ((fallbackUser.group === 'care' || fallbackUser.group === 'ngoai_khoa')
                ? 'ngoaikhoa_3'
                : 'undetermined_3');
        customer.pipelineStatus[0] = fbStatus;
        customer.pipelineStatus[3] = fbStatus;
        customer.care.push({
            content: `Hệ thống tự động gán nhân sự phụ trách (fallback): ${fallbackUser.name}.`,
            createBy: fallbackUser._id,
            step: 3,
            createAt: new Date()
        });
        await customer.save();
        try { await revalidateData(); } catch {}
        return { ok: true, user: fallbackUser, service: null, fallback: true };
    }

    let service = null;
    if (isValidObjectId(serviceRef)) {
        service = await Service.findById(serviceRef).lean();
    } else {
        // Thử tìm theo slug hoặc name nếu không phải ObjectId
        service = await Service.findOne({ $or: [ { slug: String(serviceRef) }, { name: String(serviceRef) } ] }).lean();
    }
    console.log(`[AutoAssign] Service found:`, service ? {
        id: service._id,
        name: service.name,
        type: service.type,
        saleGroup: service.saleGroup,
        defaultSale: service.defaultSale
    } : 'NOT FOUND');
    
    if (!service) return { ok: false, reason: 'service_not_found' };

    const targetGroup = service.saleGroup || service.type || null; // fallback to type
    console.log(`[AutoAssign] Target group:`, targetGroup);
    
    let assignedUser = null;
    // Ưu tiên 1: Nếu có defaultSale, kiểm tra xem có thuộc nhóm tuyển sinh và cùng group không
    if (service.defaultSale) {
        const defaultSaleUser = await User.findById(service.defaultSale).lean();
        console.log(`[AutoAssign] Default enrollment staff found:`, defaultSaleUser ? {
            id: defaultSaleUser._id,
            name: defaultSaleUser.name,
            role: defaultSaleUser.role,
            group: defaultSaleUser.group,
            targetGroup: targetGroup
        } : 'NOT FOUND');
        
        if (defaultSaleUser) {
            const hasPriorityRole = matchesRoleList(defaultSaleUser.role, PRIORITY_ENROLLMENT_ROLES);
            const hasEnrollmentRole = hasPriorityRole || matchesRoleList(defaultSaleUser.role, ENROLLMENT_ROLES);

            // Kiểm tra group có khớp với targetGroup không
            const hasMatchingGroup = targetGroup && defaultSaleUser.group === targetGroup;

            if (hasEnrollmentRole && hasMatchingGroup) {
                assignedUser = defaultSaleUser;
                console.log(`[AutoAssign] ✅ Default staff hợp lệ: role tuyển sinh và cùng group "${targetGroup}"`);
            } else {
                console.log(`[AutoAssign] ⚠️ Default staff không phù hợp:`, {
                    hasEnrollmentRole,
                    hasPriorityRole,
                    hasMatchingGroup,
                    userGroup: defaultSaleUser.group,
                    targetGroup
                });
                console.log(`[AutoAssign] → Sẽ dùng round-robin theo group "${targetGroup}"`);
            }
        }
    }
    
    // Ưu tiên 2: Nếu không có defaultSale hợp lệ, dùng round-robin theo group
    if (!assignedUser && targetGroup) {
        assignedUser = await pickNextUserByGroup(targetGroup);
        console.log(`[AutoAssign] Round-robin user found:`, assignedUser ? {
            id: assignedUser._id,
            name: assignedUser.name,
            role: assignedUser.role,
            group: assignedUser.group
        } : 'NOT FOUND');
    }
    if (!assignedUser) {
        console.log(`[AutoAssign] No user found for assignment`);
        return { ok: false, reason: 'no_mapping' };
    }

    customer.assignees.push({
        user: new mongoose.Types.ObjectId(assignedUser._id),
        group: assignedUser.group,
        assignedAt: new Date()
    });

    const newStatus = (assignedUser.group === 'telesale' || assignedUser.group === 'noi_khoa')
        ? 'noikhoa_3'
        : ((assignedUser.group === 'care' || assignedUser.group === 'ngoai_khoa')
            ? 'ngoaikhoa_3'
            : 'undetermined_3');
    customer.pipelineStatus[0] = newStatus;
    customer.pipelineStatus[3] = newStatus;

    customer.care.push({
        content: `Hệ thống tự động gán nhân sự phụ trách ${assignedUser.name} theo ngành học ${service.name}.`,
        createBy: assignedUser._id,
        step: 3,
        createAt: new Date()
    });

    // Đồng bộ lại tags nếu người gọi truyền slug/name
    try {
        if (service && (!customer.tags?.length || String(customer.tags[0]) !== String(service._id))) {
            customer.tags = [service._id];
        }
    } catch (_) {}

    await customer.save();
    try { await revalidateData(); } catch (e) { /* ignore */ }
    
    console.log(`[AutoAssign] Successfully assigned ${assignedUser.name} to customer ${customerId}`);
    return { ok: true, user: assignedUser, service };
}

export default autoAssignForCustomer;


