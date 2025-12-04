import connectDB from '@/config/connectDB';
import Customer from '@/models/customer.model';
import autoAssignForCustomer from '@/utils/autoAssign';
import { revalidateData } from '@/app/actions/customer.actions';
import mongoose from 'mongoose';
import { getPagesFromAPI } from '@/lib/pancake-api';

// Source ID mặc định cho "Nhắn tin"
const DEFAULT_SOURCE_ID = '68b5ebb3658a1123798c0ce4';

// Chuẩn hóa số điện thoại Việt Nam
function normalizeVNPhone(digits) {
    if (!digits) return null;
    let cleaned = String(digits).replace(/[^\d+]/g, '');

    if (/^\+?84\d{9,10}$/.test(cleaned)) {
        cleaned = cleaned.replace(/^\+?84/, '0');
    }
    if (/^\d{9}$/.test(cleaned) && !cleaned.startsWith('0')) {
        cleaned = '0' + cleaned;
    }
    if (/^0\d{9}$/.test(cleaned) || /^0\d{10}$/.test(cleaned)) {
        return cleaned;
    }
    return null;
}

// Trích xuất số điện thoại từ văn bản
function extractPhones(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const out = new Set();
    const pattern = /(?:\+?84|0)[\s.\-_]*(?:\d[\s.\-_]*){8,10}\d/g;
    const matches = text.match(pattern) || [];

    for (const raw of matches) {
        const onlyDigits = raw.replace(/[^\d+]/g, '');
        const normalized = normalizeVNPhone(onlyDigits);
        if (normalized) out.add(normalized);
    }
    return [...out];
}

// Chuyển đổi platform code sang tên hiển thị
function formatPlatformName(platform) {
    const platformMap = {
        'facebook': 'Facebook',
        'instagram_official': 'Instagram',
        'tiktok_business_messaging': 'TikTok',
        'personal_zalo': 'Zalo'
    };
    return platformMap[platform] || platform || 'Facebook';
}

// Tạo sourceDetails theo format: "Tin nhắn - {Platform} - {Page Name}"
function formatSourceDetails(platform, pageName) {
    const platformName = formatPlatformName(platform);
    return `Tin nhắn - ${platformName} - ${pageName || 'Page'}`;
}

/**
 * Lấy tin nhắn mới nhất từ conversation
 */
async function getLatestCustomerMessage(conversationId, pageId, pageInfo, token, minutesAgo = 10) {
    try {
        // Xử lý conversation ID format
        let conversationPath = conversationId;
        if (conversationId.startsWith('ttm_')) {
            conversationPath = conversationId;
        } else {
            const parts = conversationId.split('_');
            if (parts.length > 1) {
                conversationPath = parts.slice(1).join('_');
            } else {
                const pageIdPart = pageId.includes('_') ? pageId.split('_').pop() : pageId;
                conversationPath = `${pageIdPart}_${conversationId}`;
            }
        }

        // Lấy tin nhắn từ Pancake API
        const messagesUrl = `https://pancake.vn/api/v1/pages/${pageId}/conversations/${conversationPath}/messages`;
        const messagesParams = new URLSearchParams({
            access_token: token,
            is_new_api: 'true',
            count: '20' // Lấy 20 tin nhắn mới nhất
        });

        const messagesResponse = await fetch(`${messagesUrl}?${messagesParams.toString()}`, { cache: 'no-store' });
        if (!messagesResponse.ok) {
            return null;
        }

        const messagesData = await messagesResponse.json();
        const messages = Array.isArray(messagesData?.messages || messagesData) ? (messagesData.messages || messagesData) : [];

        const pageIdForCompare = pageId.includes('_') ? pageId.split('_').pop() : pageId;
        const timeAgo = new Date(Date.now() - minutesAgo * 60 * 1000);

        // Lấy tin nhắn mới nhất từ khách hàng
        const customerMessages = messages
            .filter(msg => {
                const senderType = msg.sender_type || msg.senderType;
                const fromId = String(msg.from?.id || msg.sender?.id || '');
                
                // Tin nhắn từ khách hàng
                return senderType === 'customer' || 
                       (fromId && fromId !== pageIdForCompare && !fromId.includes(pageIdForCompare));
            })
            .filter(msg => {
                const msgTime = msg.inserted_at ? new Date(msg.inserted_at) : null;
                return msgTime && msgTime > timeAgo;
            })
            .sort((a, b) => {
                const timeA = a.inserted_at ? new Date(a.inserted_at).getTime() : 0;
                const timeB = b.inserted_at ? new Date(b.inserted_at).getTime() : 0;
                return timeB - timeA; // Mới nhất trước
            });

        if (customerMessages.length > 0) {
            const latestMsg = customerMessages[0];
            if (latestMsg.original_message) {
                return latestMsg.original_message;
            } else if (latestMsg.message) {
                return typeof latestMsg.message === 'string' 
                    ? latestMsg.message.replace(/<[^>]*>/g, '') 
                    : String(latestMsg.message);
            } else if (latestMsg.text) {
                return latestMsg.text;
            }
        }
        return null;
    } catch (error) {
        console.error('[getLatestCustomerMessage] Lỗi:', error?.message);
        return null;
    }
}

/**
 * Xử lý tự động tạo khách hàng từ tin nhắn có số điện thoại
 * @param {Object} conversation - Conversation object từ Pancake API
 * @param {Object} pageInfo - Thông tin page { id, name, platform, accessToken }
 * @returns {Promise<Object>} Kết quả xử lý
 */
export async function processMessageConversation(conversation, pageInfo = null) {
    try {
        await connectDB();

        const customerName = conversation.customers?.[0]?.name || 'Khách từ Inbox';
        let textToScan = conversation.snippet || '';
        const detectedPhones = new Set();

        // Lấy tin nhắn mới nhất từ API nếu có pageInfo và token
        if (pageInfo?.id && pageInfo?.accessToken) {
            const latestMessage = await getLatestCustomerMessage(
                conversation.id, 
                pageInfo.id, 
                pageInfo, 
                pageInfo.accessToken,
                30 // Mở rộng lên 30 phút gần đây
            );
            if (latestMessage) {
                textToScan = latestMessage;
            } else {
                
            }
        }

        // Ưu tiên 1: Lấy SĐT từ trường `recent_phone_numbers`
        if (Array.isArray(conversation.recent_phone_numbers)) {
            conversation.recent_phone_numbers.forEach(p => {
                if (p && p.phone_number) {
                    const normalized = normalizeVNPhone(p.phone_number);
                    if (normalized) detectedPhones.add(normalized);
                }
            });
        }

        // Ưu tiên 2: Quét nội dung tin nhắn
        if (detectedPhones.size === 0) {
            const phonesFromText = extractPhones(textToScan);
            phonesFromText.forEach(phone => detectedPhones.add(phone));
        }

        // Nếu không tìm thấy SĐT, bỏ qua
        if (detectedPhones.size === 0) {
            return {
                success: false,
                reason: 'no_phone_detected',
                conversation_id: conversation.id,
                customer_name: customerName
            };
        }

        

        const phoneToRegister = [...detectedPhones][0];
        if (!phoneToRegister) {
            return {
                success: false,
                reason: 'phone_normalization_failed',
                conversation_id: conversation.id,
                customer_name: customerName
            };
        }

        // Kiểm tra xem số điện thoại đã tồn tại chưa
        const existingCustomer = await Customer.findOne({ phone: phoneToRegister });
        if (existingCustomer) {
            // Cập nhật id_phone_mes cho khách hàng đã tồn tại
            existingCustomer.id_phone_mes = conversation.id;
            await existingCustomer.save();
            
            return {
                success: false,
                reason: 'already_exists',
                conversation_id: conversation.id,
                customer_name: customerName,
                phone: phoneToRegister,
                existing_customer_id: existingCustomer._id
            };
        }

        // Lấy danh sách page được quản lý để kiểm tra
        const managedPages = await getPagesFromAPI();
        if (!managedPages || !Array.isArray(managedPages) || managedPages.length === 0) {
            console.warn('[processMessageConversation] Không có page nào được quản lý. Bỏ qua conversation.');
            return {
                success: false,
                reason: 'no_managed_pages',
                conversation_id: conversation.id,
                customer_name: customerName
            };
        }

        // Lấy thông tin page nếu chưa có
        if (!pageInfo) {
            const pageId = conversation.page_id || conversation.page?.id;
            if (pageId) {
                pageInfo = managedPages.find(p => p.id === pageId);
            }
        }

        // Kiểm tra xem page có nằm trong danh sách được quản lý không
        if (!pageInfo || !managedPages.find(p => p.id === pageInfo.id)) {
            console.log(`[processMessageConversation] Page "${pageInfo?.name || 'unknown'}" không nằm trong danh sách được quản lý. Bỏ qua conversation ${conversation.id}`);
            return {
                success: false,
                reason: 'page_not_managed',
                conversation_id: conversation.id,
                customer_name: customerName,
                page_name: pageInfo?.name || 'unknown'
            };
        }

        // Tạo sourceDetails chi tiết
        const platform = pageInfo.platform || 'facebook';
        const pageName = pageInfo.name || 'Page';
        const sourceDetails = formatSourceDetails(platform, pageName);

        // Tạo khách hàng mới
        const newCustomerData = {
            name: customerName,
            phone: phoneToRegister,
            email: '',
            area: '',
            source: new mongoose.Types.ObjectId(DEFAULT_SOURCE_ID),
            sourceDetails: sourceDetails,
            pipelineStatus: ['new_unconfirmed_1'],
            care: [{
                content: 'Khách hàng được tạo tự động từ tin nhắn có chứa số điện thoại',
                step: 1,
                createBy: null,
                createAt: new Date()
            }],
            createAt: new Date(),
            id_phone_mes: conversation.id // Lưu conversation ID
        };

        const newCustomer = new Customer(newCustomerData);
        await newCustomer.save();
        console.log(`[pipelineStatus] Tạo customer mới ${newCustomer._id} với pipelineStatus: pipelineStatus[0]=new_unconfirmed_1 (autoMessageCustomer)`);

        // Gán tự động nhân sự phụ trách cho nhóm Telesale
        try {
            await autoAssignForCustomer(newCustomer._id, { targetGroup: 'telesale' });
        } catch (e) {
            console.error('[Auto Message Customer] Lỗi khi gán nhân sự:', e?.message || e);
        }

        // Revalidate data để UI tự động cập nhật
        try {
            await revalidateData();
        } catch (revalError) {
            console.error('[Auto Message Customer] Lỗi khi revalidate data:', revalError);
        }

        return {
            success: true,
            conversation_id: conversation.id,
            customer_name: customerName,
            phone: phoneToRegister,
            customer_id: newCustomer._id,
            platform: platform,
            page_name: pageName
        };

    } catch (error) {
        console.error('[Auto Message Customer] Lỗi khi xử lý conversation:', error);
        return {
            success: false,
            reason: 'error',
            conversation_id: conversation.id,
            error: error?.message || String(error)
        };
    }
}

