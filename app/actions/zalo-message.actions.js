'use server';

import connectDB from '@/config/connectDB';
import Customer from '@/models/customer.model';
import Zalo from '@/models/zalo.model';
import Logs from '@/models/log.model';
import checkAuthToken from '@/utils/checktoken';
import { actionZalo } from '@/function/drive/appscript';
import { revalidateData } from '@/app/actions/customer.actions';

/**
 * Normalize UID format to ensure consistency
 */
function normalizeUid(uid) {
    if (!uid) return null;
    const s = String(uid).trim();
    return s.length > 0 ? s : null;
}

export async function sendZaloMessageAction(previousState, formData) {
   
    // 1. Authentication check
    const user = await checkAuthToken();
    if (!user || !user.id) {
        
        return { success: false, message: 'Bạn cần đăng nhập để thực hiện hành động này.' };
    }
    const roleList = Array.isArray(user.role) ? user.role : [user.role];
    if (!roleList.some((role) => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role))) {
        // console.log('❌ [Zalo Message] No permission');
        return { success: false, message: 'Bạn không có quyền thực hiện chức năng này' };
    }

    // 2. Get input data
    const customerId = formData.get('customerId');
    const message = formData.get('message');

    if (!customerId || !message) {
        // console.log('❌ [Zalo Message] Missing data', { customerId, message: !!message });
        return { success: false, message: 'Thiếu thông tin cần thiết.' };
    }

    // console.log('✅ [Zalo Message] Valid input, connecting to DB...');
    
    try {
        await connectDB();

        // 3. Find customer
        const customer = await Customer.findById(customerId).lean();
        if (!customer) {
            return { success: false, message: 'Không tìm thấy khách hàng.' };
        }

        // console.log('✅ [Zalo Message] Customer found:', customer.name, 'Phone:', customer.phone);

        // 4. Find Zalo account
        // PRIORITY 1: Use the Zalo account that found the customer's UID (same as agenda.js)
        let selectedZalo = null;
        if (customer.uid?.[0]?.zalo) {
            selectedZalo = await Zalo.findById(customer.uid[0].zalo).lean();
        }
        
        // PRIORITY 2: If customer doesn't have a Zalo account linked, use user's selection
        if (!selectedZalo && user.zalo) {
            selectedZalo = await Zalo.findById(user.zalo).lean();
        }
        
        // PRIORITY 3: Fallback to any available Zalo account (pick newest)
        if (!selectedZalo) {
            selectedZalo = await Zalo.findOne().sort({ _id: -1 }).lean();
        }

        if (!selectedZalo) {
            // console.log('❌ [Zalo Message] No Zalo account found');
            return { success: false, message: 'Không tìm thấy tài khoản Zalo để sử dụng.' };
        }

        // console.log('✅ [Zalo Message] Found Zalo account:', selectedZalo.name, 'ID:', selectedZalo._id.toString(), 'UID:', selectedZalo.uid);

        // 5. Check if customer has Zalo UID
        let uidPerson = null;
        // console.log('🔍 [Zalo Message] Customer uid array:', JSON.stringify(customer.uid));
        // console.log('🔍 [Zalo Message] Looking for Zalo ID:', selectedZalo._id.toString());
        
        const uidEntry = customer.uid?.find(u => u.zalo?.toString() === selectedZalo._id.toString());
        
        // console.log('🔍 [Zalo Message] Found uidEntry:', JSON.stringify(uidEntry));
        
        if (uidEntry && uidEntry.uid) {
            uidPerson = uidEntry.uid;
            // console.log('✅ [Zalo Message] Found existing UID:', uidPerson);
        } else {
            console.log('⚠️ [Zalo Message] No UID found, searching by phone...');
            // Try to find UID by phone using actionZalo
            const findUidResult = await actionZalo({
                phone: customer.phone,
                uid: selectedZalo.uid,
                actionType: 'findUid'
            });
            
            // console.log('📋 [Zalo Message] Find UID result:', JSON.stringify(findUidResult));
            
            if (findUidResult.status) {
                const targetUid = findUidResult.content?.data?.uid;
                // console.log('📋 [Zalo Message] Extracted targetUid:', targetUid);
                const normalizedUid = normalizeUid(targetUid);
                
                if (normalizedUid) {
                    // Save UID to customer
                    await Customer.updateOne(
                        { _id: customerId },
                        { 
                            $set: { 
                                zaloavt: findUidResult.content?.data?.avatar || customer.zaloavt || null,
                                zaloname: findUidResult.content?.data?.zalo_name || customer.zaloname || null
                            },
                            $push: { 
                                uid: { 
                                    zalo: selectedZalo._id, 
                                    uid: normalizedUid,
                                    isFriend: 0,
                                    isReques: 0
                                } 
                            } 
                        }
                    );
                    
                    uidPerson = normalizedUid;
                    // console.log('✅ [Zalo Message] Saved new UID:', uidPerson);
                } else {
                    // console.log('❌ [Zalo Message] Normalized UID is empty');
                    return { 
                        success: false, 
                        message: 'Không tìm thấy UID Zalo của khách hàng. Vui lòng kiểm tra lại số điện thoại.' 
                    };
                }
            } else {
                // console.log('❌ [Zalo Message] Find UID failed:', findUidResult.content?.error_message || findUidResult.message);
                return { 
                    success: false, 
                    message: findUidResult.content?.error_message || findUidResult.message || 'Không tìm thấy UID Zalo của khách hàng. Vui lòng kiểm tra lại số điện thoại.' 
                };
            }
        }

        // 6. Send message via actionZalo
        const phone = customer.phone;
        // console.log('📤 [Zalo Message] Sending message to', phone, 'with UID', uidPerson);
        
        const result = await actionZalo({
            phone: phone,
            uidPerson: uidPerson,
            actionType: 'sendMessage',
            message: message,
            uid: selectedZalo.uid
        });

        // console.log('📥 [Zalo Message] Send result:', result.status, result.content);

        // 7. Log the action
        await Logs.create({
            status: {
                status: result.status || false,
                message: message,
                data: {
                    error_code: result.content?.error_code || null,
                    error_message: result.content?.error_message || (result.status ? '' : 'Invalid response from AppScript'),
                }
            },
            type: 'sendMessage',
            createBy: user.id,
            customer: customerId,
            zalo: selectedZalo._id,
        });

        // 8. Update pipeline status and add care note if successful
        if (result.status) {
            const newStatus = 'msg_success_2';
            await Customer.findByIdAndUpdate(customerId, {
                $set: {
                    'pipelineStatus.0': newStatus,
                    'pipelineStatus.2': newStatus
                },
                $push: {
                    care: {
                        content: `Hành động [Gửi tin nhắn Zalo] đã hoàn thành thành công.`,
                        step: 2,
                        createBy: user.id,
                        createAt: new Date()
                    }
                }
            });
            // console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newStatus}, pipelineStatus.2=${newStatus} (zalo message success)`);
        } else {
            // Update pipeline status to error if failed
            const newStatus = 'msg_error_2';
            await Customer.updateOne({ _id: customerId }, {
                $set: {
                    'pipelineStatus.0': newStatus,
                    'pipelineStatus.2': newStatus
                },
                $push: {
                    care: {
                        content: `Hành động [Gửi tin nhắn Zalo] thất bại: ${result.content?.error_message || result.message || 'Lỗi không xác định'}`,
                        step: 2,
                        createBy: user.id,
                        createAt: new Date()
                    }
                }
            });
            // console.log(`[pipelineStatus] Cập nhật pipelineStatus cho customer ${customerId}: pipelineStatus.0=${newStatus}, pipelineStatus.2=${newStatus} (zalo message error)`);
        }

        // 9. Revalidate data
        await revalidateData();

        if (result.status) {
            // console.log('✅ [Zalo Message] Success!');
            return { success: true, message: 'Đã gửi tin nhắn thành công!' };
        } else {
            // console.log('❌ [Zalo Message] Failed:', result.content?.error_message || result.message);
            return { 
                success: false, 
                message: result.content?.error_message || result.message || 'Gửi tin nhắn thất bại.' 
            };
        }

    } catch (error) {
        // console.error('❌ [Zalo Message] Error:', error);
        return { success: false, message: 'Đã xảy ra lỗi khi gửi tin nhắn. Vui lòng thử lại.' };
    }
}

