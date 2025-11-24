import mongoose from 'mongoose';
import Customer from '@/models/customer.model';
import Service from '@/models/services.model';
import User from '@/models/users';
import Setting from '@/models/setting.model';
import { revalidateData } from '@/app/actions/customer.actions';

const PRIORITY_ENROLLMENT_ROLES = ['Telesale', 'Care'];
const SALE_ROLE = 'Sale'; // Chỉ gán nhân viên có role chính xác là 'Sale'
const ENROLLMENT_ROLES = ['Telesale', 'Care', 'Sale', 'Admin Sale'];
const matchesRoleList = (roles, list) =>
    Array.isArray(roles) && roles.some((role) => list.includes(role));

async function pickNextUserByGroup(group) {
    console.log(`[AutoAssign] Looking for users in group: ${group}`);
    
    // Mapping group: 'telesale'/'care' (giá trị trong service) → 'telesale_TuVan'/'CareService' (giá trị trong database)
    // Hỗ trợ cả giá trị cũ và mới
    let targetGroups = [group];
    if (group === 'telesale') {
        targetGroups = ['telesale', 'telesale_TuVan'];
    } else if (group === 'care') {
        targetGroups = ['care', 'CareService'];
    } else if (group === 'telesale_TuVan') {
        targetGroups = ['telesale_TuVan', 'telesale']; // Fallback nếu có cả hai
    } else if (group === 'CareService') {
        targetGroups = ['CareService', 'care']; // Fallback nếu có cả hai
    }
    
    console.log(`[AutoAssign] Target groups to search:`, targetGroups);
    
    // Ưu tiên 1: Chỉ tìm nhân sự có role chính xác là 'Sale' (không phải 'Admin Sale')
    // Query tất cả users có role chứa 'Sale', sau đó filter để chỉ lấy role chính xác là 'Sale'
    let allCandidates = await User.find({
        group: { $in: targetGroups },
        role: { $in: [SALE_ROLE] } // Tìm role có chứa 'Sale'
    }).sort({ _id: 1 }).lean();
    
    // Filter để chỉ lấy những user có role chính xác là 'Sale' (không phải 'Admin Sale')
    let candidates = allCandidates.filter(user => 
        Array.isArray(user.role) && 
        user.role.includes(SALE_ROLE) && 
        !user.role.includes('Admin Sale')
    );
    
    // Ưu tiên 2: Nếu không có Sale, tìm nhân sự thuộc nhóm tuyển sinh chính (Telesale/Care) nhưng loại bỏ Admin Sale
    if (!candidates?.length) {
        allCandidates = await User.find({
            group: { $in: targetGroups },
            role: { $in: PRIORITY_ENROLLMENT_ROLES }
        }).sort({ _id: 1 }).lean();
        
        // Filter để loại bỏ Admin Sale
        candidates = allCandidates.filter(user => 
            Array.isArray(user.role) && !user.role.includes('Admin Sale')
        );
    }
    
    // Ưu tiên 3: Nếu vẫn không có, fallback sang các role tuyển sinh khác (nhưng không bao gồm Admin Sale)
    if (!candidates?.length) {
        const fallbackRoles = ['Telesale', 'Care', 'Sale']; // Không bao gồm 'Admin Sale'
        allCandidates = await User.find({
            group: { $in: targetGroups },
            role: { $in: fallbackRoles }
        }).sort({ _id: 1 }).lean();
        
        // Filter để loại bỏ Admin Sale
        candidates = allCandidates.filter(user => 
            Array.isArray(user.role) && !user.role.includes('Admin Sale')
        );
    }
    
    console.log(`[AutoAssign] Found ${candidates.length} candidates (prioritizing role 'Sale', excluding 'Admin Sale'):`, candidates.map(c => ({
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
            const newStatus = (staticUser.group === 'telesale' || staticUser.group === 'telesale_TuVan')
                ? 'telesale_TuVan3'
                : ((staticUser.group === 'care' || staticUser.group === 'CareService')
                    ? 'CareService3'
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
            const newStatus = (targetGroupUser.group === 'telesale' || targetGroupUser.group === 'telesale_TuVan')
                ? 'telesale_TuVan3'
                : ((targetGroupUser.group === 'care' || targetGroupUser.group === 'CareService')
                    ? 'CareService3'
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
        const fbStatus = (fallbackUser.group === 'telesale' || fallbackUser.group === 'telesale_TuVan')
            ? 'telesale_TuVan3'
            : ((fallbackUser.group === 'care' || fallbackUser.group === 'CareService')
                ? 'CareService3'
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

    // Xác định targetGroup từ Service
    // Ưu tiên 1: saleGroup (nếu có) - chỉ có giá trị 'telesale', 'care', 'telesale_TuVan' hoặc 'CareService'
    // Lưu ý: service.type là loại ngành học (dai_hoc, lien_thong, ...), không phải group
    // Nếu không có saleGroup, fallback sang logic khác
    const targetGroup = service.saleGroup || null;

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
            // Ưu tiên role chính xác là 'Sale'
            const hasSaleRole = Array.isArray(defaultSaleUser.role) && defaultSaleUser.role.includes(SALE_ROLE);
            const hasPriorityRole = matchesRoleList(defaultSaleUser.role, PRIORITY_ENROLLMENT_ROLES);
            const hasEnrollmentRole = hasSaleRole || hasPriorityRole || matchesRoleList(defaultSaleUser.role, ['Telesale', 'Care', 'Sale']);

            // Kiểm tra group có khớp với targetGroup không (hỗ trợ mapping)
            let hasMatchingGroup = false;
            if (targetGroup) {
                // Mapping: 'telesale'/'care' (service) → 'telesale_TuVan'/'CareService' (database)
                if (targetGroup === 'telesale') {
                    hasMatchingGroup = defaultSaleUser.group === 'telesale' || defaultSaleUser.group === 'telesale_TuVan';
                } else if (targetGroup === 'care') {
                    hasMatchingGroup = defaultSaleUser.group === 'care' || defaultSaleUser.group === 'CareService';
                } else {
                    // Nếu targetGroup là giá trị mới, check exact match hoặc giá trị cũ
                    hasMatchingGroup = defaultSaleUser.group === targetGroup || 
                        (targetGroup === 'telesale_TuVan' && defaultSaleUser.group === 'telesale') ||
                        (targetGroup === 'CareService' && defaultSaleUser.group === 'care');
                }
            }

            // Chỉ chấp nhận defaultSale nếu có role là 'Sale' hoặc role tuyển sinh (không bao gồm Admin Sale)
            if (hasEnrollmentRole && hasMatchingGroup && !defaultSaleUser.role?.includes('Admin Sale')) {
                assignedUser = defaultSaleUser;
                console.log(`[AutoAssign] ✅ Default staff hợp lệ: role tuyển sinh và cùng group "${targetGroup}" (user group: ${defaultSaleUser.group}, role: ${defaultSaleUser.role})`);
            } else {
                console.log(`[AutoAssign] ⚠️ Default staff không phù hợp:`, {
                    hasSaleRole,
                    hasEnrollmentRole,
                    hasPriorityRole,
                    hasMatchingGroup,
                    userGroup: defaultSaleUser.group,
                    userRole: defaultSaleUser.role,
                    targetGroup
                });
                console.log(`[AutoAssign] → Sẽ dùng round-robin theo group "${targetGroup}" (ưu tiên role 'Sale')`);
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

    const newStatus = (assignedUser.group === 'telesale' || assignedUser.group === 'telesale_TuVan')
        ? 'telesale_TuVan3'
        : ((assignedUser.group === 'care' || assignedUser.group === 'CareService')
            ? 'CareService3'
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


