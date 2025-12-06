'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { Search, Send, Loader2, Check, AlertCircle, ChevronLeft, Tag, ChevronDown, X, Image as ImageIcon } from 'lucide-react';
import { sendMessageAction, uploadImageToDriveAction, sendImageAction } from './actions';
import { toggleLabelForCustomer } from '@/app/(setting)/label/actions';
import { Toaster, toast } from 'sonner';

import Image from 'next/image';
import Link from 'next/link';
import FallbackAvatar from '@/components/FallbackAvatar';

// ======================= Cấu hình nhỏ =======================
const PAGE_SIZE = 40; // mỗi lần load thêm hội thoại
const SOCKET_URL = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3100';

// ====== THỜI GIAN: Chuẩn hoá sang VN, chỉ cộng +7 nếu chuỗi thiếu timezone ======
const parseToVNDate = (dateLike) => {
    if (!dateLike) return null;
    const raw = String(dateLike);
    const hasTZ = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw); // có 'Z' hoặc offset +07:00
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return null;
    if (!hasTZ) {
        // API trả chuỗi không có timezone -> hiểu là UTC naive, cần +7
        d.setHours(d.getHours() + 7);
    }
    return d;
};

const fmtDateTimeVN = (dateLike) => {
    try {
        const d = parseToVNDate(dateLike);
        if (!d) return 'Thời gian không xác định';
        return d.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return 'Thời gian không xác định';
    }
};

// ======================= Helper =======================
// Chấp nhận cả INBOX và COMMENT (và các type khác nếu cần)
// API Pancake có thể trả về conversations với type là COMMENT hoặc INBOX
const isInbox = (convo) => {
    const type = convo?.type;
    // Chấp nhận INBOX, COMMENT, và các type hợp lệ khác
    return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
};
const getConvoPsid = (convo) => convo?.from_psid || null;
const getConvoAvatarId = (convo) =>
    convo?.from_psid || convo?.customers?.[0]?.fb_id || convo?.from?.id || null;
const getConvoDisplayName = (convo) =>
    convo?.customers?.[0]?.name || convo?.from?.name || 'Khách hàng ẩn';
const avatarUrlFor = ({ idpage, iduser, token }) =>
    iduser ? `https://pancake.vn/api/v1/pages/${idpage}/avatar/${iduser}?access_token=${token}` : undefined;

// === Helpers cho messages ===
const getSenderType = (msg, pageId) => {
    if (msg?.senderType) return msg.senderType; // optimistic
    const fromId = String(msg?.from?.id || '');
    // Với COMMENT type, from.id có thể là pageId hoặc customer fb_id
    // Nếu from có admin_name hoặc uid, đó là reply từ page
    if (msg?.from?.admin_name || msg?.from?.uid) {
        return 'page';
    }
    // Nếu from.id === pageId, đó là từ page
    if (fromId === String(pageId)) {
        return 'page';
    }
    // Còn lại là từ customer
    return 'customer';
};

const htmlToPlainText = (html) => {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div>/gi, '\n')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .trim();
};

// Chuẩn hóa số điện thoại Việt Nam
const normalizeVNPhone = (digits) => {
    if (typeof digits !== 'string') return null;
    
    const cleaned = digits.replace(/[^\d+]/g, '');
    
    if (cleaned.startsWith('+84')) {
        const phone = '0' + cleaned.substring(3);
        return phone.length === 10 ? phone : null;
    } else if (cleaned.startsWith('84') && cleaned.length === 11) {
        return '0' + cleaned.substring(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
        return cleaned;
    }
    
    return null;
};

// Trích xuất số điện thoại từ văn bản
const extractPhones = (text) => {
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
};

// Gọi API tạo khách hàng tự động
const createAutoCustomer = async (customerName, messageContent, conversationId, platform, pageName) => {
    try {
        const response = await fetch('/api/auto-customer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                customerName,
                messageContent,
                conversationId,
                platform,
                pageName
            })
        });

        const result = await response.json();
        
        if (result.success) {
            // console.log('✅ [Auto Customer] Tạo khách hàng thành công:', result);
            return result;
        } else {
            console.log('⚠️ [Auto Customer] Không thể tạo khách hàng:', result.message);
            return null;
        }
    } catch (error) {
        console.error('❌ [Auto Customer] Lỗi khi gọi API:', error);
        return null;
    }
};

// Chuẩn hoá 1 message của Pancake thành cấu trúc UI bạn dùng
const normalizePancakeMessage = (raw, pageId) => {
    const senderType = getSenderType(raw, pageId);
    const ts = raw.inserted_at;

    // === Normalize attachments from multiple shapes ===
    const asArray = (v) => (Array.isArray(v) ? v : []);
    const atts = [
        ...asArray(raw.attachments),
        ...asArray(raw.attachments?.data),
        ...asArray(raw.message_attachments),
        ...asArray(raw.data?.attachments),
        ...(raw.attachment ? [raw.attachment] : []),
        // Với COMMENT type, có thể có attachments ở các vị trí khác
        ...(raw.type === 'COMMENT' && raw.media ? [raw.media] : []),
        ...(raw.type === 'COMMENT' && raw.media_url ? [{ type: 'photo', url: raw.media_url }] : []),
        ...(raw.type === 'COMMENT' && raw.image_url ? [{ type: 'photo', url: raw.image_url }] : []),
    ];
    
    // Debug: Log attachments cho COMMENT type
    // if (raw.type === 'COMMENT' && (atts.length > 0 || raw.media || raw.media_url || raw.image_url)) {
    //     console.log('[normalizePancakeMessage] COMMENT attachments:', {
    //         id: raw.id,
    //         attachments: raw.attachments,
    //         message_attachments: raw.message_attachments,
    //         media: raw.media,
    //         media_url: raw.media_url,
    //         image_url: raw.image_url,
    //         allAtts: atts
    //     });
    // }

    // ✅ Phát hiện sticker - sticker có type="sticker" hoặc trong payload
    const stickerAtts = atts
        .filter((a) => a && (
            a.type === 'sticker' || 
            a.type?.toLowerCase() === 'sticker' ||
            a.payload?.type === 'sticker' ||
            (a.payload && a.payload.sticker_id) ||
            (a.payload && a.payload.url && a.type !== 'photo' && a.type !== 'image')
        ))
        .map((a) => {
            const url = a?.url
                || a?.preview_url
                || a?.image_data?.url
                || a?.src
                || a?.source
                || a?.payload?.url
                || a?.payload?.src
                || a?.payload?.image_url
                || a?.media?.image?.src
                || a?.media?.image?.url
                || a?.file_url;
            return url ? { ...a, url, stickerId: a?.payload?.sticker_id || a?.sticker_id } : null;
        })
        .filter((a) => a && a.url);
    
    // Nếu có sticker, ưu tiên hiển thị sticker
    if (stickerAtts.length > 0) {
        const result = {
            id: raw.id,
            inserted_at: ts,
            senderType,
            status: raw.status || 'sent',
            content: {
                type: 'sticker',
                stickers: stickerAtts.map((a) => ({
                    url: a.url,
                    width: a?.image_data?.width || a?.width || 200,
                    height: a?.image_data?.height || a?.height || 200,
                    stickerId: a.stickerId,
                })),
            },
        };
        // Với COMMENT type, giữ lại ID gốc để dùng làm message_id
        if (raw.type === 'COMMENT') {
            result.rawId = raw.id;
            result.is_parent = raw.is_parent;
            result.is_removed = raw.is_removed;
            result.from = raw.from;
        }
        return result;
    }

    // Phát hiện images - cải thiện cho COMMENT type
    const imageAtts = atts
        .filter((a) => {
            if (!a) return false;
            
            // Kiểm tra type
            const isPhotoType = a.type === 'photo' || a.type === 'image' || a.mime?.startsWith?.('image/');
            const isSticker = a.type === 'sticker' || a.type?.toLowerCase() === 'sticker';
            
            // Với COMMENT, có thể có URL từ nhiều nguồn khác nhau
            const possibleUrl = a?.url || a?.preview_url || a?.image_data?.url || a?.src || a?.source 
                || a?.payload?.url || a?.payload?.image_url || a?.media?.url || a?.media_url || a?.image_url;
            
            // Với COMMENT, nếu có URL (kể cả Facebook photo.php URL), coi là image
            if (raw.type === 'COMMENT' && possibleUrl && typeof possibleUrl === 'string' && !isSticker) {
                // Coi là image nếu:
                // 1. Có type = photo/image
                // 2. Hoặc có URL (kể cả Facebook URLs)
                if (isPhotoType || possibleUrl.includes('facebook.com') || possibleUrl.includes('photo') || /\.(jpg|jpeg|png|gif|webp)/i.test(possibleUrl)) {
                    return true;
                }
            }
            
            return isPhotoType && !isSticker;
        })
        .map((a) => {
            // Ưu tiên lấy URL từ nhiều nguồn, đặc biệt với COMMENT
            let url = a?.preview_url  // Ưu tiên preview_url cho COMMENT
                || a?.image_data?.url
                || a?.src
                || a?.source
                || a?.payload?.image_url
                || a?.payload?.url
                || a?.payload?.src
                || a?.media?.image?.src
                || a?.media?.image?.url
                || a?.media?.url
                || a?.url
                || a?.file_url
                // Với COMMENT, ưu tiên các URL có thể là direct image URL
                || (raw.type === 'COMMENT' && (a.media_url || a.image_url || (a.payload && a.payload.url)));
            
            // ✅ Với COMMENT, nếu URL là Facebook photo.php, cần giữ lại để convert sau
            // Nhưng ưu tiên tìm URL khác nếu có (như preview_url, image_data.url)
            // if (raw.type === 'COMMENT' && url && url.includes('facebook.com/photo.php')) {
            //     // Vẫn giữ Facebook URL nhưng đánh dấu để convert trong MessageContent
            //     console.log('[normalizePancakeMessage] COMMENT Facebook photo URL:', {
            //         url: url,
            //         hasPreviewUrl: !!a?.preview_url,
            //         hasImageDataUrl: !!a?.image_data?.url,
            //         attachment: a
            //     });
            // }
            
            // Nếu có URL, đảm bảo type được set đúng
            if (url) {
                // Lưu URL gốc để có thể fallback nếu cần
                const originalUrl = url.includes('facebook.com/photo.php') ? url : url;
                return { 
                    ...a, 
                    url,
                    type: a.type || (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) ? 'photo' : a.type),
                    // Lưu URL gốc để có thể click vào xem hoặc fallback
                    originalUrl: originalUrl
                };
            }
            return a;
        })
        .filter((a) => a?.url);
    
    // Debug: Log detected images cho COMMENT
    // if (raw.type === 'COMMENT' && imageAtts.length > 0) {
    //     console.log('[normalizePancakeMessage] COMMENT detected images:', {
    //         id: raw.id,
    //         imageAtts: imageAtts.map(a => ({ url: a.url, type: a.type }))
    //     });
    // }
    // Parse text message trước để kiểm tra xem có text không
    // Với COMMENT type, ưu tiên original_message (text thuần), nếu không có thì parse từ message (HTML)
    let text = '';
    if (raw.type === 'COMMENT') {
        // Với COMMENT, ưu tiên original_message vì nó là text thuần, không có HTML
        text = typeof raw.original_message === 'string' && raw.original_message.trim().length > 0
            ? raw.original_message.trim()
            : htmlToPlainText(raw.message || '');
    } else {
        // Với INBOX, giữ nguyên logic cũ
        text = typeof raw.original_message === 'string' && raw.original_message.trim().length > 0
            ? raw.original_message.trim()
            : htmlToPlainText(raw.message || '');
    }
    
    const hasText = text && text.trim().length > 0;
    
    if (imageAtts.length > 0) {
        // Nếu có cả images và text, tạo content type đặc biệt
        if (hasText) {
            // Parse reaction từ text nếu có
            let reactions = [];
            let cleanText = text;
            
            if (text && typeof text === 'string') {
                const reactionRegex = /^(\[[^\]]*?\])+\s*/;
                const match = text.match(reactionRegex);
                
                if (match) {
                    const reactionPart = match[0];
                    const reactionMatches = [...reactionPart.matchAll(/\[([^\]]*?)\]/g)];
                    
                    if (reactionMatches.length > 0) {
                        reactions = reactionMatches
                            .map(m => m[1].trim())
                            .filter(r => {
                                const isReaction = r && 
                                    r !== 'REACTION' && 
                                    r !== 'reaction' && 
                                    r.length > 0 &&
                                    (/\p{Emoji}/u.test(r) || r.length <= 5);
                                return isReaction;
                            });
                        
                        cleanText = text.replace(reactionRegex, '').trim();
                    }
                }
            }
            
            // Nếu không còn text sau khi loại bỏ reaction, dùng text gốc
            if (!cleanText && reactions.length > 0) {
                cleanText = text;
                reactions = [];
            }
            
            const result = {
                id: raw.id,
                inserted_at: ts,
                senderType,
                status: raw.status || 'sent',
                content: {
                    type: 'images_with_text',
                    images: imageAtts.map((a) => ({
                        url: a.url,
                        originalUrl: a.originalUrl || a.url,
                        width: a?.image_data?.width || a?.width,
                        height: a?.image_data?.height || a?.height,
                    })),
                    text: cleanText,
                    ...(reactions.length > 0 && { reactions }),
                },
            };
            // Với COMMENT type, giữ lại ID gốc để dùng làm message_id
            if (raw.type === 'COMMENT') {
                result.rawId = raw.id;
                result.is_parent = raw.is_parent;
                result.is_removed = raw.is_removed;
                result.from = raw.from;
            }
            return result;
        } else {
            // Chỉ có images, không có text
            const result = {
                id: raw.id,
                inserted_at: ts,
                senderType,
                status: raw.status || 'sent',
                content: {
                    type: 'images',
                    images: imageAtts.map((a) => ({
                        url: a.url,
                        originalUrl: a.originalUrl || a.url,
                        width: a?.image_data?.width || a?.width,
                        height: a?.image_data?.height || a?.height,
                    })),
                },
            };
            // Với COMMENT type, giữ lại ID gốc để dùng làm message_id
            if (raw.type === 'COMMENT') {
                result.rawId = raw.id;
                result.is_parent = raw.is_parent;
                result.is_removed = raw.is_removed;
                result.from = raw.from;
            }
            return result;
        }
    }

    // ✅ QUAN TRỌNG: Lọc bỏ attachment type="REACTION" và "sticker" vì đã xử lý riêng
    // Nếu có text message, ưu tiên hiển thị text với reaction thay vì file
    // Loại bỏ các attachments đã được phát hiện là images
    const fileAtts = atts.filter((a) => {
        if (!a?.type) return false;
        
        // Bỏ qua các loại đã xử lý riêng
        if (a.type === 'photo' || a.type === 'image' || a.type === 'sticker' || 
            a.type?.toLowerCase() === 'sticker' || a.type === 'REACTION' || 
            a.type?.toLowerCase() === 'reaction') {
            return false;
        }
        
        // Kiểm tra nếu attachment này đã được phát hiện là image
        const attachmentUrl = a?.url || a?.preview_url || a?.image_data?.url || 
                              a?.src || a?.source || a?.payload?.url || a?.media_url || a?.image_url;
        if (attachmentUrl && typeof attachmentUrl === 'string') {
            const isImageUrl = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(attachmentUrl);
            if (isImageUrl) return false; // Bỏ qua nếu là image URL
        }
        
        return true;
    });
    
    // Text đã được parse ở trên (trong phần xử lý images)
    // Nếu không có images, tiếp tục xử lý text ở đây
    // ✅ Nếu có text message, ưu tiên hiển thị text (có thể kèm reaction) thay vì file
    // Chỉ hiển thị file nếu không có text hoặc text rỗng
    // hasText đã được khai báo ở trên, không cần khai báo lại
    
    // Nếu không có text và có file attachments (không phải REACTION), hiển thị file
    if (!hasText && fileAtts.length > 0) {
        const result = {
            id: raw.id,
            inserted_at: ts,
            senderType,
            status: raw.status || 'sent',
            content: {
                type: 'files',
                files: fileAtts.map((a) => ({
                    url: a.url,
                    kind: a.type,
                })),
            },
        };
        // Với COMMENT type, giữ lại ID gốc để dùng làm message_id
        if (raw.type === 'COMMENT') {
            result.rawId = raw.id;
            result.is_parent = raw.is_parent;
            result.is_removed = raw.is_removed;
            result.from = raw.from;
        }
        return result;
    }
    
    // ✅ Parse reaction từ text: format "[emoji] text" hoặc "[emoji ] text"
    // Ví dụ: "[❤️ ] À anh hiểu." → reaction: "❤️", text: "À anh hiểu."
    let reactions = [];
    let cleanText = text;
    
    if (text && typeof text === 'string') {
        // Debug log để kiểm tra dữ liệu
        // if (text.includes('[') || text.includes('❤️') || text.includes(']')) {
        //     console.log('🔍 [Reaction Parse] Original text:', text);
        //     console.log('🔍 [Reaction Parse] Raw message:', {
        //         id: raw.id,
        //         original_message: raw.original_message,
        //         message: raw.message,
        //         attachments: raw.attachments
        //     });
        // }
        
        // Tìm tất cả các reaction ở đầu message trong format [emoji] hoặc [emoji ]
        // Cải thiện regex để bắt được cả format [❤️ ] (có khoảng trắng)
        const reactionRegex = /^(\[[^\]]*?\])+\s*/;
        const match = text.match(reactionRegex);
        
        if (match) {
            // Extract tất cả reactions từ phần đầu
            const reactionPart = match[0];
            const reactionMatches = [...reactionPart.matchAll(/\[([^\]]*?)\]/g)];
            
            if (reactionMatches.length > 0) {
                // Extract reactions (loại bỏ khoảng trắng ở đầu và cuối)
                reactions = reactionMatches
                    .map(m => m[1].trim())
                    .filter(r => {
                        // Lọc bỏ các giá trị không phải emoji/reaction
                        const isReaction = r && 
                            r !== 'REACTION' && 
                            r !== 'reaction' && 
                            r.length > 0 &&
                            // Kiểm tra xem có phải emoji hoặc ký tự đặc biệt không
                            (/\p{Emoji}/u.test(r) || r.length <= 5); // Emoji hoặc text ngắn
                        return isReaction;
                    });
                
                // Loại bỏ phần reaction ở đầu khỏi text
                cleanText = text.replace(reactionRegex, '').trim();
                
                // console.log('✅ [Reaction Parse] Parsed:', {
                //     reactions,
                //     cleanText,
                //     originalText: text,
                //     reactionPart,
                //     reactionMatches: reactionMatches.map(m => m[1])
                // });
            }
        } else {
            // Nếu không match với regex, thử cách khác: tìm pattern [xxx] ở đầu
            const simpleReactionRegex = /^\[([^\]]+?)\]\s+(.+)$/;
            const simpleMatch = text.match(simpleReactionRegex);
            if (simpleMatch) {
                const reactionText = simpleMatch[1].trim();
                cleanText = simpleMatch[2].trim();
                if (reactionText && reactionText !== 'REACTION' && reactionText !== 'reaction') {
                    reactions = [reactionText];
                    console.log('✅ [Reaction Parse] Simple match:', {
                        reactions,
                        cleanText,
                        originalText: text
                    });
                }
            }
        }
    }
    
    // Nếu không còn text sau khi loại bỏ reaction, dùng text gốc và không hiển thị reaction
    if (!cleanText && reactions.length > 0) {
        cleanText = text;
        reactions = [];
    }

    const normalizedContent = cleanText ? { 
        type: 'text', 
        content: cleanText,
        ...(reactions.length > 0 && { reactions }) // Thêm reactions nếu có
    } : { type: 'system', content: '' };
    
    // Debug log để kiểm tra kết quả cuối cùng
    // if (reactions.length > 0) {
    //     console.log('📤 [Reaction Parse] Final normalized message:', {
    //         id: raw.id,
    //         content: normalizedContent,
    //         hasReactions: !!normalizedContent.reactions,
    //         reactionsCount: reactions.length
    //     });
    // }
    
    const result = {
        id: raw.id,
        inserted_at: ts,
        senderType,
        status: raw.status || 'sent',
        content: normalizedContent,
    };
    
    // Với COMMENT type, giữ lại ID gốc và thông tin để dùng làm message_id khi reply
    if (raw.type === 'COMMENT') {
        result.rawId = raw.id; // ID gốc từ API, dùng làm message_id
        result.is_parent = raw.is_parent;
        result.is_removed = raw.is_removed;
        result.parent_id = raw.parent_id;
        result.from = raw.from; // Giữ nguyên để check admin_name, uid
        result.type = raw.type; // Giữ lại type COMMENT
    }
    
    return result;
};

// Hợp nhất danh sách hội thoại theo id, giữ item mới hơn (updated_at lớn hơn)
const mergeConversations = (prevList, incoming) => {
    const map = new Map();
    prevList.forEach((c) => map.set(c.id, c));
    (incoming || []).forEach((c) => {
        const old = map.get(c.id);
        if (!old) map.set(c.id, c);
        else {
            const newer =
                new Date(c.updated_at).getTime() > new Date(old.updated_at).getTime();
            if (!newer) {
                map.set(c.id, old);
            } else {
                // If incoming is newer, merge but preserve important nested fields
                // (customers, from, avatar, metadata) when incoming doesn't provide them.
                const merged = { ...old, ...c };
                if (!c.customers || (Array.isArray(c.customers) && c.customers.length === 0)) {
                    merged.customers = old.customers;
                }
                if (!c.from || Object.keys(c.from || {}).length === 0) {
                    merged.from = old.from;
                }
                if (!c.avatar && old.avatar) merged.avatar = old.avatar;
                // keep any other nested metadata if missing in incoming
                if (!c.meta && old.meta) merged.meta = old.meta;
                map.set(c.id, merged);
            }
        }
    });
    return Array.from(map.values());
};

// Sắp xếp tin nhắn tăng dần theo thời gian
const sortAscByTime = (arr) =>
    [...arr].sort((a, b) => new Date(a.inserted_at) - new Date(b.inserted_at));

// Lấy phần sau dấu "_" nếu có (theo API messages của Pancake)
const extractConvoKey = (cid) => {
    if (!cid) return cid;
    const s = String(cid);
    
    // Đặc biệt xử lý cho TikTok: sử dụng conversation ID đầy đủ
    if (s.startsWith('ttm_')) {
        return s; // Trả về conversation ID đầy đủ cho TikTok
    }
    
    // ✅ QUAN TRỌNG: Đặc biệt xử lý cho Zalo - phát hiện prefix pzl_
    // Zalo có format: "pzl_12345_67890" -> phải giữ nguyên toàn bộ
    if (s.startsWith('pzl_') || s.startsWith('igo_') || s.startsWith('zalo_') || s.startsWith('zal_')) {
        return s; // Trả về conversation ID đầy đủ cho Zalo/Instagram
    }
    
    // Xử lý bình thường cho Facebook/Instagram (format khác)
    const idx = s.indexOf('_');
    return idx >= 0 ? s.slice(idx + 1) : s;
};

const extractZaloUid = (cid) => {
    if (!cid) return null;
    const parts = String(cid).split('_');
    if (parts.length < 4) return null;
    if (parts[0] !== 'pzl') return null;
    const uidCandidate = parts[parts.length - 1];
    return uidCandidate || null;
};

const getZaloUidFromConversation = (convo) => {
    if (!convo) return null;
    return (
        extractZaloUid(convo.id) ||
        extractZaloUid(convo?.customers?.[0]?.fb_id) ||
        extractZaloUid(convo?.from?.id)
    );
};

// ======================= Subcomponents =======================
const LabelDropdown = ({
    labels = [],
    selectedLabelIds = [],
    onLabelChange,
    trigger,
    manageLabelsLink = '/label',
    style = 'left',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredLabels = useMemo(
        () =>
            labels.filter((label) =>
                (label?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
            ),
        [labels, searchTerm]
    );

    return (
        <div className="relative" ref={dropdownRef}>
            <div onClick={() => setIsOpen((v) => !v)}>{trigger}</div>
            {isOpen && (
                <div
                    style={{ right: style === 'right' ? 0 : 'auto', left: style === 'left' ? 0 : 'auto' }}
                    className="absolute top-full mt-2 w-72 bg-blue-50 text-gray-900 rounded-md border border-gray-200 shadow-lg z-50 overflow-hidden"
                >
                    <div className="p-3">
                        <h4 className="font-semibold text-gray-800 mb-1">Theo thẻ phân loại</h4>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Tìm thẻ..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-white text-gray-900 rounded-md pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto px-3">
                        {filteredLabels.map((label) => (
                            <label
                                key={label._id}
                                className="flex items-center gap-3 p-2.5 hover:bg-blue-100 rounded-md cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={selectedLabelIds.includes(label._id)}
                                    onChange={(e) => onLabelChange(label._id, e.target.checked)}
                                />
                                <Tag className="h-4 w-4" style={{ color: label.color }} />
                                <span className="flex-1">{label.name}</span>
                            </label>
                        ))}
                    </div>
                    <div className="border-t border-gray-200 mt-1">
                        <Link
                            href={manageLabelsLink}
                            className="block w-full text-center p-3 hover:bg-blue-100 text-sm text-blue-600 font-medium"
                        >
                            Quản lý thẻ phân loại
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper function để convert Facebook photo URL thành direct image URL
// Thử nhiều cách để lấy direct image URL từ Facebook photo
const convertFacebookPhotoUrl = (url, pageId) => {
    if (!url || typeof url !== 'string') return url;
    
    // Kiểm tra nếu là Facebook photo.php URL
    const fbPhotoMatch = url.match(/facebook\.com\/photo\.php\?fbid=(\d+)/i);
    if (fbPhotoMatch) {
        const fbid = fbPhotoMatch[1];
        
        // Thử 1: Pancake API proxy (nếu có)
        if (pageId) {
            const pancakeProxyUrl = `https://pancake.vn/api/v1/pages/${pageId}/images/${fbid}`;
            return pancakeProxyUrl;
        }
        
        // Thử 2: Facebook Graph API endpoint (không cần access token cho public photos)
        // Format: https://graph.facebook.com/v18.0/{photo-id}/picture
        // Trả về redirect đến direct image URL
        const graphApiUrl = `https://graph.facebook.com/v18.0/${fbid}/picture?redirect=false&width=800`;
        return graphApiUrl;
    }
    
    return url;
};

// Component để hiển thị image với fallback khi lỗi
const ImageWithFallback = ({ src, originalUrl, alt }) => {
    const [imageError, setImageError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    
    // Thử convert Google Drive URL nếu lỗi
    const getFallbackUrl = (url) => {
        if (!url) return null;
        
        // Nếu là Google Drive URL, thử các format khác
        if (url.includes('drive.google.com')) {
            const driveIdMatch = url.match(/(?:\/d\/|id=)([\w-]+)/);
            if (driveIdMatch && driveIdMatch[1]) {
                const driveId = driveIdMatch[1];
                // Thử format uc?export=view
                return `https://drive.google.com/uc?export=view&id=${driveId}`;
            }
        }
        
        // Nếu là Google Drive ID (chỉ là ID, không có URL)
        if (!url.includes('http') && !url.includes('data:')) {
            return `https://drive.google.com/uc?export=view&id=${url}`;
        }
        
        return null;
    };
    
    const handleError = (e) => {
        console.error('[ImageWithFallback] Image load failed:', {
            src: e.target.src,
            originalUrl: originalUrl,
            retryCount: retryCount
        });
        
        // Thử fallback URL nếu chưa thử
        if (retryCount === 0) {
            const fallbackUrl = getFallbackUrl(originalUrl || src);
            if (fallbackUrl && fallbackUrl !== e.target.src) {
                // console.log('[ImageWithFallback] Trying fallback URL:', fallbackUrl);
                setRetryCount(1);
                e.target.src = fallbackUrl;
                return;
            }
        }
        
        // Nếu đã thử fallback hoặc không có fallback, hiển thị error state
        setImageError(true);
        e.target.style.display = 'none';
    };
    
    if (imageError) {
        return (
            <a 
                href={originalUrl || src} 
                target="_blank" 
                rel="noreferrer"
                className="max-w-[240px] max-h-[240px] rounded-lg bg-gray-100 border border-gray-300 flex flex-col items-center justify-center p-4 text-xs text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors"
            >
                <div className="text-2xl mb-2">🖼️</div>
                <div className="text-center">
                    <div className="font-medium">Không thể tải hình ảnh</div>
                    <div className="mt-1 text-xs text-blue-500 hover:underline">Click để mở</div>
                </div>
            </a>
        );
    }
    
    return (
        <a href={originalUrl || src} target="_blank" rel="noreferrer">
            <img
                src={src}
                alt={alt}
                className="max-w-[240px] max-h-[240px] rounded-lg object-cover cursor-pointer"
                loading="lazy"
                onError={handleError}
            />
        </a>
    );
};

// Component để hiển thị Facebook photo với fallback
const FacebookPhotoEmbed = ({ url, pancakeProxyUrl }) => {
    const [imageUrl, setImageUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const fbPhotoMatch = url.match(/facebook\.com\/photo\.php\?fbid=(\d+)/i);
    const fbid = fbPhotoMatch ? fbPhotoMatch[1] : null;
    
    // Kiểm tra Pancake proxy URL có phải là image không và lấy Graph API URL
    useEffect(() => {
        if (!fbid) {
            setError(true);
            setLoading(false);
            return;
        }
        
        // Thử kiểm tra Pancake proxy URL trước
        if (pancakeProxyUrl) {
            // Kiểm tra xem response có phải là image không
            fetch(pancakeProxyUrl, { method: 'HEAD', mode: 'cors' })
                .then(response => {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.startsWith('image/')) {
                        // Là image, có thể dùng
                        setImageUrl(pancakeProxyUrl);
                        setLoading(false);
                        return;
                    } else {
                        // Không phải image, thử Graph API
                        tryGraphApi();
                    }
                })
                .catch(() => {
                    // Fetch fail (có thể do CORS), thử Graph API
                    tryGraphApi();
                });
        } else {
            // Không có Pancake proxy, thử Graph API ngay
            tryGraphApi();
        }
        
        function tryGraphApi() {
            // Thử dùng Graph API để lấy direct image URL
            fetch(`https://graph.facebook.com/v18.0/${fbid}/picture?redirect=false&width=800`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Graph API request failed');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.data && data.data.url) {
                        // console.log('[FacebookPhotoEmbed] Got direct image URL from Graph API:', data.data.url);
                        setImageUrl(data.data.url);
                        setLoading(false);
                    } else {
                        throw new Error('No image URL in Graph API response');
                    }
                })
                .catch(err => {
                    console.error('[FacebookPhotoEmbed] Graph API fetch failed:', err);
                    // Nếu Graph API fail, thử dùng Pancake proxy URL dù sao (có thể vẫn load được)
                    if (pancakeProxyUrl) {
                        setImageUrl(pancakeProxyUrl);
                    }
                    setError(true);
                    setLoading(false);
                });
        }
    }, [fbid, pancakeProxyUrl]);
    
    // Nếu đang loading hoặc có error và không có imageUrl, hiển thị fallback
    if ((loading || error) && !imageUrl) {
        return (
            <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="max-w-[240px] max-h-[240px] rounded-lg bg-gray-100 border border-gray-300 flex flex-col items-center justify-center p-4 text-xs text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors"
            >
                <div className="text-2xl mb-2">📷</div>
                <div className="text-center">
                    <div className="font-medium">Hình ảnh từ Facebook</div>
                    <div className="mt-1 text-xs text-blue-500 hover:underline">Click để xem</div>
                </div>
            </a>
        );
    }
    
    // Có imageUrl, hiển thị image với fallback
    return (
        <div className="relative max-w-[240px] max-h-[240px]">
            {error && (
                // Fallback hiển thị khi có error
                <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute inset-0 rounded-lg bg-gray-100 border border-gray-300 flex flex-col items-center justify-center p-4 text-xs text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors z-10"
                >
                    <div className="text-2xl mb-2">📷</div>
                    <div className="text-center">
                        <div className="font-medium">Hình ảnh từ Facebook</div>
                        <div className="mt-1 text-xs text-blue-500 hover:underline">Click để xem</div>
                    </div>
                </a>
            )}
            {!error && (
                <a href={url} target="_blank" rel="noreferrer">
                    <img
                        src={imageUrl || pancakeProxyUrl || url}
                        alt="Facebook Photo"
                        className="max-w-[240px] max-h-[240px] rounded-lg object-cover cursor-pointer"
                        loading="lazy"
                        onError={(e) => {
                            console.error('[FacebookPhotoEmbed] Image load failed:', {
                                src: e.target.src,
                                originalUrl: url,
                                pancakeProxyUrl: pancakeProxyUrl,
                                imageUrl: imageUrl
                            });
                            
                            // Khi image fail, hiển thị fallback
                            setError(true);
                            e.target.style.display = 'none';
                        }}
                        onLoad={() => {
                            setLoading(false);
                            setError(false);
                        }}
                    />
                </a>
            )}
        </div>
    );
};

const MessageContent = ({ content, pageId }) => {
    if (!content)
        return (
            <h5 className="italic text-gray-400" style={{ textAlign: 'end' }}>
                Nội dung không hợp lệ
            </h5>
        );

    switch (content.type) {
        case 'text':
            return (
                <h5 className="w" style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>
                    {content.content}
                </h5>
            );

        case 'images_with_text':
            // Hiển thị cả images và text
            return (
                <div className="flex flex-col gap-2">
                    {/* Hiển thị text trước */}
                    {content.text && (
                        <h5 className="w" style={{ color: 'inherit', whiteSpace: 'pre-wrap', marginBottom: '0.5rem' }}>
                            {content.text}
                        </h5>
                    )}
                    {/* Hiển thị images */}
                    <div className="flex flex-wrap gap-2">
                        {content.images.map((img, i) => {
                            const originalUrl = img.url || img.originalUrl;
                            const isFacebookUrl = originalUrl && originalUrl.includes('facebook.com/photo.php');
                            
                            // Với Facebook URL, thử Pancake proxy trước
                            let imageUrl = pageId && isFacebookUrl 
                                ? convertFacebookPhotoUrl(originalUrl, pageId) 
                                : originalUrl;
                            
                            // Convert Google Drive URL nếu cần
                            if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
                                imageUrl = `https://lh3.googleusercontent.com/d/${imageUrl}`;
                            } else if (imageUrl && imageUrl.includes('drive.google.com')) {
                                const driveIdMatch = imageUrl.match(/(?:\/d\/|id=)([\w-]+)/);
                                if (driveIdMatch && driveIdMatch[1]) {
                                    imageUrl = `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`;
                                } else {
                                    const fileIdMatch = imageUrl.match(/\/file\/d\/([\w-]+)/);
                                    if (fileIdMatch && fileIdMatch[1]) {
                                        imageUrl = `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
                                    }
                                }
                            }
                            
                            if (isFacebookUrl) {
                                return (
                                    <FacebookPhotoEmbed
                                        key={i}
                                        url={originalUrl}
                                        pancakeProxyUrl={imageUrl !== originalUrl ? imageUrl : null}
                                    />
                                );
                            }
                            
                            return (
                                <ImageWithFallback
                                    key={i}
                                    src={imageUrl}
                                    originalUrl={originalUrl || imageUrl}
                                    alt={`Attachment ${i + 1}`}
                                />
                            );
                        })}
                    </div>
                </div>
            );

        case 'images':
            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {content.images.map((img, i) => {
                        const originalUrl = img.url || img.originalUrl;
                        const isFacebookUrl = originalUrl && originalUrl.includes('facebook.com/photo.php');
                        
                        // Với Facebook URL, thử Pancake proxy trước
                        let imageUrl = pageId && isFacebookUrl 
                            ? convertFacebookPhotoUrl(originalUrl, pageId) 
                            : originalUrl;
                        
                        // Convert Google Drive URL nếu cần
                        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
                            // Nếu là Google Drive ID, convert sang URL
                            imageUrl = `https://lh3.googleusercontent.com/d/${imageUrl}`;
                        } else if (imageUrl && imageUrl.includes('drive.google.com')) {
                            // Nếu là Google Drive URL, thử convert sang viewable URL
                            const driveIdMatch = imageUrl.match(/(?:\/d\/|id=)([\w-]+)/);
                            if (driveIdMatch && driveIdMatch[1]) {
                                imageUrl = `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`;
                            } else {
                                // Thử format uc?export=view
                                const fileIdMatch = imageUrl.match(/\/file\/d\/([\w-]+)/);
                                if (fileIdMatch && fileIdMatch[1]) {
                                    imageUrl = `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
                                }
                            }
                        }
                        
                        // Debug log
                        // if (isFacebookUrl) {
                        //     console.log('[MessageContent] Processing Facebook photo URL:', {
                        //         original: originalUrl,
                        //         converted: imageUrl,
                        //         pageId: pageId
                        //     });
                        // }
                        
                        // Với Facebook photo.php URL, dùng component đặc biệt để hiển thị
                        if (isFacebookUrl) {
                            return (
                                <FacebookPhotoEmbed
                                    key={i}
                                    url={originalUrl}
                                    pancakeProxyUrl={imageUrl !== originalUrl ? imageUrl : null}
                                />
                            );
                        }
                        
                        // Với các URL khác, hiển thị image với fallback
                        return (
                            <ImageWithFallback
                                key={i}
                                src={imageUrl}
                                originalUrl={originalUrl || imageUrl}
                                alt={`Attachment ${i + 1}`}
                            />
                        );
                    })}
                </div>
            );

        case 'sticker':
            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {content.stickers.map((sticker, i) => (
                        <div key={i} className="inline-block">
                            <img
                                src={sticker.url}
                                alt={`Sticker ${i + 1}`}
                                className="max-w-[200px] max-h-[200px] object-contain"
                                style={{
                                    width: sticker.width || 200,
                                    height: sticker.height || 200,
                                    maxWidth: '200px',
                                    maxHeight: '200px'
                                }}
                                loading="lazy"
                            />
                        </div>
                    ))}
                </div>
            );

        case 'files':
            return (
                <div className="flex flex-col gap-2 mt-1">
                    {content.files.map((f, i) => (
                        <a
                            key={i}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm"
                            title={f.kind ? `Tệp ${f.kind}` : 'Tệp đính kèm'}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" />
                                <path d="M14 2v6h6" fill="none" stroke="currentColor" />
                            </svg>
                            <span className="truncate max-w-[280px]">
                                {f.kind ? `${f.kind.toUpperCase()} file` : 'Tệp đính kèm'}
                            </span>
                        </a>
                    ))}
                </div>
            );

        case 'system':
            return (
                <div className="w-full text-center my-2">
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
                        {content.content || '—'}
                    </span>
                </div>
            );

        default:
            return <h5 className="italic text-gray-400">Tin nhắn không được hỗ trợ</h5>;
    }
};

const MessageStatus = ({ status, error }) => {
    switch (status) {
        case 'sending':
            return (
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1 px-1 justify-end">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Đang gửi...</span>
                </div>
            );
        case 'sent':
            return (
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1 px-1 justify-end">
                    <Check className="h-3 w-3" />
                    <span>Đã nhận</span>
                </div>
            );
        case 'failed':
            return (
                <div className="flex items-center gap-1 text-xs text-red-500 mt-1 px-1 justify-end">
                    <AlertCircle className="h-3 w-3" />
                    <span>Lỗi: {error}</span>
                </div>
            );
        default:
            return (
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1 px-1 justify-end">
                    <Check className="h-3 w-3" />
                    <span>Đã nhận</span>
                </div>
            );
    }
};

// ====================== Component chính (full socket) ======================
export default function ChatClient({
    pageConfig,
    label: initialLabels,
    token,
    preselect,
    hideSidebar = false,
}) {
    // 1) State hội thoại
    const [conversations, setConversations] = useState([]);
    const [loadedCount, setLoadedCount] = useState(0);
    const [isLoadingConversations, setIsLoadingConversations] = useState(true);

    const [allLabels, setAllLabels] = useState(initialLabels || []);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const selectedConvoRef = useRef(null);
    useEffect(() => {
        selectedConvoRef.current = selectedConvo;
    }, [selectedConvo]);

    // 2) Messages detail cho hội thoại đang chọn
    const [messages, setMessages] = useState([]);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    // Load older messages (scroll top)
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [hasMoreMessages, setHasMoreMessages] = useState(true); // Cho INBOX type
    const messagesScrollRef = useRef(null);
    const [isNearBottom, setIsNearBottom] = useState(true);
    const isNearBottomRef = useRef(true);
    const lastScrollTopRef = useRef(0);
    const isInitialLoadRef = useRef(false); // Cho INBOX type
    const shouldScrollToBottomRef = useRef(false); // Cho INBOX type
    const isInitialFetchRef = useRef(false); // Flag để đảm bảo chỉ fetch 1 lần ban đầu
    const hasTriggeredLoadRef = useRef(false); // Flag để tránh trigger load nhiều lần
    
    // Refs để đọc giá trị mới nhất trong scroll handler
    const hasMoreMessagesRef = useRef(hasMoreMessages);
    const isLoadingOlderRef = useRef(isLoadingOlder);
    const hasMoreRef = useRef(hasMore);
    
    // Cập nhật refs khi state thay đổi
    useEffect(() => {
        hasMoreMessagesRef.current = hasMoreMessages;
    }, [hasMoreMessages]);
    
    useEffect(() => {
        isLoadingOlderRef.current = isLoadingOlder;
    }, [isLoadingOlder]);
    
    useEffect(() => {
        hasMoreRef.current = hasMore;
    }, [hasMore]);

    // 3) Search
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState([]);

    // 4) Lọc theo nhãn
    const [selectedFilterLabelIds, setSelectedFilterLabelIds] = useState([]);

    // 5) Refs UI
    const formRef = useRef(null);
    const messagesEndRef = useRef(null);
    const sidebarRef = useRef(null);
    const fileInputRef = useRef(null);

    // Ảnh pending
    const [pendingImages, setPendingImages] = useState([]);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const hasPendingUploads = useMemo(() => pendingImages.some((p) => !p?.id), [pendingImages]);

    // Gán/Bỏ gán nhãn cho hội thoại đang chọn
    const handleToggleLabel = useCallback(
        async (labelId, checked) => {
            try {
                const psid = getConvoPsid(selectedConvoRef.current);
                if (!psid) {
                    toast.error('Không thể gán nhãn: thiếu PSID.');
                    return;
                }
                const res = await toggleLabelForCustomer({ labelId, psid });
                if (!res?.success) {
                    toast.error(res?.error || 'Không thể cập nhật nhãn');
                    return;
                }

                // Cập nhật lại state allLabels theo kết quả toggle
                setAllLabels((prev) =>
                    prev.map((l) => {
                        if (l._id !== labelId) return l;
                        const set = new Set(Array.isArray(l.customer) ? l.customer : []);
                        if (checked) set.add(psid); else set.delete(psid);
                        return { ...l, customer: Array.from(set) };
                    })
                );

                toast.success(res?.message || (checked ? 'Đã gán nhãn' : 'Đã bỏ nhãn'));
            } catch (e) {
                toast.error('Lỗi khi cập nhật nhãn');
                console.error('[handleToggleLabel] error:', e);
            }
        },
        []
    );

    // 6) Ước lượng “chưa rep” từ hội thoại
    const isLastFromPage = useCallback(
        (convo) => {
            const last = convo?.last_sent_by;
            const pageId = String(pageConfig?.id ?? '');
            if (!last) return false;
            const lastId = String(last.id ?? '');
            const lastEmail = String(last.email ?? '');
            const lastName = String(last.name ?? '');
            return (
                lastId === pageId ||
                (lastEmail && lastEmail.startsWith(`${pageId}@`)) ||
                lastName === pageConfig?.name
            );
        },
        [pageConfig?.id, pageConfig?.name]
    );

    // ===================== Name normalize helpers =====================
    const stripDiacritics = useCallback((s) => {
        try {
            return String(s || '')
                .normalize('NFD')
                .replace(/\p{Diacritic}/gu, '')
                .replace(/đ/gi, (m) => (m === 'đ' ? 'd' : 'D'))
                .toLowerCase()
                .trim();
        } catch {
            return String(s || '').toLowerCase().trim();
        }
    }, []);

    const genNameVariants = useCallback((fullName) => {
        const base = stripDiacritics(fullName);
        if (!base) return [];
        const parts = base.split(/\s+/).filter(Boolean);
        const variants = new Set([base]);
        // First + last, last
        if (parts.length >= 2) {
            variants.add(`${parts[0]} ${parts[parts.length - 1]}`);
            variants.add(parts[parts.length - 1]);
        }
        // Progressive tails
        for (let i = 1; i < parts.length; i++) {
            variants.add(parts.slice(i).join(' '));
        }
        return Array.from(variants);
    }, [stripDiacritics]);

    const normalizePhone = useCallback((raw) => normalizeVNPhone(String(raw || '')), []);

    const extractPhonesFromConvo = useCallback((convo) => {
        const set = new Set();
        const add = (v) => {
            const n = normalizePhone(v);
            if (n) set.add(n);
        };
        try {
            (convo?.recent_phone_numbers || []).forEach(add);
        } catch (_) {}
        add(convo?.customers?.[0]?.phone);
        add(convo?.from?.phone);
        if (typeof convo?.snippet === 'string') {
            extractPhones(convo.snippet).forEach(add);
        }
        return Array.from(set);
    }, [normalizePhone]);

    const extractNamesFromConvo = useCallback((convo) => {
        const names = new Set();
        const base = convo?.customers?.[0]?.name || convo?.from?.name || '';
        if (base) {
            genNameVariants(base).forEach((v) => names.add(v));
        }
        return Array.from(names);
    }, [genNameVariants]);
    // ============== SOCKET.IO: kết nối + handlers ==============
    const socketRef = useRef(null);

    // applyPatch cho conv:patch
    const applyPatch = useCallback((prev, patch) => {
        if (!patch || !patch.type) return prev;
        if (patch.type === 'replace' && Array.isArray(patch.items)) {
                // Incoming replace may contain partial items; merge with existing when possible
                const incoming = (patch.items || []).filter(isInbox);
                // Build map from incoming
                const incMap = new Map();
                incoming.forEach((c) => incMap.set(c.id, c));
                // Merge with prev: keep prev items not in incoming, and for items present merge fields
                const result = [];
                const prevMap = new Map(prev.map((p) => [p.id, p]));
                // add/merge incoming
                for (const inc of incoming) {
                    const old = prevMap.get(inc.id);
                    if (!old) {
                        result.push(inc);
                    } else {
                        const merged = { ...old, ...inc };
                        if (!inc.customers || (Array.isArray(inc.customers) && inc.customers.length === 0)) merged.customers = old.customers;
                        if (!inc.from || Object.keys(inc.from || {}).length === 0) merged.from = old.from;
                        if (!inc.avatar && old.avatar) merged.avatar = old.avatar;
                        result.push(merged);
                    }
                }
                // keep prev items that are not in incoming
                for (const p of prev) {
                    if (!incMap.has(p.id)) result.push(p);
                }
                return result;
        }
        if (patch.type === 'upsert' && Array.isArray(patch.items)) {
            const incoming = (patch.items || []).filter(isInbox);
            return mergeConversations(prev, incoming);
        }
        if (patch.type === 'remove' && Array.isArray(patch.ids)) {
            const set = new Set(patch.ids);
            return prev.filter((c) => !set.has(c.id));
        }
        return prev;
    }, []);

    useEffect(() => {
        // Reset conversations và loading state khi chuyển page
        setConversations([]);
        setSelectedConvo(null);
        setMessages([]);
        setIsLoadingConversations(true);
        setLoadedCount(0);
        
        // console.log('🔌 [ChatClient] Connecting to socket:', SOCKET_URL);
        const s = io(SOCKET_URL, {
            path: '/socket.io',
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 3000,
            withCredentials: true,
        });
        socketRef.current = s;

        s.on('connect', () => {
            console.log('✅ [ChatClient] Socket connected:', s.id, 'connected:', s.connected);
        });
        
        s.on('disconnect', (r) => {
            console.warn('⚠️ [ChatClient] Socket disconnected:', r);
        });
        
        s.on('connect_error', (e) => {
            console.error('❌ [ChatClient] Socket connection error:', e?.message || e);
        });

        // Realtime: patch hội thoại
        s.on('conv:patch', (patch) => {
            if (patch?.pageId && String(patch.pageId) !== String(pageConfig.id)) return;
            setConversations((prev) => {
                const next = applyPatch(prev, patch);
                return next.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            });
        });

        // Realtime: tin nhắn mới - Luôn refresh messages thay vì merge
        s.on('msg:new', (msg) => {
            const current = selectedConvoRef.current;
            const targetId = msg?.conversationId || msg?.conversation?.id;
            
            // Với COMMENT type, cần so sánh trực tiếp ID thay vì dùng extractConvoKey
            const isComment = current?.type === 'COMMENT';
            const isZalo = pageConfig?.platform === 'personal_zalo';
            
            let shouldRefresh = false;
            if (current) {
                if (!targetId) {
                    // Nếu không có targetId, vẫn refresh nếu có conversation đang chọn
                    shouldRefresh = true;
                } else if (isComment || isZalo) {
                    // Với COMMENT hoặc Zalo, so sánh trực tiếp ID đầy đủ
                    shouldRefresh = String(current.id) === String(targetId);
                } else {
                    // Với INBOX type, dùng extractConvoKey
                    const currentKey = extractConvoKey(current.id);
                    const targetKey = extractConvoKey(targetId);
                    shouldRefresh = currentKey === targetKey;
                }
            }
            
            // console.log('📨 [msg:new] Received:', {
            //     targetId,
            //     currentId: current?.id,
            //     currentType: current?.type,
            //     isComment,
            //     isZalo,
            //     shouldRefresh,
            //     rawMsg: msg
            // });
            
            // Kiểm tra tin nhắn mới có phải từ khách hàng không và có chứa số điện thoại
            const normalizedMsg = normalizePancakeMessage(msg, pageConfig.id);
            const isFromCustomer = normalizedMsg?.senderType === 'customer';
            
            if (isFromCustomer && normalizedMsg?.content?.type === 'text') {
                const messageText = normalizedMsg.content.content;
                const detectedPhones = extractPhones(messageText);
                
                if (detectedPhones.length > 0) {
                    const customerName = current?.customers?.[0]?.name || 'Khách hàng';
                    const conversationId = current?.id || targetId;
                    const platform = pageConfig?.platform || 'facebook';
                    const pageName = pageConfig?.name || 'Page Facebook';
                    
                    // console.log('🔍 [Auto Customer] Phát hiện số điện thoại trong tin nhắn:', {
                    //     customerName,
                    //     messageText,
                    //     detectedPhones,
                    //     conversationId,
                    //     platform,
                    //     pageName,
                    //     rawMsg: msg
                    // });
                    
                    // Gọi API tạo khách hàng tự động (không await để không block UI)
                    createAutoCustomer(customerName, messageText, conversationId, platform, pageName)
                        .then(result => {
                            if (result) {
                                console.log('✅ [Auto Customer] Đã tạo khách hàng tự động:', result);
                            }
                        })
                        .catch(error => {
                            console.error('❌ [Auto Customer] Lỗi khi tạo khách hàng:', error);
                        });
                }
            }
            
            // Xử lý tin nhắn mới nếu đúng conversation đang chọn
            if (shouldRefresh) {
                const s = socketRef.current;
                if (s && current) {
                    // Lưu conversation ID để kiểm tra sau khi nhận kết quả
                    const conversationIdAtStart = current.id;
                    
                    // Với INBOX type: thêm tin nhắn mới trực tiếp vào cuối danh sách
                    if (current.type === 'INBOX') {
                        const normalizedNewMsg = normalizePancakeMessage(msg, pageConfig.id);
                        
                        setMessages((prev) => {
                            // ✅ Kiểm tra conversation ID trước khi cập nhật
                            const checkConv = selectedConvoRef.current;
                            if (!checkConv || checkConv.id !== conversationIdAtStart) {
                                console.log('⏭️ [msg:new] Conversation đã thay đổi, bỏ qua tin nhắn mới');
                                return prev;
                            }
                            
                            // Kiểm tra xem tin nhắn đã có chưa (tránh duplicate)
                            if (prev.some(m => m.id === normalizedNewMsg.id)) {
                                return prev; // Bỏ qua nếu đã có
                            }
                            
                            // Đánh dấu cần scroll xuống nếu user đang ở gần cuối
                            shouldScrollToBottomRef.current = isNearBottomRef.current;
                            
                            // Thêm tin nhắn mới vào cuối danh sách và sắp xếp lại
                            return sortAscByTime([...prev, normalizedNewMsg]);
                        });
                        
                        console.log('📨 [msg:new] Added new message to INBOX conversation:', {
                            messageId: normalizedNewMsg.id,
                            conversationId: conversationIdAtStart,
                            shouldScroll: shouldScrollToBottomRef.current
                        });
                    } else {
                        // Với COMMENT type: refresh toàn bộ messages (giữ nguyên logic cũ)
                        // ✅ QUAN TRỌNG: Xử lý conversationId theo platform và type
                        const isZalo = pageConfig?.platform === 'personal_zalo';
                        const isComment = current?.type === 'COMMENT';
                        const conversationIdForRequest = isZalo || isComment
                            ? current.id  // ✅ Zalo hoặc COMMENT: giữ nguyên ID đầy đủ
                            : extractConvoKey(current.id);  // Facebook/Instagram INBOX: extract
                        
                        // Đối với Zalo, customerId có thể là null
                        const customerId = current?.customers?.[0]?.id
                            || current?.from?.id
                            || current?.from_psid
                            || null;
                        
                        s.emit(
                            'msg:get',
                            { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count: 0 },
                            (res) => {
                                // ✅ Kiểm tra conversation ID trước khi cập nhật
                                const checkConv = selectedConvoRef.current;
                                if (!checkConv || checkConv.id !== conversationIdAtStart) {
                                    console.log('⏭️ [msg:new] Conversation đã thay đổi, bỏ qua refresh messages');
                                    return;
                                }
                                
                                // console.log('📥 [msg:new] Refreshing messages after new message:', {
                                //     ok: res?.ok,
                                //     itemsCount: res?.items?.length || 0,
                                //     isComment,
                                //     conversationIdForRequest
                                // });
                                
                                if (res?.ok && Array.isArray(res.items)) {
                                    // Với COMMENT type, filter các comment đã bị remove
                                    let itemsToProcess = res.items;
                                    if (isComment) {
                                        itemsToProcess = res.items.filter(item => !item.is_removed);
                                        // console.log('📋 [msg:new] Filtered removed comments:', {
                                        //     total: res.items.length,
                                        //     afterFilter: itemsToProcess.length
                                        // });
                                    }
                                    
                                    const normalized = sortAscByTime(
                                        itemsToProcess.map((m) => normalizePancakeMessage(m, pageConfig.id))
                                    );
                                    // console.log('✅ [msg:new] Updated messages count:', normalized.length);
                                    
                                    // Xóa optimistic entries khi đã có tin nhắn thật từ server
                                    setMessages((prev) => {
                                        // Kiểm tra lại conversation ID một lần nữa
                                        const checkConvAgain = selectedConvoRef.current;
                                        if (!checkConvAgain || checkConvAgain.id !== conversationIdAtStart) {
                                            // console.log('⏭️ [msg:new] Conversation đã thay đổi trong setMessages, bỏ qua');
                                            return prev;
                                        }
                                        
                                        const now = Date.now();
                                        const oneMinuteAgo = now - 60000; // 1 phút trước
                                        
                                        // Lọc bỏ tất cả optimistic entries (có id bắt đầu bằng "optimistic-" hoặc status = 'sending' trong vòng 1 phút)
                                        const withoutOptimistic = prev.filter(m => {
                                            const isOptimistic = m.id?.startsWith('optimistic-');
                                            const isSending = m.status === 'sending';
                                            const isRecent = m.inserted_at && new Date(m.inserted_at).getTime() > oneMinuteAgo;
                                            
                                            // Xóa nếu là optimistic hoặc đang sending trong vòng 1 phút
                                            if (isOptimistic || (isSending && isRecent)) {
                                                return false;
                                            }
                                            return true;
                                        });
                                        
                                        // Merge với tin nhắn mới từ server
                                        const allMessages = [...withoutOptimistic, ...normalized];
                                        
                                        // Sort và loại bỏ duplicate dựa trên id
                                        const uniqueMessages = [];
                                        const seenIds = new Set();
                                        
                                        for (const msg of sortAscByTime(allMessages)) {
                                            // Chỉ thêm nếu chưa có id này
                                            if (msg.id && !seenIds.has(msg.id)) {
                                                seenIds.add(msg.id);
                                                uniqueMessages.push(msg);
                                            } else if (!msg.id) {
                                                // Nếu không có id, vẫn thêm (trường hợp hiếm)
                                                uniqueMessages.push(msg);
                                            }
                                        }
                                        
                                        // console.log('🔄 [msg:new] Merged messages:', {
                                        //     before: prev.length,
                                        //     optimisticRemoved: prev.length - withoutOptimistic.length,
                                        //     newFromServer: normalized.length,
                                        //     after: uniqueMessages.length,
                                        //     optimisticIds: prev.filter(m => m.id?.startsWith('optimistic-') || m.status === 'sending').map(m => m.id)
                                        // });
                                        
                                        // Với COMMENT type, scroll ngay
                                        if (isNearBottomRef.current) {
                                            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                                        }
                                        
                                        return sortAscByTime(uniqueMessages);
                                    });
                                } else {
                                    console.warn('⚠️ [msg:new] Failed to refresh messages:', res);
                                }
                            }
                        );
                    }
                }
            }
            if (targetId) {
                setConversations((prev) => {
                    // find existing conversation by id or key
                    const found = prev.find((c) => c.id === targetId) ||
                        prev.find((c) => extractConvoKey(c.id) === extractConvoKey(targetId));
                    if (!found) {
                        // if no existing conversation, don't create a minimal conv that lacks customers/from
                        // instead just update snippet in-place by returning prev
                        console.warn('[msg:new] Received msg for unknown conversation, skipping creating minimal convo:', targetId);
                        return prev;
                    }
                    const conv = found;
                    const updated = {
                        ...conv,
                        snippet: (() => {
                            const n = normalizePancakeMessage(msg, pageConfig.id);
                            const snippet = n?.content?.type === 'text' ? n.content.content : 
                                          n?.content?.type === 'images' ? '[Ảnh]' :
                                          n?.content?.type === 'files' ? '[Tệp]' : conv.snippet;
                            
                            
                            return snippet;
                        })(),
                        updated_at: msg?.inserted_at || new Date().toISOString(),
                    };
                    const merged = mergeConversations(prev, [updated]);
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
            }
        });

        // Lấy danh sách ban đầu
        setIsLoadingConversations(true);
        console.log('[ChatClient] Loading conversations for page:', pageConfig.id, pageConfig.name);
        s.emit('conv:get', { pageId: pageConfig.id, token, current_count: 0 }, (res) => {
            // console.log('[ChatClient] conv:get response:', {
            //     ok: res?.ok,
            //     itemsCount: Array.isArray(res?.items) ? res.items.length : 0,
            //     error: res?.error,
            //     sampleTypes: Array.isArray(res?.items) ? [...new Set(res.items.map(c => c?.type))] : []
            // });
            
            if (res?.ok && Array.isArray(res.items)) {
                const incoming = res.items.filter(isInbox);
                
                // Đếm số lượng conversation theo type
                const inboxCount = incoming.filter(c => c.type === 'INBOX').length;
                const commentCount = incoming.filter(c => c.type === 'COMMENT').length;
                const otherCount = incoming.filter(c => c.type !== 'INBOX' && c.type !== 'COMMENT').length;
                
                // console.log('📊 [ChatClient] Thống kê conversation types:');
                // console.log(`   ✉ INBOX: ${inboxCount} cuộc hội thoại`);
                // console.log(`   🗨️ COMMENT: ${commentCount} cuộc hội thoại`);
                // if (otherCount > 0) {
                //     console.log(`   ❓ Khác: ${otherCount} cuộc hội thoại`);
                // }
                // console.log(`   📝 Tổng cộng: ${incoming.length} cuộc hội thoại`);
                
                // console.log('[ChatClient] Filtered conversations:', {
                //     total: res.items.length,
                //     afterFilter: incoming.length,
                //     types: [...new Set(res.items.map(c => c?.type))]
                // });
                
                setConversations((prev) => {
                    const merged = mergeConversations(prev, incoming);
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
                setLoadedCount(incoming.length);
            } else if (res?.error) {
                console.error('[ChatClient] conv:get error:', res.error);
            }
            setIsLoadingConversations(false);
        });

        return () => {
            if (selectedConvoRef.current?.id) {
                try {
                    s.emit('msg:watchStop', {
                        pageId: pageConfig.id,
                        conversationId: selectedConvoRef.current.id,
                    });
                } catch (_) { }
            }
            s.off('conv:patch');
            s.off('msg:new');
            s.disconnect();
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageConfig.id, token]);

    // ===================== Load more conversations (sidebar) =====================
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const onSidebarScroll = useCallback(async () => {
        if (isSearching) return;
        const el = sidebarRef.current;
        if (!el || isLoadingMore) return;
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
        if (!nearBottom) return;

        try {
            setIsLoadingMore(true);
            const nextCount = loadedCount + PAGE_SIZE;
            const s = socketRef.current;
            if (!s) return;
            s.emit(
                'conv:loadMore',
                { pageId: pageConfig.id, token, current_count: nextCount },
                (ack) => {
                    if (ack?.ok && Array.isArray(ack.items)) {
                        const incoming = ack.items.filter(isInbox);
                        setConversations((prev) => {
                            const merged = mergeConversations(prev, incoming);
                            return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                        });
                        setLoadedCount(nextCount);
                    } else if (ack?.error) {
                        console.error('[conv:loadMore] error:', ack.error);
                    }
                }
            );
        } finally {
            setIsLoadingMore(false);
        }
    }, [isSearching, isLoadingMore, loadedCount, pageConfig.id, token]);

    useEffect(() => {
        const el = sidebarRef.current;
        if (!el) return;
        const handler = () => onSidebarScroll();
        el.addEventListener('scroll', handler);
        return () => el.removeEventListener('scroll', handler);
    }, [onSidebarScroll]);

    // ===================== Fetch messages cho INBOX type (theo hướng dẫn) =====================
    const fetchMessagesRef = useRef(null);
    
    // Hàm fetchMessages mới cho INBOX type theo hướng dẫn
    const fetchMessages = useCallback(async (currentCount = null, append = false) => {
        const conv = selectedConvoRef.current;
        if (!conv || !socketRef.current) {
            console.warn('⚠️ [fetchMessages] Không có conversation hoặc socket');
            return;
        }
        
        // Chỉ áp dụng cho INBOX type
        if (conv.type !== 'INBOX') {
            console.warn('⚠️ [fetchMessages] Không phải INBOX type:', conv.type);
            return;
        }
        
        const s = socketRef.current;
        if (!s || !s.connected) {
            console.warn('⚠️ [fetchMessages] Socket không kết nối');
            return;
        }
        
        // ✅ Với append (load more), kiểm tra đang loading
        if (append && isLoadingOlderRef.current) {
            // console.log('⏳ [fetchMessages] Đang tải tin nhắn cũ, bỏ qua request mới');
            return;
        }
        
        // console.log('📥 [fetchMessages] Bắt đầu fetch:', {
        //     append,
        //     currentCount,
        //     messagesLength: messages?.length || 0,
        //     conversationId: conv.id
        // });
        
        // Lưu conversation ID để kiểm tra sau khi nhận kết quả
        const conversationIdAtStart = conv.id;
        
        const isZalo = pageConfig?.platform === 'personal_zalo';
        const conversationIdForRequest = isZalo
            ? conv.id
            : extractConvoKey(conv.id);
        
        const customerId = conv?.customers?.[0]?.id
            || conv?.from?.id
            || conv?.from_psid
            || null;
        
        // Với append (load more), dùng current_count = số tin nhắn hiện có
        const count = append ? (messages?.length || 0) : (currentCount || 0);
        
        return new Promise((resolve) => {
            s.emit(
                'msg:get',
                { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count },
                (res) => {
                    // ✅ QUAN TRỌNG: Kiểm tra conversation ID trước khi cập nhật messages
                    const currentConv = selectedConvoRef.current;
                    if (!currentConv || currentConv.id !== conversationIdAtStart) {
                        // console.log('⏭️ [fetchMessages] Conversation đã thay đổi, bỏ qua kết quả:', {
                        //     conversationIdAtStart,
                        //     currentId: currentConv?.id
                        // });
                        setIsLoadingMessages(false);
                        setIsLoadingOlder(false);
                        resolve();
                        return;
                    }
                    
                    if (res?.ok && Array.isArray(res.items)) {
                        const incomingMessages = res.items;
                        const sortedMessages = sortAscByTime(
                            incomingMessages.map((m) => normalizePancakeMessage(m, pageConfig.id))
                        );
                        
                        if (append) {
                            // Load more: thêm tin nhắn cũ vào đầu danh sách
                            setMessages(prev => {
                                // Kiểm tra lại conversation ID một lần nữa
                                const checkConv = selectedConvoRef.current;
                                if (!checkConv || checkConv.id !== conversationIdAtStart) {
                                    // console.log('⏭️ [fetchMessages] Conversation đã thay đổi trong setMessages, bỏ qua');
                                    return prev;
                                }
                                
                                const prevLength = prev.length;
                                const requestedCount = count; // Số lượng đã yêu cầu
                                const receivedCount = sortedMessages.length; // Số lượng nhận được
                                
                                // 1. Loại bỏ duplicate
                                const existingIds = new Set(prev.map(m => m.id));
                                const newMessages = sortedMessages.filter(m => !existingIds.has(m.id));
                                
                                // 2. Phát hiện hết tin nhắn cũ:
                                // Logic: Nếu không có tin nhắn mới sau khi loại bỏ duplicate
                                // → Có nghĩa là tất cả tin nhắn API trả về đều đã có trong danh sách
                                // → Không còn tin nhắn cũ hơn để tải → Đánh dấu hết
                                const hasNoNewMessages = newMessages.length === 0;
                                const receivedLessThanRequested = receivedCount < requestedCount;
                                
                                if (hasNoNewMessages) {
                                    // Không có tin nhắn mới → đánh dấu hết
                                    setHasMoreMessages(false);
                                    // console.log('📭 [fetchMessages] Hết tin nhắn cũ hơn:', {
                                    //     prevLength,
                                    //     requestedCount,
                                    //     receivedCount,
                                    //     newMessagesLength: newMessages.length,
                                    //     reason: 'Không có tin nhắn mới (tất cả đều duplicate hoặc không còn tin nhắn cũ hơn)',
                                    //     duplicateCount: receivedCount
                                    // });
                                    setTimeout(() => resolve(), 0);
                                    return prev;
                                }
                                
                                // Nếu API trả về ít hơn số lượng yêu cầu VÀ có tin nhắn mới
                                // → Có thể đã gần hết, nhưng vẫn còn một ít
                                // → Tiếp tục load
                                // if (receivedLessThanRequested && newMessages.length > 0) {
                                //     console.log('⚠️ [fetchMessages] API trả về ít hơn yêu cầu nhưng có tin nhắn mới:', {
                                //         prevLength,
                                //         requestedCount,
                                //         receivedCount,
                                //         newMessagesLength: newMessages.length,
                                //         note: 'Có thể gần hết, nhưng vẫn tiếp tục load'
                                //     });
                                // }
                                
                                // 3. Có tin nhắn mới → Thêm tin nhắn cũ vào ĐẦU danh sách
                                const merged = [...newMessages, ...prev];
                                const sorted = sortAscByTime(merged);
                                
                                // console.log('📥 [fetchMessages] Đã tải thêm tin nhắn:', {
                                //     prevLength,
                                //     requestedCount,
                                //     receivedCount,
                                //     newMessagesCount: newMessages.length,
                                //     totalAfter: sorted.length,
                                //     duplicateCount: receivedCount - newMessages.length
                                // });
                                
                                // Resolve sau khi state update
                                setTimeout(() => resolve(), 0);
                                return sorted;
                            });
                        } else {
                            // Lần đầu tải: set tin nhắn mới nhất
                            // Kiểm tra lại conversation ID trước khi set
                            const checkConv = selectedConvoRef.current;
                            if (checkConv && checkConv.id === conversationIdAtStart) {
                                setMessages(sortedMessages);
                                // Đánh dấu còn tin nhắn nếu có tin nhắn (có thể còn tin nhắn cũ hơn)
                                setHasMoreMessages(sortedMessages.length > 0);
                                // Đánh dấu cần scroll xuống dưới
                                isInitialLoadRef.current = true;
                            } else {
                                console.log('⏭️ [fetchMessages] Conversation đã thay đổi, không set messages');
                            }
                            resolve();
                        }
                    } else {
                        // API lỗi hoặc không trả về dữ liệu
                        if (append) {
                            // Chỉ đánh dấu hết nếu API lỗi hoặc không trả về dữ liệu
                            setHasMoreMessages(false);
                            console.log('⚠️ [fetchMessages] API lỗi khi load more, đánh dấu hết tin nhắn:', {
                                ok: res?.ok,
                                error: res?.error,
                                hasItems: Array.isArray(res?.items)
                            });
                        }
                        setIsLoadingMessages(false);
                        setIsLoadingOlder(false);
                        resolve();
                        return; // Return sớm để không chạy code bên dưới
                    }
                    // Reset loading states (chỉ chạy nếu không có return ở trên)
                    setIsLoadingMessages(false);
                    setIsLoadingOlder(false);
                }
            );
        });
    }, [messages, token, pageConfig.id]);
    
    // Gán hàm vào ref để dùng trong callbacks
    fetchMessagesRef.current = fetchMessages;
    
    // ===================== Load older messages by scroll top =====================
    const loadOlderMessages = useCallback(async () => {
        const conv = selectedConvoRef.current;
        if (!conv || !socketRef.current) return;
        
        // Với INBOX type, dùng logic mới
        if (conv.type === 'INBOX') {
            // Kiểm tra điều kiện: còn tin nhắn và không đang loading (dùng refs để đọc giá trị mới nhất)
            if (!hasMoreMessagesRef.current) {
                console.log('⏸️ [loadOlderMessages] Đã hết tin nhắn, không tải thêm');
                return;
            }
            
            if (isLoadingOlderRef.current) {
                console.log('⏳ [loadOlderMessages] Đang tải, bỏ qua request mới');
                return;
            }
            
            const scroller = messagesScrollRef.current;
            if (!scroller) {
                console.warn('⚠️ [loadOlderMessages] Không tìm thấy scroll container');
                return;
            }
            
            // Lưu vị trí scroll hiện tại TRƯỚC KHI set loading state
            const scrollHeight = scroller.scrollHeight;
            const scrollTop = scroller.scrollTop;
            const currentMessagesLength = messages.length;
            
            console.log('🔄 [loadOlderMessages] Bắt đầu tải tin nhắn cũ:', {
                currentMessagesLength,
                scrollTop,
                scrollHeight,
                hasMoreMessages: hasMoreMessagesRef.current,
                isLoadingOlder: isLoadingOlderRef.current
            });
            
            setIsLoadingOlder(true);
            
            // Gọi fetchMessages với append = true
            // current_count = số tin nhắn hiện có
            fetchMessagesRef.current(currentMessagesLength, true)
                .then(() => {
                    // Khôi phục vị trí scroll sau khi load
                    // Chờ DOM update trước khi điều chỉnh scroll
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const scrollerAfter = messagesScrollRef.current;
                            if (!scrollerAfter) {
                                setIsLoadingOlder(false);
                                return;
                            }
                            
                            const newScrollHeight = scrollerAfter.scrollHeight;
                            const heightDiff = newScrollHeight - scrollHeight;
                            
                            // Giữ nguyên vị trí nhìn thấy bằng cách điều chỉnh scrollTop
                            scrollerAfter.scrollTop = scrollTop + heightDiff;
                            
                            // console.log('✅ [loadOlderMessages] Hoàn thành tải tin nhắn:', {
                            //     heightDiff,
                            //     newScrollTop: scrollerAfter.scrollTop,
                            //     newScrollHeight
                            // });
                            
                            setIsLoadingOlder(false);
                        });
                    });
                })
                .catch((err) => {
                    console.error('❌ [loadOlderMessages] Lỗi khi tải tin nhắn:', err);
                    setIsLoadingOlder(false);
                });
            
            return;
        }
        
        // Logic cũ cho COMMENT type
        if (!hasMore) return;
        
        // Lưu conversation ID để kiểm tra sau khi nhận kết quả
        const conversationIdAtStart = conv.id;
        
        setIsLoadingOlder(true);

        const nextCount = (messages?.length || 0) + 30; // mỗi lần +30
        const scroller = messagesScrollRef.current;
        const prevScrollHeight = scroller ? scroller.scrollHeight : 0;
        const prevScrollTop = scroller ? scroller.scrollTop : 0;

        // ✅ QUAN TRỌNG: Xử lý conversationId theo platform và type
        const isZalo = pageConfig?.platform === 'personal_zalo';
        const isComment = conv?.type === 'COMMENT';
        const conversationIdForRequest = isZalo || isComment
            ? conv.id  // ✅ Zalo hoặc COMMENT: giữ nguyên ID đầy đủ
            : extractConvoKey(conv.id);  // Facebook/Instagram INBOX: extract
        
        // Với một số nền tảng (ví dụ: Zalo cá nhân), conversation có thể không có customers[0].id
        // Fallback lần lượt: customers[0].id -> from.id -> from_psid
        const customerId = conv?.customers?.[0]?.id
            || conv?.from?.id
            || conv?.from_psid
            || null;
        
        socketRef.current.emit(
            'msg:get',
            { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count: nextCount },
            (res) => {
                // ✅ Kiểm tra conversation ID trước khi cập nhật
                const checkConv = selectedConvoRef.current;
                if (!checkConv || checkConv.id !== conversationIdAtStart) {
                    // console.log('⏭️ [loadOlderMessages] Conversation đã thay đổi, bỏ qua kết quả COMMENT');
                    setIsLoadingOlder(false);
                    return;
                }
                
                if (res?.ok && Array.isArray(res.items)) {
                    const incomingMessages = res.items;

                    // SỬA LỖI LOGIC 1: Điều kiện dừng tải chính xác
                    // Nếu số lượng tin nhắn API trả về BẰNG với số lượng tin nhắn đã có trước đó,
                    // có nghĩa là không có tin nhắn nào cũ hơn được tải về.
                    // "messages" ở đây là state cũ trước khi update.
                    if (incomingMessages.length === messages.length) {
                        setHasMore(false);
                    } else {
                        setHasMore(true);
                    }

                    // Cập nhật state bằng cách cộng dồn tin nhắn
                    setMessages(prevMessages => {
                        // Kiểm tra lại conversation ID một lần nữa
                        const checkConvAgain = selectedConvoRef.current;
                        if (!checkConvAgain || checkConvAgain.id !== conversationIdAtStart) {
                            console.log('⏭️ [loadOlderMessages] Conversation đã thay đổi trong setMessages, bỏ qua');
                            return prevMessages;
                        }
                        
                        const messageMap = new Map();
                        // Thêm tin nhắn mới tải về (cũ hơn về mặt thời gian)
                        incomingMessages.forEach(rawMsg => {
                            const normalized = normalizePancakeMessage(rawMsg, pageConfig.id);
                            messageMap.set(normalized.id, normalized);
                        });
                        // Thêm tin nhắn đã có
                        prevMessages.forEach(msg => {
                            if (!messageMap.has(msg.id)) {
                                messageMap.set(msg.id, msg);
                            }
                        });
                        return sortAscByTime(Array.from(messageMap.values()));
                    });

                    // SỬA LỖI UX 2: Giữ nguyên vị trí scroll sau khi tải
                    // Logic này của bạn đã đúng, giờ nó sẽ hoạt động vì không còn bị useEffect ghi đè.
                    requestAnimationFrame(() => {
                        if (!scroller) return;
                        const newScrollHeight = scroller.scrollHeight;
                        scroller.scrollTop = newScrollHeight - (prevScrollHeight - prevScrollTop);
                    });

                } else {
                    // Nếu API lỗi hoặc không trả về mảng, dừng việc tải
                    setHasMore(false);
                }
                setIsLoadingOlder(false);
            }
        );
    }, [selectedConvo, messages, token, pageConfig.id, isLoadingOlder, hasMore, hasMoreMessages]);

    // ===================== Scroll handler cho INBOX type =====================
    useEffect(() => {
        const el = messagesScrollRef.current;
        if (!el) {
            console.warn('⚠️ [handleScroll] messagesScrollRef.current is null');
            return;
        }
        
        const conv = selectedConvoRef.current;
        if (!conv) {
            console.warn('⚠️ [handleScroll] selectedConvoRef.current is null');
            return;
        }
        
        // console.log('✅ [handleScroll] Attaching scroll handler for conversation:', {
        //     conversationId: conv.id,
        //     conversationType: conv.type,
        //     hasMoreMessages: conv.type === 'INBOX' ? hasMoreMessages : hasMore
        // });
        
        // Debounce timer để tránh gọi quá nhiều lần
        let scrollTimeout = null;
        let lastLoadTime = 0;
        const DEBOUNCE_DELAY = 300; // 300ms debounce
        const MIN_LOAD_INTERVAL = 500; // Tối thiểu 500ms giữa các lần load
        
        const handleScroll = () => {
            const currentTop = el.scrollTop;
            const previousTop = lastScrollTopRef.current;
            const scrollHeight = el.scrollHeight;
            const clientHeight = el.clientHeight;

            // Với INBOX type, scroll lên gần đầu (< 100px) để load more
            // Với COMMENT type, scroll lên đầu (< 100px) để load more
            const threshold = 100;
            
            // Kiểm tra xem có đang scroll lên không
            const isScrollingUp = currentTop < previousTop;
            const isScrollingDown = currentTop > previousTop;
            
            // Cập nhật trạng thái near bottom
            if (isScrollingUp && isNearBottomRef.current) {
                isNearBottomRef.current = false;
                setIsNearBottom(false);
            }

            // Reset flag khi scroll xuống hoặc khi scrollTop tăng (đã scroll xuống khỏi vùng trigger)
            if (isScrollingDown || currentTop > threshold + 50) {
                hasTriggeredLoadRef.current = false;
            }

            lastScrollTopRef.current = currentTop;
            
            // ✅ QUAN TRỌNG: Trigger load khi:
            // 1. ScrollTop <= threshold (gần đầu) - không cần kiểm tra scroll direction
            // 2. Chưa trigger load (hasTriggeredLoadRef.current = false)
            // 3. Còn tin nhắn và không đang loading
            if (currentTop <= threshold && !hasTriggeredLoadRef.current) {
                // Với INBOX type, dùng hasMoreMessagesRef
                // Với COMMENT type, dùng hasMoreRef
                // Sử dụng refs để đọc giá trị mới nhất
                const canLoadMore = conv?.type === 'INBOX' 
                    ? hasMoreMessagesRef.current && !isLoadingOlderRef.current
                    : hasMoreRef.current && !isLoadingOlderRef.current;
                
                if (canLoadMore) {
                    const now = Date.now();
                    // Kiểm tra thời gian giữa các lần load
                    if (now - lastLoadTime < MIN_LOAD_INTERVAL) {
                        return;
                    }
                    
                    // Clear timeout cũ nếu có
                    if (scrollTimeout) {
                        clearTimeout(scrollTimeout);
                    }
                    
                    // Debounce: đợi một chút trước khi load
                    scrollTimeout = setTimeout(() => {
                        // Kiểm tra lại điều kiện trước khi load (có thể đã thay đổi trong lúc debounce)
                        const checkConv = selectedConvoRef.current;
                        const checkEl = messagesScrollRef.current;
                        if (!checkConv || !checkEl) return;
                        
                        const checkTop = checkEl.scrollTop;
                        
                        // Sử dụng refs để đọc giá trị mới nhất
                        const checkCanLoad = checkConv?.type === 'INBOX' 
                            ? hasMoreMessagesRef.current && !isLoadingOlderRef.current
                            : hasMoreRef.current && !isLoadingOlderRef.current;
                        
                        // Chỉ cần kiểm tra: ở gần đầu, có thể load, và chưa trigger
                        if (checkTop <= threshold && checkCanLoad && !hasTriggeredLoadRef.current) {
                            // console.log('📜 [handleScroll] Phát hiện scroll đến đầu, trigger load more:', {
                            //     currentTop: checkTop,
                            //     threshold,
                            //     scrollHeight: checkEl.scrollHeight,
                            //     clientHeight: checkEl.clientHeight,
                            //     hasMoreMessages: checkConv?.type === 'INBOX' ? hasMoreMessagesRef.current : hasMoreRef.current,
                            //     isLoadingOlder: isLoadingOlderRef.current,
                            //     conversationId: checkConv?.id,
                            //     conversationType: checkConv?.type
                            // });
                            lastLoadTime = Date.now();
                            hasTriggeredLoadRef.current = true; // Đánh dấu đã trigger
                            loadOlderMessages().then(() => {
                                // Reset flag sau khi load xong để có thể load tiếp
                                setTimeout(() => {
                                    hasTriggeredLoadRef.current = false;
                                }, 1000); // Đợi 1s sau khi load xong mới cho phép load tiếp
                            }).catch(() => {
                                // Nếu lỗi, reset flag ngay
                                hasTriggeredLoadRef.current = false;
                            });
                        }
                    }, DEBOUNCE_DELAY);
                } else {
                    // Log để debug
                    if (conv?.type === 'INBOX' && !hasMoreMessagesRef.current && currentTop <= 10) {
                        console.log('⏸️ [handleScroll] Đã hết tin nhắn, không tải thêm');
                    } else if (isLoadingOlderRef.current && currentTop <= 10) {
                        console.log('⏳ [handleScroll] Đang tải tin nhắn, chờ...');
                    }
                }
            }

            // Cập nhật trạng thái near bottom
            const distanceFromBottom = scrollHeight - currentTop - clientHeight;
            const nearBottom = distanceFromBottom < 40;

            if (isNearBottomRef.current !== nearBottom) {
                isNearBottomRef.current = nearBottom;
                setIsNearBottom(nearBottom);
            }
        };

        // ✅ KHÔNG gọi handleScroll() khi mount để tránh load tự động
        // Chỉ load khi user thực sự scroll

        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            el.removeEventListener('scroll', handleScroll);
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }, [loadOlderMessages, selectedConvo, hasMoreMessages, hasMore, isLoadingOlder]);
    
    // ===================== Quản lý scroll position cho INBOX type =====================
    useEffect(() => {
        const conv = selectedConvoRef.current;
        if (!conv || conv.type !== 'INBOX') return;
        
        if (isInitialLoadRef.current && messages.length > 0) {
            // Lần đầu load → scroll xuống dưới
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            isInitialLoadRef.current = false;
        } else if (shouldScrollToBottomRef.current && messages.length > 0) {
            // Tin nhắn mới từ socket → scroll xuống dưới
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            shouldScrollToBottomRef.current = false;
        }
        // KHÔNG scroll khi load more (giữ nguyên vị trí)
    }, [messages.length, selectedConvo]);

    // ===================== Handlers =====================
    const handleSelectConvo = useCallback(
        async (conversation) => {
            // console.log('🎯 [ChatClient] handleSelectConvo called:', {
            //     conversationId: conversation?.id,
            //     conversationType: conversation?.type,
            //     currentSelectedId: selectedConvo?.id,
            //     isSame: selectedConvo?.id === conversation.id
            // });
            
            if (selectedConvo?.id === conversation.id) {
                console.log('⏭️ [ChatClient] Same conversation, skipping');
                return;
            }

            const s = socketRef.current;
            // console.log('🔌 [ChatClient] Socket check:', {
            //     hasSocket: !!s,
            //     socketConnected: s?.connected,
            //     socketId: s?.id
            // });
            
            if (!s) {
                console.error('❌ [ChatClient] No socket available!');
                toast.error('Socket chưa kết nối. Vui lòng đợi...');
                return;
            }
            
            if (!s.connected) {
                console.error('❌ [ChatClient] Socket not connected!');
                toast.error('Socket chưa kết nối. Vui lòng đợi...');
                return;
            }

            // dừng watcher cũ (nếu có)
            if (selectedConvo?.id) {
                s.emit('msg:watchStop', { pageId: pageConfig.id, conversationId: selectedConvo.id });
            }

            // ✅ QUAN TRỌNG: Clear messages và reset state TRƯỚC KHI set selectedConvo
            // Điều này đảm bảo UI không hiển thị messages của conversation cũ
            setMessages([]);
            setHasMore(true); // reset state load-more cho COMMENT
            setHasMoreMessages(true); // reset state load-more cho INBOX
            setIsLoadingMessages(true);
            setIsLoadingOlder(false); // Reset loading state
            isNearBottomRef.current = true;
            setIsNearBottom(true);
            lastScrollTopRef.current = 0;
            isInitialLoadRef.current = conversation?.type === 'INBOX'; // Reset cho INBOX type
            isInitialFetchRef.current = false; // Reset flag để cho phép fetch lần đầu
            hasTriggeredLoadRef.current = false; // Reset flag để cho phép trigger load khi scroll

            // Tìm conversation object đầy đủ hơn từ state hiện tại
            const richer = conversations.find((c) => c.id === conversation.id) 
                || conversations.find((c) => extractConvoKey(c.id) === extractConvoKey(conversation.id));
            
            const finalConversation = richer ? { ...richer, ...conversation } : conversation;
            
            // ✅ QUAN TRỌNG: Update ref TRƯỚC KHI set state để đảm bảo fetchMessages dùng đúng conversation
            selectedConvoRef.current = finalConversation;
            
            // set UI & tải messages 1 lần
            setSelectedConvo(finalConversation);
            
            // ✅ Với INBOX type, dùng logic mới
            if (conversation?.type === 'INBOX') {
                // ✅ QUAN TRỌNG: Chỉ gọi fetchMessages 1 lần ban đầu
                // Kiểm tra flag để tránh gọi nhiều lần
                // Sử dụng setTimeout để đảm bảo state đã được update
                setTimeout(() => {
                    const checkConv = selectedConvoRef.current;
                    if (!checkConv || checkConv.id !== finalConversation.id) {
                        console.warn('⚠️ [handleSelectConvo] Conversation đã thay đổi trước khi fetch');
                        return;
                    }
                    
                    if (!isInitialFetchRef.current) {
                        isInitialFetchRef.current = true; // Đánh dấu đã fetch
                        // console.log('📥 [handleSelectConvo] Gọi fetchMessages lần đầu cho INBOX:', {
                        //     conversationId: finalConversation.id,
                        //     conversationType: finalConversation.type
                        // });
                        // Gọi fetchMessages không có currentCount (lần đầu tải)
                        fetchMessagesRef.current(null, false);
                    } else {
                        console.warn('⚠️ [handleSelectConvo] fetchMessages đã được gọi, bỏ qua');
                    }
                }, 0);
                
                // Bật watcher realtime
                const isZalo = pageConfig?.platform === 'personal_zalo';
                const conversationIdForRequest = isZalo
                    ? finalConversation.id
                    : extractConvoKey(finalConversation.id);
                
                const customerId = finalConversation?.customers?.[0]?.id
                    || finalConversation?.from?.id
                    || finalConversation?.from_psid
                    || null;
                
                s.emit(
                    'msg:watchStart',
                    { 
                        pageId: pageConfig.id, 
                        token, 
                        conversationId: conversationIdForRequest,
                        customerId: customerId || null, 
                        count: 0, 
                        intervalMs: 2500 
                    },
                    (ack) => {
                        if (!ack?.ok) {
                            console.error('[msg:watchStart] error:', ack?.error);
                        }
                    }
                );
                return;
            }

            // ✅ QUAN TRỌNG: Xử lý conversationId theo platform và type
            // - Zalo (pzl_*): giữ nguyên conversation.id
            // - COMMENT type: server sẽ extract, nên cần gửi ID đầy đủ (server sẽ extract đúng)
            const isZalo = pageConfig?.platform === 'personal_zalo';
            const isComment = finalConversation?.type === 'COMMENT';
            // Với COMMENT, giữ nguyên ID đầy đủ vì server sẽ extract và build URL đúng
            const conversationIdForRequest = isZalo
                ? finalConversation.id  // ✅ Zalo: giữ nguyên ID đầy đủ
                : isComment
                    ? finalConversation.id  // ✅ COMMENT: giữ nguyên để server extract đúng
                    : extractConvoKey(finalConversation.id);  // Facebook/Instagram INBOX: extract "123456789"
            
            // Với Zalo cá nhân và một số nguồn, không có customers[0].id -> dùng from.id hoặc from_psid
            // Đối với Zalo, có thể không cần customerId để tải tin nhắn
            const customerId = finalConversation?.customers?.[0]?.id
                || finalConversation?.from?.id
                || finalConversation?.from_psid
                || null;
            
            // console.log('📤 [ChatClient] Loading messages:', {
            //     platform: pageConfig?.platform,
            //     conversationType: finalConversation?.type,
            //     conversationId: finalConversation.id,
            //     conversationIdForRequest,
            //     isZalo,
            //     isComment,
            //     customerId,
            //     postId: finalConversation?.post_id,
            //     threadId: finalConversation?.thread_id,
            //     fullConversation: finalConversation // Log toàn bộ conversation để debug
            // });
            
            // Với COMMENT type, vẫn gọi msg:get nhưng có thể cần format khác
            // API messages có thể trả về comments dưới dạng messages
            const emitParams = {
                pageId: pageConfig.id, 
                token, 
                conversationId: conversationIdForRequest,
                customerId: customerId || null, 
                count: 0 
            };
            
            // console.log('📡 [ChatClient] Emitting msg:get with params:', emitParams);
            // console.log('📡 [ChatClient] Expected URL format:', 
            //     `https://pancake.vn/api/v1/pages/${pageConfig.id}/conversations/${conversationIdForRequest}/messages?customer_id=${customerId || ''}&access_token=${token?.substring(0, 20)}...&user_view=true&is_new_api=true&separate_pos=true`
            // );
            
            // Lưu conversation ID để kiểm tra sau khi nhận kết quả
            const conversationIdAtStart = finalConversation.id;
            
            s.emit(
                'msg:get',
                emitParams,
                (res) => {
                    // ✅ Kiểm tra conversation ID trước khi cập nhật
                    const checkConv = selectedConvoRef.current;
                    if (!checkConv || checkConv.id !== conversationIdAtStart) {
                        // console.log('⏭️ [ChatClient] Conversation đã thay đổi, bỏ qua kết quả COMMENT');
                        setIsLoadingMessages(false);
                        return;
                    }
                    
                    // console.log('📥 [ChatClient] Messages response (raw):', res);
                    // console.log('📥 [ChatClient] Messages response (summary):', {
                    //     ok: res?.ok,
                    //     itemsCount: res?.items?.length || 0,
                    //     error: res?.error,
                    //     isComment,
                    //     hasItems: Array.isArray(res?.items),
                    //     firstItem: res?.items?.[0] ? {
                    //         id: res.items[0].id,
                    //         type: res.items[0].type,
                    //         message: res.items[0].message,
                    //         original_message: res.items[0].original_message,
                    //         from: res.items[0].from,
                    //         inserted_at: res.items[0].inserted_at
                    //     } : null
                    // });
                    
                    if (res?.ok && Array.isArray(res.items)) {
                        // Kiểm tra lại conversation ID một lần nữa
                        const checkConvAgain = selectedConvoRef.current;
                        if (!checkConvAgain || checkConvAgain.id !== conversationIdAtStart) {
                            console.log('⏭️ [ChatClient] Conversation đã thay đổi trong xử lý, bỏ qua');
                            setIsLoadingMessages(false);
                            return;
                        }
                        
                        // console.log('📋 [ChatClient] Raw items before normalization:', res.items.slice(0, 3)); // Log 3 items đầu
                        
                        // Với COMMENT type, filter các comment đã bị remove
                        let itemsToProcess = res.items;
                        if (isComment) {
                            itemsToProcess = res.items.filter(item => !item.is_removed);
                            // console.log('📋 [ChatClient] Filtered removed comments:', {
                            //     total: res.items.length,
                            //     afterFilter: itemsToProcess.length,
                            //     removed: res.items.length - itemsToProcess.length
                            // });
                        }
                        
                        // Normalize messages/comments
                        const normalized = sortAscByTime(
                            itemsToProcess.map((m) => normalizePancakeMessage(m, pageConfig.id))
                        );
                        // console.log('✅ [ChatClient] Normalized messages/comments:', normalized.length);
                        // console.log('📋 [ChatClient] Normalized items (first 3):', normalized.slice(0, 3));
                        setMessages(normalized);
                        setHasMore(itemsToProcess.length > 0);
                        if (isNearBottomRef.current) {
                            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                        }
                    } else if (res?.error) {
                        console.error('❌ [ChatClient] msg:get error:', res.error);
                        console.error('❌ [ChatClient] Full error response:', res);
                        // Với COMMENT type, có thể không có messages nhưng có comments
                        if (isComment) {
                            console.warn('⚠️ [ChatClient] COMMENT type không có messages, có thể cần gọi API comments riêng');
                            console.warn('⚠️ [ChatClient] Conversation details:', {
                                id: conversation.id,
                                post_id: conversation.post_id,
                                thread_id: conversation.thread_id,
                                snippet: conversation.snippet
                            });
                        }
                        toast.error(`Không thể tải ${isComment ? 'bình luận' : 'tin nhắn'}: ${res.error}`);
                    } else {
                        console.warn('⚠️ [ChatClient] Response không hợp lệ:', res);
                        if (isComment && (!res?.items || res.items.length === 0)) {
                            console.warn('⚠️ [ChatClient] COMMENT type không có dữ liệu');
                            console.warn('⚠️ [ChatClient] Conversation object:', conversation);
                            console.warn('⚠️ [ChatClient] Request params:', {
                                pageId: pageConfig.id,
                                conversationId: conversationIdForRequest,
                                customerId
                            });
                        }
                    }
                    setIsLoadingMessages(false);
                }
            );

            // bật watcher realtime cho hội thoại này
            // Với Zalo, sử dụng conversationId gốc
            s.emit(
                'msg:watchStart',
                { 
                    pageId: pageConfig.id, 
                    token, 
                    conversationId: conversationIdForRequest,  // ✅ Gửi ID gốc cho Zalo
                    customerId: customerId || null, 
                    count: 0, 
                    intervalMs: 2500 
                },
                (ack) => {
                    if (!ack?.ok) {
                        console.error('[msg:watchStart] error:', ack?.error);
                        // Không block UI nếu watchStart thất bại
                    }
                }
            );
        },
        [pageConfig.id, token, selectedConvo?.id]
    );

    // ===================== Preselect matching logic =====================
    useEffect(() => {
        // Only run for Zalo personal and when preselect provided and nothing selected yet
        if (!preselect || selectedConvoRef.current || !Array.isArray(conversations) || conversations.length === 0) return;
        if (String(pageConfig?.platform) !== 'personal_zalo') return;

        const trySelect = (convo, context = {}) => {
            if (!convo) return false;
            const convoName = convo?.customers?.[0]?.name || convo?.from?.name || 'Unknown';
            // console.log('✅ [Preselect Match] Selecting conversation:', {
            //     id: convo.id,
            //     name: convoName,
            //     ...context,
            // });
            handleSelectConvo(convo);
            return true;
        };

        const preselectUidRaw = typeof preselect.uid === 'string' ? preselect.uid.trim() : null;
        const preselectUid = preselectUidRaw ? preselectUidRaw.replace(/\s+/g, '') : null;
        if (preselectUid) {
            const expectedById = `pzl_u_${pageConfig.id}_${preselectUid}`;
            const matchedByUid = conversations.find((convo) => {
                const convoUid = getZaloUidFromConversation(convo);
                const convoId = String(convo?.id || '');
                const fbId = String(convo?.customers?.[0]?.fb_id || '');
                return (
                    convoUid === preselectUid ||
                    convoId === expectedById ||
                    fbId === expectedById
                );
            });

            if (trySelect(matchedByUid, { reason: 'uid-match', uid: preselectUid })) return;
        }

        const prePhones = (Array.isArray(preselect.phones) ? preselect.phones : [preselect.phone])
            .filter(Boolean)
            .map((p) => normalizePhone(p))
            .filter(Boolean);
        const prePhone = prePhones[0] || null;
        const preNameNormalized = stripDiacritics(preselect.name);
        const preNameParts = preNameNormalized.split(/\s+/).filter(Boolean);

        const scoreConvo = (convo) => {
            const phones = extractPhonesFromConvo(convo);
            const convoName = convo?.customers?.[0]?.name || convo?.from?.name || '';
            const convoNameNormalized = stripDiacritics(convoName);
            const convoNameParts = convoNameNormalized.split(/\s+/).filter(Boolean);

            // Priority 1: Phone exact match (highest priority)
            if (prePhone && phones.length > 0 && phones.includes(prePhone)) {
                return 1000;
            }

            // Priority 2: Full name exact match (after normalize)
            if (preNameNormalized && convoNameNormalized && preNameNormalized === convoNameNormalized) {
                return 900;
            }

            // Priority 3: First + Last name match (if name has 2+ parts)
            if (preNameParts.length >= 2 && convoNameParts.length >= 2) {
                const preFirstLast = `${preNameParts[0]} ${preNameParts[preNameParts.length - 1]}`;
                const convoFirstLast = `${convoNameParts[0]} ${convoNameParts[convoNameParts.length - 1]}`;
                if (preFirstLast === convoFirstLast) {
                    return 850;
                }
            }

            // Priority 4: All words match (but not necessarily in same order) - only if 3+ words
            if (preNameParts.length >= 3 && convoNameParts.length >= 3) {
                const preSet = new Set(preNameParts);
                const convoSet = new Set(convoNameParts);
                const intersection = new Set([...preSet].filter(x => convoSet.has(x)));
                // If all words from customer name are found in convo name
                if (intersection.size === preNameParts.length && preNameParts.length === convoNameParts.length) {
                    return 750;
                }
            }

            // Priority 5: Partial match with at least 2 consecutive words
            if (preNameParts.length >= 2) {
                // Try to find consecutive words from customer name in conversation name
                for (let i = 0; i <= preNameParts.length - 2; i++) {
                    const twoWords = `${preNameParts[i]} ${preNameParts[i + 1]}`;
                    if (convoNameNormalized.includes(twoWords)) {
                        return 600;
                    }
                }
            }

            return 0;
        };

        let best = null;
        let bestScore = 0;
        const scored = [];
        for (const c of conversations) {
            const sc = scoreConvo(c);
            if (sc > 0) {
                scored.push({
                    id: c.id,
                    name: c?.customers?.[0]?.name || c?.from?.name || 'Unknown',
                    score: sc
                });
            }
            if (sc > bestScore) {
                best = c;
                bestScore = sc;
            }
        }

        // console.log('🔍 [Preselect Match] Looking for:', {
        //     customerName: preselect.name,
        //     normalized: preNameNormalized,
        //     phone: prePhone,
        //     nameParts: preNameParts
        // });
        // console.log('🔍 [Preselect Match] Scored conversations:', scored.sort((a, b) => b.score - a.score).slice(0, 5));
        // console.log('🔍 [Preselect Match] Best match:', best ? {
        //     id: best.id,
        //     name: best?.customers?.[0]?.name || best?.from?.name || 'Unknown',
        //     score: bestScore
        // } : 'None');

        // Only select if score is high enough (at least partial match with 2+ words)
        if (bestScore >= 600 && trySelect(best, { reason: 'score-match', score: bestScore })) return;

        // Fallback: conv:search across Pancake - only use phone or full name
        const s = socketRef.current;
        if (!s) return;
        const queries = [];
        if (prePhone) {
            queries.push(prePhone);
        } else if (preNameNormalized) {
            // Only search with full name if no phone
            queries.push(preNameNormalized);
        }
        if (queries.length === 0) return;
        
        s.emit('conv:search', { pageId: pageConfig.id, token, q: queries[0] }, (ack) => {
            if (ack?.ok && Array.isArray(ack.items)) {
                const items = ack.items.filter(isInbox);
                // pick best by same scoring
                let b = null; let bs = 0;
                for (const it of items) {
                    const sc = scoreConvo(it);
                    if (sc > bs) { b = it; bs = sc; }
                }
                // Only select if score is high enough
                if (b && bs >= 600) trySelect(b);
            }
        });
    }, [preselect, conversations, pageConfig?.id, pageConfig?.platform, token, handleSelectConvo, extractPhonesFromConvo, stripDiacritics, normalizePhone]);

    const triggerPickImage = useCallback(() => {
        if (!selectedConvo) {
            toast.warning('Hãy chọn một hội thoại trước khi đính kèm ảnh.');
            return;
        }
        fileInputRef.current?.click();
    }, [selectedConvo]);

    const onPickImage = useCallback(async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setIsUploadingImage(true);

        const readAsDataUrl = (file) => new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            } catch (err) { reject(err); }
        });

        try {
            for (const f of files) {
                const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                // 1) Show preview immediately
                try {
                    const dataUrl = await readAsDataUrl(f);
                    setPendingImages((prev) => [...prev, { id: null, url: String(dataUrl), localId }]);
                } catch (_) {
                    setPendingImages((prev) => [...prev, { id: null, url: '', localId }]);
                }
                // 2) Upload lên Pancake CDN; store returned id và content_url cho sending
                try {
                    const res = await uploadImageToDriveAction(f, pageConfig.id, token);
                    if (!res?.success) {
                        toast.error(`Tải ảnh thất bại: ${res?.error || ''}`);
                        continue;
                    }
                    // Lưu content_id (hoặc id), content_url, và image_data từ Pancake CDN
                    setPendingImages((prev) => prev.map((it) => 
                        it.localId === localId 
                            ? { 
                                ...it, 
                                id: res.id || res.content_id, // content_id từ Pancake
                                url: res.content_url || res.url, // URL từ Pancake CDN
                                content_url: res.content_url,
                                image_data: res.image_data // {width, height}
                            } 
                            : it
                    ));
                    // console.log('✅ [onPickImage] Upload thành công:', {
                    //     id: res.id || res.content_id,
                    //     content_url: res.content_url,
                    //     image_data: res.image_data
                    // });
                } catch (err) {
                    toast.error(`Tải ảnh thất bại: ${err?.message || ''}`);
                }
            }
            if (fileInputRef.current) fileInputRef.current.value = '';
        } finally {
            setIsUploadingImage(false);
        }
    }, [pageConfig.id, token]);

    const removePendingImage = useCallback((localId) => {
        setPendingImages((prev) => prev.filter((x) => x.localId !== localId));
    }, []);

    const handleSendMessage = async (formData) => {
        // console.log('=== SENDING MESSAGE ===');
        // console.log('FormData:', formData);
        // console.log('Selected conversation:', selectedConvo);
        // console.log('PageConfig:', pageConfig);
        
        if (!selectedConvo) {
            console.log('❌ No selected conversation');
            return;
        }
        
        const text = (formData.get('message') || '').trim();
        const hasImages = pendingImages.length > 0;
        // console.log('Message text:', text);
        // console.log('Has images:', hasImages);
        
        if (!text && !hasImages) {
            console.log('❌ No text or images to send');
            return;
        }

        // Optimistic UI - chỉ hiển thị loading state, không tạo tin nhắn tạm
        const now = new Date().toISOString();
        const optimisticEntries = [];
        if (hasImages) {
            const optimisticIdImages = `optimistic-img-${Date.now()}`;
            optimisticEntries.push({
                id: optimisticIdImages,
                inserted_at: now,
                senderType: 'page',
                status: 'sending',
                content: {
                    type: 'images',
                    images: pendingImages.map((p) => ({ url: p.url })),
                },
            });
        }
        if (text) {
            const optimisticIdText = `optimistic-text-${Date.now()}`;
            optimisticEntries.push({
                id: optimisticIdText,
                inserted_at: now,
                senderType: 'page',
                status: 'sending',
                content: { type: 'text', content: text },
            });
        }
        // Chỉ thêm optimistic entries nếu không có tin nhắn nào đang gửi
        if (optimisticEntries.length) {
            setMessages((prev) => {
                const hasSendingMessages = prev.some(m => m.status === 'sending');
                if (hasSendingMessages) {
                    // Nếu đã có tin nhắn đang gửi, không thêm optimistic entries
                    return prev;
                }
                return sortAscByTime([...prev, ...optimisticEntries]);
            });
        }

        // Gửi thật
        // console.log('🚀 Sending message to server...');
        let overallOk = true;
        let lastError = null;
        try {
            if (hasImages) {
                // console.log('📷 Sending image message...');
                // Với COMMENT type, cần tìm message_id của comment muốn reply
                let replyToMessageId = null;
                if (selectedConvo?.type === 'COMMENT') {
                    // Tìm comment mới nhất từ customer (parent comment)
                    const customerComments = messages
                        .filter(m => {
                            return m.senderType === 'customer' && 
                                   !m.is_removed && 
                                   (m.is_parent !== false);
                        })
                        .sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at));
                    
                    if (customerComments.length > 0) {
                        replyToMessageId = customerComments[0].id;
                        // console.log('📝 [COMMENT] Replying to message_id:', replyToMessageId);
                    } else {
                        // Fallback: tìm bất kỳ comment nào từ customer
                        const anyCustomerComment = messages
                            .filter(m => m.senderType === 'customer' && !m.is_removed)
                            .sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at))[0];
                        
                        if (anyCustomerComment) {
                            replyToMessageId = anyCustomerComment.id;
                            // console.log('📝 [COMMENT] Using any customer comment as fallback:', replyToMessageId);
                        } else {
                            console.warn('⚠️ [COMMENT] No customer comments found to reply to');
                            toast.error('Không tìm thấy comment để reply. Vui lòng thử lại.');
                            overallOk = false;
                            lastError = 'NO_COMMENT_TO_REPLY';
                        }
                    }
                }
                
                if (selectedConvo?.type === 'COMMENT' && !replyToMessageId) {
                    // Không thể gửi nếu không có message_id
                    return;
                }
                
                const first = pendingImages[0];
                // console.log('📷 [handleSendMessage] Sending image with data:', {
                //     id: first.id,
                //     content_url: first.content_url,
                //     url: first.url,
                //     image_data: first.image_data,
                //     conversationId: selectedConvo.id,
                //     conversationType: selectedConvo?.type || 'INBOX'
                // });
                
                const res1 = await sendImageAction(
                    pageConfig.id,
                    token, // Dùng token từ props
                    selectedConvo.id,
                    first.id,
                    text || '',
                    selectedConvo?.type || 'INBOX',
                    replyToMessageId,
                    selectedConvo?.post_id || null,
                    first.content_url || first.url, // Ưu tiên content_url từ Pancake CDN
                    first.image_data // Truyền image_data từ upload response
                );
                // console.log('📷 [handleSendMessage] Image send result:', res1);
                if (!res1?.success) {
                    overallOk = false;
                    lastError = res1?.error || 'SEND_IMAGE_FAILED';
                    toast.error(`Gửi ảnh thất bại: ${res1?.error || 'Lỗi không xác định'}`);
                }
                for (let i = 1; i < pendingImages.length; i++) {
                    const it = pendingImages[i];
                    const r = await sendImageAction(
                        pageConfig.id,
                        token, // Dùng token từ props
                        selectedConvo.id,
                        it.id,
                        '',
                        selectedConvo?.type || 'INBOX',
                        replyToMessageId,
                        selectedConvo?.post_id || null,
                        it.content_url || it.url, // Ưu tiên content_url từ Pancake CDN
                        it.image_data // Truyền image_data từ upload response
                    );
                    console.log(`📷 Additional image ${i} send result:`, r);
                    if (!r?.success) {
                        overallOk = false;
                        lastError = r?.error || 'SEND_IMAGE_FAILED';
                    }
                }
            } else if (text) {
                // console.log('💬 Sending text message...');
                // Với COMMENT type, cần tìm message_id của comment muốn reply
                // Reply vào comment mới nhất từ customer (parent comment, không phải reply)
                let replyToMessageId = null;
                if (selectedConvo?.type === 'COMMENT') {
                    // Tìm comment mới nhất từ customer (parent comment, is_parent = true)
                    // Ưu tiên comment chưa bị remove và là parent comment
                    const customerComments = messages
                        .filter(m => {
                            // Lọc comments từ customer, chưa bị remove, và là parent comment
                            const isCustomer = m.senderType === 'customer';
                            const notRemoved = !m.is_removed;
                            const isParent = m.is_parent !== false; // Ưu tiên parent comments
                            return isCustomer && notRemoved && isParent;
                        })
                        .sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at));
                    
                    // console.log('🔍 [COMMENT] Finding comment to reply:', {
                    //     totalMessages: messages.length,
                    //     customerComments: customerComments.length,
                    //     sampleIds: customerComments.slice(0, 3).map(c => ({ id: c.id || c.rawId, is_parent: c.is_parent }))
                    // });
                    
                    if (customerComments.length > 0) {
                        // Sử dụng rawId nếu có (ID gốc từ API), nếu không dùng id
                        replyToMessageId = customerComments[0].rawId || customerComments[0].id;
                        // console.log('📝 [COMMENT] Replying to message_id:', replyToMessageId, {
                        //     commentId: customerComments[0].id,
                        //     rawId: customerComments[0].rawId,
                        //     original_message: customerComments[0].content?.content,
                        //     is_parent: customerComments[0].is_parent,
                        //     from: customerComments[0].from
                        // });
                    } else {
                        // Nếu không có parent comment, thử tìm bất kỳ comment nào từ customer
                        const anyCustomerComment = messages
                            .filter(m => m.senderType === 'customer' && !m.is_removed)
                            .sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at))[0];
                        
                        if (anyCustomerComment) {
                            replyToMessageId = anyCustomerComment.rawId || anyCustomerComment.id;
                            console.log('📝 [COMMENT] Using any customer comment as fallback:', replyToMessageId);
                        } else {
                            console.warn('⚠️ [COMMENT] No customer comments found to reply to');
                            console.warn('⚠️ [COMMENT] Available messages:', messages.map(m => ({
                                id: m.id,
                                rawId: m.rawId,
                                senderType: m.senderType,
                                is_removed: m.is_removed,
                                is_parent: m.is_parent
                            })));
                            toast.error('Không tìm thấy comment để reply. Vui lòng thử lại.');
                            overallOk = false;
                            lastError = 'NO_COMMENT_TO_REPLY';
                        }
                    }
                }
                
                if (selectedConvo?.type === 'COMMENT' && !replyToMessageId) {
                    // Không thể gửi nếu không có message_id
                    console.error('❌ [COMMENT] Cannot send: missing message_id');
                    return;
                }
                
                // console.log('📤 [COMMENT] Sending with params:', {
                //     conversationType: selectedConvo?.type,
                //     replyToMessageId,
                //     hasMessageId: !!replyToMessageId,
                //     conversationId: selectedConvo.id
                // });
                
                const r = await sendMessageAction(
                    pageConfig.id,
                    pageConfig.accessToken,
                    selectedConvo.id,
                    text,
                    selectedConvo?.type || 'INBOX',
                    replyToMessageId,
                    selectedConvo?.post_id || null
                );
                if (!r?.success) {
                    overallOk = false;
                    lastError = r?.error || 'SEND_TEXT_FAILED';
                }
            }
        } catch (e) {
            overallOk = false;
            lastError = e?.message || 'SEND_FAILED';
        }
        

        // Xử lý optimistic entries và refresh messages sau khi gửi
        if (overallOk) {
            // Refresh messages ngay sau khi gửi thành công để hiển thị tin nhắn mới
            const s = socketRef.current;
            if (s && selectedConvo) {
                const isZalo = pageConfig?.platform === 'personal_zalo';
                const isComment = selectedConvo?.type === 'COMMENT';
                const conversationIdForRequest = isZalo || isComment
                    ? selectedConvo.id
                    : extractConvoKey(selectedConvo.id);
                
                const customerId = selectedConvo?.customers?.[0]?.id
                    || selectedConvo?.from?.id
                    || selectedConvo?.from_psid
                    || null;
                
                // console.log('🔄 [handleSendMessage] Refreshing messages after successful send:', {
                //     conversationIdForRequest,
                //     isComment,
                //     isZalo
                // });
                
                // Đợi một chút để server xử lý xong, rồi refresh
                setTimeout(() => {
                    s.emit(
                        'msg:get',
                        { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count: 0 },
                        (res) => {
                            // console.log('📥 [handleSendMessage] Refresh response:', {
                            //     ok: res?.ok,
                            //     itemsCount: res?.items?.length || 0
                            // });
                            
                            if (res?.ok && Array.isArray(res.items)) {
                                // Với COMMENT type, filter các comment đã bị remove
                                let itemsToProcess = res.items;
                                if (isComment) {
                                    itemsToProcess = res.items.filter(item => !item.is_removed);
                                }
                                
                                const normalized = sortAscByTime(
                                    itemsToProcess.map((m) => normalizePancakeMessage(m, pageConfig.id))
                                );
                                
                                // Xóa optimistic entries và cập nhật với tin nhắn mới
                                setMessages((prev) => {
                                    const optimisticIds = optimisticEntries.map(o => o.id);
                                    const now = Date.now();
                                    const oneMinuteAgo = now - 60000;
                                    
                                    // Lọc bỏ optimistic entries
                                    const withoutOptimistic = prev.filter(m => {
                                        const isOptimistic = optimisticIds.includes(m.id);
                                        const isSending = m.status === 'sending';
                                        const isRecent = m.inserted_at && new Date(m.inserted_at).getTime() > oneMinuteAgo;
                                        return !isOptimistic && !(isSending && isRecent);
                                    });
                                    
                                    // Merge với tin nhắn mới
                                    const allMessages = [...withoutOptimistic, ...normalized];
                                    const uniqueMessages = [];
                                    const seenIds = new Set();
                                    
                                    for (const msg of sortAscByTime(allMessages)) {
                                        if (msg.id && !seenIds.has(msg.id)) {
                                            seenIds.add(msg.id);
                                            uniqueMessages.push(msg);
                                        } else if (!msg.id) {
                                            uniqueMessages.push(msg);
                                        }
                                    }
                                    
                                    // console.log('✅ [handleSendMessage] Updated messages:', {
                                    //     before: prev.length,
                                    //     after: uniqueMessages.length,
                                    //     optimisticRemoved: optimisticIds.length
                                    // });
                                    
                                    return sortAscByTime(uniqueMessages);
                                });
                                
                                if (isNearBottomRef.current) {
                                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                                }
                            }
                        }
                    );
                }, 500); // Đợi 500ms để server xử lý xong
            }
        } else {
            // Nếu gửi thất bại, cập nhật status của optimistic entries
            setMessages((prev) =>
                prev.map((m) => {
                    if (optimisticEntries.find((o) => o.id === m.id)) {
                        return { ...m, status: 'failed', error: lastError };
                    }
                    return m;
                })
            );
        }

        if (overallOk) {
            setConversations((prev) => {
                const updated = {
                    ...selectedConvo,
                    snippet: text ? text : '[Ảnh]',
                    updated_at: new Date().toISOString(),
                    last_sent_by: {
                        id: pageConfig.id,
                        name: pageConfig.name,
                        email: `${pageConfig.id}@pancake`,
                    },
                };
                const merged = mergeConversations(prev, [updated]);
                return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            });
            setPendingImages([]);
            formRef.current?.reset();
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            
        } else {
            toast.error(lastError || 'Gửi thất bại');
        }
    };

    // ===================== Search (qua socket) =====================
    const runSearch = useCallback(() => {
        const q = (searchInput || '').trim();
        if (!q) return;
        const s = socketRef.current;
        if (!s) return;
        setIsSearching(true);
        s.emit('conv:search', { pageId: pageConfig.id, token, q }, (ack) => {
            if (ack?.ok && Array.isArray(ack.items)) {
                setSearchResults(ack.items.filter(isInbox));
            } else if (ack?.error) {
                toast.error('Tìm kiếm thất bại');
                console.error('[conv:search] error:', ack.error);
            }
        });
    }, [searchInput, pageConfig.id, token]);

    const clearSearch = useCallback(() => {
        setIsSearching(false);
        setSearchInput('');
        setSearchResults([]);
    }, []);

    // ===================== Dữ liệu hiển thị =====================
    const listForSidebar = isSearching ? searchResults : conversations;

    const filteredSortedConversations = useMemo(() => {
        const list = (listForSidebar || []).filter((convo) => {
            if (selectedFilterLabelIds.length > 0) {
                const psid = getConvoPsid(convo);
                if (!psid) return false;
                const customerLabelIds = allLabels
                    .filter((label) => Array.isArray(label.customer) && label.customer.includes(psid))
                    .map((label) => label._id);
                const hasAll = selectedFilterLabelIds.every((id) => customerLabelIds.includes(id));
                if (!hasAll) return false;
            }
            return true;
        });
        return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }, [listForSidebar, selectedFilterLabelIds, allLabels]);

    const assignedLabelsForSelectedConvo = useMemo(() => {
        if (!selectedConvo) return [];
        const psid = getConvoPsid(selectedConvo);
        if (!psid) return [];
        return allLabels.filter(
            (label) => Array.isArray(label.customer) && label.customer.includes(psid)
        );
    }, [selectedConvo, allLabels]);

    // ===================== Render =====================
    return (
        <div className="flex h-full w-full bg-white rounded-md border border-gray-200 flex-col p-2 gap-2">
            <Toaster richColors position="top-right" />

            {/* Header */}
            <div className="flex">
                <div className="flex items-center gap-3 justify-between w-full">
                    <div className="flex-1 gap-2 flex items-center">
                        {!hideSidebar && (
                            <>
                                <Link
                                    href="/pancake"
                                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent pr-4 pl-2 py-2 text-sm font-semibold text-[--main_b] transition-colors duration-200 ease-in-out hover:bg-[--main_b] hover:text-white active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[--main_b]"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                    <span>Quay lại</span>
                                </Link>
                                <LabelDropdown
                                    labels={allLabels}
                                    selectedLabelIds={selectedFilterLabelIds}
                                    onLabelChange={(labelId, checked) =>
                                        setSelectedFilterLabelIds((prev) =>
                                            checked ? [...prev, labelId] : prev.filter((id) => id !== labelId)
                                        )
                                    }
                                    style="left"
                                    trigger={
                                        <button className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 active:scale-95 cursor-pointer">
                                            {selectedFilterLabelIds.length > 0 ? (
                                                <span className="bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs">
                                                    {selectedFilterLabelIds.length}
                                                </span>
                                            ) : (
                                                <Tag className="h-4 w-4 text-gray-500" />
                                            )}
                                            <span>Thẻ</span>
                                            <ChevronDown className="h-4 w-4 text-gray-500" />
                                        </button>
                                    }
                                />
                                <div className="relative flex-grow">
                                    <Search
                                        className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 cursor-pointer"
                                        onClick={() => runSearch()}
                                        title="Tìm kiếm"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Tìm kiếm theo tên hoặc SĐT..."
                                        className="w-full bg-gray-100 rounded-md pl-10 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={searchInput}
                                        onChange={(e) => setSearchInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                runSearch();
                                            }
                                        }}
                                        autoComplete="off"
                                    />
                                    {isSearching && (
                                        <button
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                            onClick={clearSearch}
                                            title="Xoá tìm kiếm"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex gap-2 items-center">
                        <div className="flex flex-col items-end">
                            <h5 className="font-semibold">{pageConfig.name}</h5>
                            <h6 className="text-xs text-gray-500">
                                {pageConfig.platform === 'facebook'
                                    ? 'Page Facebook'
                                    : pageConfig.platform === 'instagram_official'
                                        ? 'Instagram Official'
                                    : pageConfig.platform === 'tiktok_business_messaging'
                                        ? 'TikTok Business Messaging'
                                    : pageConfig.platform === 'personal_zalo'
                                        ? 'Zalo Personal'
                                            : null}
                            </h6>
                        </div>
                        <Image
                            src={pageConfig.avatar}
                            alt={pageConfig.name}
                            width={36}
                            height={36}
                            className="rounded-md object-cover"
                        />
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 flex overflow-hidden bg-white rounded-md border border-gray-200">
                {/* Sidebar hội thoại */}
                {!hideSidebar && (
                <div className="w-full max-w-sm border-r border-gray-200 flex flex-col">
                    <ul className="flex-1 overflow-y-auto" ref={sidebarRef}>
                        {isLoadingConversations ? (
                            <li className="flex items-center justify-center p-8">
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                                    <span className="text-sm text-gray-500">Đang tải hội thoại...</span>
                                </div>
                            </li>
                        ) : filteredSortedConversations.length === 0 ? (
                            <li className="flex items-center justify-center p-8">
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <span className="text-sm text-gray-500">Chưa có hội thoại nào</span>
                                    <span className="text-xs text-gray-400">Các cuộc hội thoại sẽ hiển thị ở đây</span>
                                </div>
                            </li>
                        ) : (
                            filteredSortedConversations.map((convo) => {
                            const idUserForAvatar = getConvoAvatarId(convo);
                            const avatarUrl = avatarUrlFor({ idpage: pageConfig.id, iduser: idUserForAvatar, token });
                            const customerName = getConvoDisplayName(convo);
                            const formattedDateTime = fmtDateTimeVN(convo.updated_at);

                            const psid = getConvoPsid(convo);
                            const assignedLabels = psid
                                ? allLabels.filter(
                                    (label) => Array.isArray(label.customer) && label.customer.includes(psid)
                                )
                                : [];

                            const lastFromPage = isLastFromPage(convo);
                            const snippetPrefix = lastFromPage ? 'Bạn: ' : `${customerName}: `;
                            const unrepliedCount = lastFromPage ? 0 : 1;
                            
                            // Lấy type từ conversation
                            const conversationType = convo?.type;

                            return (
                                <li
                                    key={convo.id}
                                    onClick={() => handleSelectConvo(convo)}
                                    className={`flex items-start p-3 cursor-pointer hover:bg-gray-100 ${selectedConvo?.id === convo.id ? 'bg-blue-50' : ''
                                        }`}
                                >
                                    <div className="relative mr-3">
                                        <FallbackAvatar
                                            src={avatarUrl}
                                            alt={customerName}
                                            name={customerName}
                                            width={48}
                                            height={48}
                                            className="rounded-full object-cover"
                                        />
                                        {unrepliedCount > 0 && (
                                            <span
                                                className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center"
                                                title="Tin nhắn chưa rep"
                                            >
                                                {unrepliedCount === 1 ? '!' : null}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex-1 overflow-hidden min-w-0 flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                        <h6 className="font-semibold truncate text-gray-800">{customerName}</h6>
                                        <h6 className="text-sm text-gray-600 truncate">
                                            {snippetPrefix}
                                            {convo.snippet}
                                        </h6>

                                        {assignedLabels.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {assignedLabels.map((label) => (
                                                    <span
                                                        key={label._id}
                                                        className="rounded-full px-2 py-0.5 text-xs"
                                                        style={{ backgroundColor: label.color, color: 'white' }}
                                                    >
                                                        {label.name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        </div>
                                        
                                        {/* Icon phân biệt loại conversation - ở bên phải */}
                                        <div className="flex-shrink-0 flex items-center justify-center ml-2" style={{ minWidth: '24px' }}>
                                            {conversationType === 'INBOX' ? (
                                                <span 
                                                    title="Tin nhắn Messenger" 
                                                    style={{ fontSize: '20px', lineHeight: '1', display: 'inline-block' }}
                                                    className="text-gray-600"
                                                >
                                                    ✉️
                                                </span>
                                            ) : conversationType === 'COMMENT' ? (
                                                <span 
                                                    title="Bình luận Facebook" 
                                                    style={{ fontSize: '20px', lineHeight: '1', display: 'inline-block' }}
                                                    className="text-orange-500"
                                                >
                                                    🗨️
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="text-right ml-2 whitespace-nowrap">
                                        <div className="text-xs text-gray-500">{formattedDateTime}</div>
                                    </div>
                                </li>
                            );
                            })
                        )}
                    </ul>

                    {isLoadingMore && (
                        <div className="p-2 text-center text-xs text-gray-400">Đang tải thêm…</div>
                    )}
                </div>
                )}

                {/* Panel chi tiết */}
                <div className="flex-1 flex flex-col bg-gray-50">
                    {selectedConvo ? (
                        <>
                            <div className="flex items-center p-3 border-b border-gray-200 bg-white justify-between">
                                <div className="flex items-center">
                                    <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center font-bold mr-3">
                                        <FallbackAvatar
                                            src={avatarUrlFor({
                                                idpage: pageConfig.id,
                                                iduser: getConvoAvatarId(selectedConvo),
                                                token,
                                            })}
                                            alt={getConvoDisplayName(selectedConvo)}
                                            name={getConvoDisplayName(selectedConvo)}
                                            width={40}
                                            height={40}
                                            className="rounded-full object-cover"
                                        />
                                    </div>
                                    <h4 className="font-bold text-lg text-gray-900">
                                        {getConvoDisplayName(selectedConvo)}
                                    </h4>
                                </div>

                                <div>
                                    {getConvoPsid(selectedConvo) ? (
                                        <LabelDropdown
                                            labels={allLabels}
                                            selectedLabelIds={(allLabels || [])
                                                .filter(
                                                    (l) =>
                                                        Array.isArray(l.customer) &&
                                                        l.customer.includes(getConvoPsid(selectedConvo))
                                                )
                                                .map((l) => l._id)}
                                            style="right"
                                            onLabelChange={handleToggleLabel}
                                            trigger={
                                                <button className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 active:scale-95 cursor-pointer">
                                                    <Tag className="h-4 w-4 text-gray-500" />
                                                    <span>Thêm nhãn</span>
                                                </button>
                                            }
                                        />
                                    ) : (
                                        <button
                                            disabled
                                            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-400 cursor-not-allowed"
                                            title="Hội thoại không có PSID, không thể gán nhãn"
                                        >
                                            <Tag className="h-4 w-4" />
                                            <span>Không thể gán nhãn</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div ref={messagesScrollRef} className="flex-1 p-6 space-y-1 overflow-y-auto">
                                {isLoadingOlder && (
                                    <div className="text-center text-xs text-gray-400 mb-2">
                                        {selectedConvo?.type === 'COMMENT' ? 'Đang tải bình luận cũ…' : 'Đang tải tin nhắn cũ…'}
                                    </div>
                                )}

                                {isLoadingMessages && (
                                    <div className="text-center text-gray-500">
                                        {selectedConvo?.type === 'COMMENT' ? 'Đang tải bình luận...' : 'Đang tải tin nhắn...'}
                                    </div>
                                )}

                                {!isLoadingMessages && messages.length === 0 && (
                                    <div className="text-center text-gray-500 py-8">
                                        {selectedConvo?.type === 'COMMENT' 
                                            ? 'Chưa có bình luận nào trong cuộc hội thoại này.'
                                            : 'Chưa có tin nhắn nào trong cuộc hội thoại này.'}
                                    </div>
                                )}

                                {messages.map((msg, index) => {
                                    if (!msg) return null;
                                    const formattedTime = fmtDateTimeVN(msg.inserted_at);
                                    
                                    
                                    return msg.content?.type === 'system' ? (
                                        <MessageContent key={msg.id || `msg-${index}`} content={msg.content} pageId={pageConfig.id} />
                                    ) : (
                                        <div
                                            key={msg.id || `msg-${index}`}
                                            className={`flex flex-col my-1 ${msg.senderType === 'page' ? 'items-end' : 'items-start'
                                                }`}
                                        >
                                            <div className={`flex flex-col ${msg.senderType === 'page' ? 'items-end' : 'items-start'}`}>
                                                <div
                                                    className={`max-w-lg p-3 rounded-xl shadow-sm flex flex-col ${msg.senderType === 'page'
                                                        ? 'bg-blue-500 text-white items-end'
                                                        : 'bg-white text-gray-800'
                                                        }`}
                                                >
                                                    <MessageContent content={msg.content} pageId={pageConfig.id} />
                                                    <div
                                                        className={`text-xs mt-1 ${msg.senderType === 'page'
                                                            ? 'text-right text-blue-100/80'
                                                            : 'text-left text-gray-500'
                                                            }`}
                                                    >
                                                        {formattedTime}
                                                    </div>
                                                </div>
                                                {/* ✅ Hiển thị reactions ngay dưới tin nhắn, căn trái với message bubble */}
                                                {(() => {
                                                    const hasReactions = msg.content?.type === 'text' && 
                                                                        msg.content?.reactions && 
                                                                        Array.isArray(msg.content.reactions) && 
                                                                        msg.content.reactions.length > 0;
                                                    
                                                    // Debug log để kiểm tra
                                                    if (msg.content?.type === 'text') {
                                                        console.log('🎨 [Render] Message check:', {
                                                            id: msg.id,
                                                            content: msg.content.content,
                                                            hasReactions,
                                                            reactions: msg.content?.reactions,
                                                            reactionsType: typeof msg.content?.reactions,
                                                            reactionsIsArray: Array.isArray(msg.content?.reactions),
                                                            fullContent: msg.content
                                                        });
                                                    }
                                                    
                                                    return hasReactions ? (
                                                        <div 
                                                            className="flex flex-wrap gap-1 mt-1 pl-1"
                                                            style={{
                                                                minWidth: 'fit-content',
                                                                alignSelf: msg.senderType === 'page' ? 'flex-end' : 'flex-start'
                                                            }}
                                                        >
                                                            {msg.content.reactions.map((reaction, idx) => (
                                                                <span 
                                                                    key={idx} 
                                                                    className="inline-block"
                                                                    title={`Reaction: ${reaction}`}
                                                                    style={{ 
                                                                        fontSize: '18px',
                                                                        lineHeight: '1.2',
                                                                        display: 'inline-block'
                                                                    }}
                                                                >
                                                                    {reaction}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </div>
                                            {msg.senderType === 'page' && index === messages.length - 1 && (
                                                <MessageStatus status={msg.status} error={msg.error} />
                                            )}
                                        </div>
                                    );
                                })}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Với COMMENT type, có thể disable form hoặc cho phép reply comment */}
                            <form ref={formRef} action={handleSendMessage} className={`p-4 border-t border-gray-200 bg-white ${selectedConvo?.type === 'COMMENT' ? 'opacity-75' : ''}`}>
                                {!!pendingImages.length && (
                                    <div className="mb-2 flex flex-wrap gap-2">
                                        {pendingImages.map((img) => (
                                            <div key={img.localId} className="relative">
                                                <img
                                                    src={img.url}
                                                    alt="preview"
                                                    className="h-20 w-20 rounded object-cover border"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingImage(img.localId)}
                                                    className="absolute -top-2 -right-2 bg-white border rounded-full p-0.5 shadow hover:bg-gray-50"
                                                    title="Xoá ảnh"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
                                    <button
                                        type="button"
                                        className="text-gray-700 hover:text-gray-900 disabled:opacity-60"
                                        onClick={triggerPickImage}
                                        disabled={isUploadingImage}
                                        title="Đính kèm ảnh"
                                    >
                                        <ImageIcon className="h-5 w-5" />
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={onPickImage}
                                    />

                                    <input
                                        name="message"
                                        placeholder={isUploadingImage ? 'Đang tải ảnh...' : 'Nhập tin nhắn...'}
                                        className="flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-60"
                                        autoComplete="off"
                                        disabled={isUploadingImage}
                                    />

                                <button
                                        type="submit"
                                    className={`disabled:opacity-60 ${isUploadingImage || hasPendingUploads ? 'text-gray-400 cursor-not-allowed' : 'text-blue-500 hover:text-blue-700'}`}
                                    disabled={isUploadingImage || hasPendingUploads}
                                    >
                                        <Send className="h-5 w-5" />
                                    </button>
                                </div>
                            </form>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <p>Chọn một hội thoại để bắt đầu</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
