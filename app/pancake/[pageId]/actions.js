// app/pancake/[pageId]/actions.js
'use server';

import axios from 'axios';
import { PANCAKE_API_BASE_URL } from '@/config/pages';
import { uploadBufferToDrive, viewUrlFromId } from '@/lib/drive';

// 1) Upload ảnh lên Pancake CDN và trả về { id, url, content_url, image_data }
export async function uploadImageToDriveAction(file, pageId, accessToken) {
    try {
        if (!file) return { success: false, error: 'NO_FILE' };
        if (!pageId || !accessToken) {
            return { success: false, error: 'missing pageId or accessToken' };
        }

        // Upload lên Pancake CDN
        const uploadUrl = `https://pancake.vn/api/v1/pages/${pageId}/contents?access_token=${accessToken}`;
        
        const formData = new FormData();
        formData.append('file', file);

        // console.log('[uploadImageToDriveAction] Uploading to Pancake CDN:', {
        //     pageId,
        //     fileName: file.name,
        //     fileSize: file.size,
        //     fileType: file.type
        // });

        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });

        const responseText = await response.text();
        // console.log('[uploadImageToDriveAction] Response status:', response.status);
        // console.log('[uploadImageToDriveAction] Response text:', responseText);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('[uploadImageToDriveAction] Failed to parse JSON:', e);
            return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
        }

        // console.log('[uploadImageToDriveAction] Response JSON:', result);

        if (result.success && result.content_url) {
            return {
                success: true,
                id: result.content_id || result.id,
                url: result.content_url, // URL từ Pancake CDN
                content_url: result.content_url,
                content_preview_url: result.content_preview_url,
                image_data: result.image_data, // {width, height}
                mime_type: result.mime_type
            };
        }

        return { 
            success: false, 
            error: result.error || result.message || 'Upload failed' 
        };
    } catch (e) {
        console.error('[uploadImageToDriveAction] error:', e?.message || e);
        return { success: false, error: e?.message || 'UPLOAD_FAILED' };
    }
}

// 2) Gửi ảnh vào hội thoại (content_url = link Drive)
// conversationType: 'INBOX' | 'COMMENT'
// replyToMessageId: ID của comment muốn reply (chỉ dùng cho COMMENT type)
// postId: ID của post (chỉ dùng cho COMMENT type)
export async function sendImageAction(pageId, accessToken, conversationId, imageId, message, conversationType = 'INBOX', replyToMessageId = null, postId = null, imageUrl = null, imageData = null) {
    try {
        if (!pageId || !accessToken || !conversationId || !imageId) {
            return { success: false, error: 'missing params' };
        }
        
        // Nếu có imageUrl (URL trực tiếp), ưu tiên dùng nó
        // Nếu không, dùng imageId để tạo URL
        const useDirectUrl = imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'));

        // Xử lý conversationId theo platform
        // Với Zalo (pzl_) hoặc COMMENT, giữ nguyên conversationId đầy đủ
        // Với Facebook/Instagram INBOX, có thể cần extract
        const isZalo = pageId && (String(pageId).startsWith('pzl_') || String(conversationId).startsWith('pzl_'));
        const isComment = conversationType === 'COMMENT';
        
        // Với Zalo hoặc COMMENT, giữ nguyên conversationId
        // Với Facebook/Instagram INBOX, có thể cần extract (nhưng tạm thời giữ nguyên để test)
        const conversationIdForRequest = conversationId;
        
        // Với COMMENT type, thử dùng Pancake endpoint với action reply_comment
        // Với INBOX type, vẫn dùng pancake.vn
        let url;
        if (conversationType === 'COMMENT' && replyToMessageId) {
            // COMMENT type: thử dùng Pancake endpoint với action reply_comment
            url = `https://pancake.vn/api/v1/pages/${pageId}/conversations/${conversationIdForRequest}/messages?access_token=${accessToken}`;
        } else {
            // INBOX type: dùng pancake.vn API với access_token
            url = `https://pancake.vn/api/v1/pages/${pageId}/conversations/${conversationIdForRequest}/messages?access_token=${accessToken}`;
        }
        
        // console.log('[sendImageAction] URL and conversationId:', {
        //     url,
        //     conversationId,
        //     conversationIdForRequest,
        //     isZalo,
        //     isComment,
        //     conversationType
        // });

        // Xác định contentUrl và imageData cho cả INBOX và COMMENT
        let contentUrl = null;
        let finalImageData = null;
        
        // console.log('[sendImageAction] Input params:', {
        //     imageId,
        //     imageUrl,
        //     imageData,
        //     useDirectUrl,
        //     conversationType
        // });
        
        if (useDirectUrl) {
            // Có URL trực tiếp (từ Pancake CDN upload)
            contentUrl = imageUrl;
            // Ưu tiên dùng imageData từ upload response
            finalImageData = imageData || {
                width: 736,
                height: 736
            };
            // console.log('[sendImageAction] Using direct URL from upload:', contentUrl);
        } else {
            // Nếu imageId là URL từ Pancake CDN
            if (typeof imageId === 'string' && (imageId.startsWith('http://') || imageId.startsWith('https://'))) {
                contentUrl = imageId;
                // console.log('[sendImageAction] imageId is already a URL:', contentUrl);
            } else if (typeof imageId === 'string' && (imageId.includes('content.pancake.vn') || imageId.includes('pancake.vn'))) {
                contentUrl = imageId.startsWith('http') ? imageId : `https://${imageId}`;
                // console.log('[sendImageAction] imageId contains pancake.vn, converted to:', contentUrl);
            } else {
                // Có thể là content_id từ Pancake, nhưng cần URL đầy đủ
                // Fallback: giả sử là Google Drive ID (nếu vẫn dùng Drive)
                contentUrl = `https://lh3.googleusercontent.com/d/${imageId}`;
                console.warn('[sendImageAction] imageId is not a URL, using Google Drive fallback:', contentUrl);
            }
            // Ưu tiên dùng imageData từ tham số, nếu không có thì dùng mặc định
            finalImageData = imageData || {
                width: 736,
                height: 736
            };
        }
        
        // Kiểm tra contentUrl có hợp lệ không
        if (!contentUrl || !contentUrl.startsWith('http')) {
            console.error('[sendImageAction] Invalid contentUrl:', contentUrl);
            return { success: false, error: `Invalid content_url: ${contentUrl || 'URL is required'}` };
        }
        
        // console.log('[sendImageAction] Final contentUrl and imageData:', {
        //     contentUrl,
        //     imageData: finalImageData
        // });
        
        // Với COMMENT type, cần gửi FormData với action reply_comment
        if (conversationType === 'COMMENT' && replyToMessageId) {
            const fd = new FormData();
            fd.append('action', 'reply_comment');
            fd.append('message_id', replyToMessageId);
            fd.append('message', message || '');
            fd.append('content_url', contentUrl);
            fd.append('width', String(finalImageData.width));
            fd.append('height', String(finalImageData.height));
            fd.append('mime_type', 'photo');
            fd.append('send_by_platform', 'web');
            fd.append('parent_id', replyToMessageId);
            
            if (postId) {
                fd.append('post_id', postId);
            }
            
            fd.append('user_selected_reply_to', '');
            
            // console.log('[sendImageAction] COMMENT FormData:', {
            //     action: 'reply_comment',
            //     message_id: replyToMessageId,
            //     message: message || '',
            //     content_url: contentUrl,
            //     width: finalImageData.width,
            //     height: finalImageData.height,
            //     mime_type: 'photo',
            //     send_by_platform: 'web',
            //     parent_id: replyToMessageId,
            //     post_id: postId
            // });
            // console.log('[sendImageAction] COMMENT URL:', url);
            
            let res = await fetch(url, {
                method: 'POST',
                body: fd
            });
            
            const responseText = await res.text();
            // console.log('[sendImageAction] Response status:', res.status);
            // console.log('[sendImageAction] Response text:', responseText);
            
            try {
                res = JSON.parse(responseText);
            } catch (e) {
                console.error('[sendImageAction] Failed to parse JSON:', e);
                return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
            }
            
            // console.log('[sendImageAction] Response JSON:', res);
            if (res.success) return { success: true };
            return { success: false, error: res.error || res.message || 'Pancake API reported failure' };
        } else {
            // INBOX type: dùng FormData
            // contentUrl và finalImageData đã được xác định ở trên
            
            const fd = new FormData();
            fd.append('action', 'reply_inbox');
            fd.append('content_url', contentUrl);
            fd.append('width', String(finalImageData.width));
            fd.append('height', String(finalImageData.height));
            fd.append('mime_type', 'photo');
            fd.append('send_by_platform', 'web');
            // Luôn append message, kể cả khi rỗng (theo mẫu thành công)
            fd.append('message', message || '');

            // Log FormData entries để debug
            // console.log('[sendImageAction] INBOX FormData entries:');
            for (const [key, value] of fd.entries()) {
                console.log(`  ${key}:`, value);
            }
            // console.log('[sendImageAction] INBOX URL:', url);
            // console.log('[sendImageAction] Full request details:', {
            //     url,
            //     method: 'POST',
            //     action: 'reply_inbox',
            //     content_url: contentUrl,
            //     width: finalImageData.width,
            //     height: finalImageData.height,
            //     mime_type: 'photo',
            //     send_by_platform: 'web',
            //     message: message || '',
            //     pageId,
            //     conversationId: conversationIdForRequest
            // });

            let res = await fetch(url, { method: 'POST', body: fd });
            // console.log('[sendImageAction] Response status:', res.status);
            // console.log('[sendImageAction] Response headers:', Object.fromEntries(res.headers.entries()));
            
            const responseText = await res.text();
            // console.log('[sendImageAction] Response text (full):', responseText);
            // console.log('[sendImageAction] Response text (first 500 chars):', responseText.substring(0, 500));
            
            try {
                res = JSON.parse(responseText);
            } catch (e) {
                console.error('[sendImageAction] Failed to parse JSON:', e);
                console.error('[sendImageAction] Response text that failed to parse:', responseText);
                return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
            }
            
            // console.log('[sendImageAction] Response JSON:', res);
            // console.log('[sendImageAction] Response success:', res.success);
            // console.log('[sendImageAction] Response error:', res.error);
            // console.log('[sendImageAction] Response message:', res.message);
            
            if (res.success) return { success: true };
            return { success: false, error: res.error || res.message || 'Pancake API reported failure' };
        }
    } catch (e) {
        console.error('[sendImageAction] error:', e?.message || e);
        return { success: false, error: e?.message || 'SEND_IMAGE_FAILED' };
    }
}

// 3) Gửi tin nhắn text
// conversationType: 'INBOX' | 'COMMENT'
// replyToMessageId: ID của comment muốn reply (chỉ dùng cho COMMENT type)
// postId: ID của post (chỉ dùng cho COMMENT type)
export async function sendMessageAction(pageId, accessToken, conversationId, message, conversationType = 'INBOX', replyToMessageId = null, postId = null) {
    try {
        const text = (message || '').trim();
        if (!pageId || !accessToken || !conversationId || !text) {
            return { success: false, error: 'missing params' };
        }

        // Với COMMENT type, thử dùng Pancake endpoint với action reply_comment
        // Với INBOX type, vẫn dùng pancake.vn
        // 🤔 xem xét
        let url;
        if (conversationType === 'COMMENT' && replyToMessageId) {
            // COMMENT type: thử dùng Pancake endpoint với action reply_comment
            // Nếu không được, có thể cần dùng pages.fm API với page_access_token riêng
            url = `https://pancake.vn/api/v1/pages/${pageId}/conversations/${conversationId}/messages?access_token=${accessToken}`;
        } else {
            // INBOX type: dùng pancake.vn API với access_token
            url = `https://pancake.vn/api/v1/pages/${pageId}/conversations/${conversationId}/messages?access_token=${accessToken}`;
        }

        let payload;
        
        // Với COMMENT type, sử dụng reply_comment
        if (conversationType === 'COMMENT' && replyToMessageId) {
            payload = {
                action: 'reply_comment',
                message_id: replyToMessageId,
                message: text,
                parent_id: replyToMessageId, // parent_id bằng message_id
                send_by_platform: "web"
            };
            // Thêm post_id nếu có
            if (postId) {
                payload.post_id = postId;
            }
            // console.log('[sendMessageAction] COMMENT payload:', payload);
            // console.log('[sendMessageAction] COMMENT URL:', url);
        } else {
            // Với INBOX type, sử dụng reply_inbox
            payload = {
                action: 'reply_inbox',
                message: text,
                messaging_type: 'MESSAGE_TAG',
                tag: 'POST_PURCHASE_UPDATE',
                send_by_platform: "web"
            };
        }
        
        let res = await fetch(url, {
            method: 'POST', 
            body: JSON.stringify(payload), 
            headers: {
                'Content-Type': 'application/json'     // cần có header này khi gửi JSON
            },
        });
        
        const responseText = await res.text();
        // console.log('[sendMessageAction] Response status:', res.status);
        // console.log('[sendMessageAction] Response text:', responseText);
        
        try {
            res = JSON.parse(responseText);
        } catch (e) {
            console.error('[sendMessageAction] Failed to parse JSON:', e);
            return { success: false, error: `Invalid response: ${responseText.substring(0, 100)}` };
        }
        
        // console.log('[sendMessageAction] Response JSON:', res);
        if (res.success) return { success: true };
        return { success: false, error: res.error || res.message || 'Pancake API reported failure' };
    } catch (e) {
        // console.log('[sendMessageAction] error:', e?.response?.data || e?.message || e);
        return { success: false, error: e?.response?.data?.message || 'Failed to send message' };
    }
}
