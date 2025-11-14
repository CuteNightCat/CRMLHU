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
const isInbox = (convo) => convo?.type === 'INBOX';
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
    return fromId === String(pageId) ? 'page' : 'customer';
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
            console.log('✅ [Auto Customer] Tạo khách hàng thành công:', result);
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
    ];

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
        return {
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
    }

    const imageAtts = atts
        .filter((a) => a && (
            (a.type === 'photo' || a.type === 'image' || a.mime?.startsWith?.('image/')) &&
            a.type !== 'sticker' && 
            a.type?.toLowerCase() !== 'sticker'
        ))
        .map((a) => {
            const url = a?.url
                || a?.preview_url
                || a?.image_data?.url
                || a?.src
                || a?.source
                || a?.payload?.url
                || a?.payload?.src
                || a?.media?.image?.src
                || a?.media?.image?.url
                || a?.file_url;
            return url ? { ...a, url } : a;
        })
        .filter((a) => a?.url);
    if (imageAtts.length > 0) {
        return {
            id: raw.id,
            inserted_at: ts,
            senderType,
            status: raw.status || 'sent',
            content: {
                type: 'images',
                images: imageAtts.map((a) => ({
                    url: a.url,
                    width: a?.image_data?.width || a?.width,
                    height: a?.image_data?.height || a?.height,
                })),
            },
        };
    }

    // ✅ QUAN TRỌNG: Lọc bỏ attachment type="REACTION" và "sticker" vì đã xử lý riêng
    // Nếu có text message, ưu tiên hiển thị text với reaction thay vì file
    const fileAtts = atts.filter((a) => 
        a?.type && 
        a?.type !== 'photo' && 
        a?.type !== 'image' && 
        a?.type !== 'sticker' &&
        a?.type?.toLowerCase() !== 'sticker' &&
        a?.type !== 'REACTION' && // Bỏ qua REACTION attachment
        a?.type?.toLowerCase() !== 'reaction' // Bỏ qua cả lowercase
    );
    
    // Parse text message - có thể chứa reaction format: "[❤️ ] text"
    let text =
        typeof raw.original_message === 'string' && raw.original_message.trim().length > 0
            ? raw.original_message.trim()
            : htmlToPlainText(raw.message || '');
    
    // ✅ Nếu có text message, ưu tiên hiển thị text (có thể kèm reaction) thay vì file
    // Chỉ hiển thị file nếu không có text hoặc text rỗng
    const hasText = text && text.trim().length > 0;
    
    // Nếu không có text và có file attachments (không phải REACTION), hiển thị file
    if (!hasText && fileAtts.length > 0) {
        return {
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
    }
    
    // ✅ Parse reaction từ text: format "[emoji] text" hoặc "[emoji ] text"
    // Ví dụ: "[❤️ ] À anh hiểu." → reaction: "❤️", text: "À anh hiểu."
    let reactions = [];
    let cleanText = text;
    
    if (text && typeof text === 'string') {
        // Debug log để kiểm tra dữ liệu
        if (text.includes('[') || text.includes('❤️') || text.includes(']')) {
            console.log('🔍 [Reaction Parse] Original text:', text);
            console.log('🔍 [Reaction Parse] Raw message:', {
                id: raw.id,
                original_message: raw.original_message,
                message: raw.message,
                attachments: raw.attachments
            });
        }
        
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
                
                console.log('✅ [Reaction Parse] Parsed:', {
                    reactions,
                    cleanText,
                    originalText: text,
                    reactionPart,
                    reactionMatches: reactionMatches.map(m => m[1])
                });
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
    if (reactions.length > 0) {
        console.log('📤 [Reaction Parse] Final normalized message:', {
            id: raw.id,
            content: normalizedContent,
            hasReactions: !!normalizedContent.reactions,
            reactionsCount: reactions.length
        });
    }
    
    return {
        id: raw.id,
        inserted_at: ts,
        senderType,
        status: raw.status || 'sent',
        content: normalizedContent,
    };
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

const MessageContent = ({ content }) => {
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

        case 'images':
            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {content.images.map((img, i) => (
                        <a key={i} href={img.url} target="_blank" rel="noreferrer">
                            <img
                                src={img.url}
                                alt={`Attachment ${i + 1}`}
                                className="max-w-[240px] max-h-[240px] rounded-lg object-cover"
                                loading="lazy"
                            />
                        </a>
                    ))}
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
    const messagesScrollRef = useRef(null);
    const [isNearBottom, setIsNearBottom] = useState(true);
    const isNearBottomRef = useRef(true);
    const lastScrollTopRef = useRef(0);

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
        const s = io(SOCKET_URL, {
            path: '/socket.io',
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 3000,
            withCredentials: true,
        });
        socketRef.current = s;

        s.on('disconnect', (r) => console.warn('[socket] disconnected:', r));
        s.on('connect_error', (e) => console.error('[socket] error:', e?.message || e));

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
            const currentKey = current ? extractConvoKey(current.id) : null;
            const targetKey = extractConvoKey(targetId);
            
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
                    
                    console.log('🔍 [Auto Customer] Phát hiện số điện thoại trong tin nhắn:', {
                        customerName,
                        messageText,
                        detectedPhones,
                        conversationId,
                        platform,
                        pageName,
                        rawMsg: msg
                    });
                    
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
            
            // Nếu conversationId là undefined, vẫn refresh nếu có conversation đang chọn
            if (current && (!targetId || currentKey === targetKey)) {
                const s = socketRef.current;
                if (s) {
                    // ✅ QUAN TRỌNG: Với Zalo (pzl_*), phải giữ nguyên conversation.id GỐC
                    const isZalo = pageConfig?.platform === 'personal_zalo';
                    const conversationIdForRequest = isZalo 
                        ? current.id  // ✅ Zalo: giữ nguyên "pzl_12345_67890"
                        : extractConvoKey(current.id);  // Facebook/Instagram: extract
                    
                    // Đối với Zalo, customerId có thể là null
                    const customerId = current?.customers?.[0]?.id
                        || current?.from?.id
                        || current?.from_psid
                        || null;
                    
                    s.emit(
                        'msg:get',
                        { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count: 0 },
                        (res) => {
                            if (res?.ok && Array.isArray(res.items)) {
                                const normalized = sortAscByTime(
                                    res.items.map((m) => normalizePancakeMessage(m, pageConfig.id))
                                );
                                setMessages(normalized);
                                if (isNearBottomRef.current) {
                                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                                }
                            }
                        }
                    );
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
        s.emit('conv:get', { pageId: pageConfig.id, token, current_count: 0 }, (res) => {
            if (res?.ok && Array.isArray(res.items)) {
                const incoming = res.items.filter(isInbox);
                setConversations((prev) => {
                    const merged = mergeConversations(prev, incoming);
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
                setLoadedCount(incoming.length);
            } else if (res?.error) {
                console.error('[conv:get] error:', res.error);
            }
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

    // ===================== Load older messages by scroll top =====================
    const loadOlderMessages = useCallback(() => {
        if (!selectedConvo || !socketRef.current || isLoadingOlder || !hasMore) return;

        setIsLoadingOlder(true);

        const nextCount = (messages?.length || 0) + 30; // mỗi lần +30
        const scroller = messagesScrollRef.current;
        const prevScrollHeight = scroller ? scroller.scrollHeight : 0;
        const prevScrollTop = scroller ? scroller.scrollTop : 0;

        // ✅ QUAN TRỌNG: Với Zalo (pzl_*), phải giữ nguyên conversation.id GỐC
        const isZalo = pageConfig?.platform === 'personal_zalo';
        const conversationIdForRequest = isZalo 
            ? selectedConvo.id  // ✅ Zalo: giữ nguyên "pzl_12345_67890"
            : extractConvoKey(selectedConvo.id);  // Facebook/Instagram: extract
        
        // Với một số nền tảng (ví dụ: Zalo cá nhân), conversation có thể không có customers[0].id
        // Fallback lần lượt: customers[0].id -> from.id -> from_psid
        const customerId = selectedConvo?.customers?.[0]?.id
            || selectedConvo?.from?.id
            || selectedConvo?.from_psid
            || null;
        
        socketRef.current.emit(
            'msg:get',
            { pageId: pageConfig.id, token, conversationId: conversationIdForRequest, customerId: customerId || null, count: nextCount },
            (res) => {
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
    }, [selectedConvo, messages, token, pageConfig.id, isLoadingOlder, hasMore]);

    useEffect(() => {
        const el = messagesScrollRef.current;
        if (!el) return;

        const handleScroll = () => {
            const currentTop = el.scrollTop;
            const previousTop = lastScrollTopRef.current;

            if (currentTop < previousTop && isNearBottomRef.current) {
                isNearBottomRef.current = false;
                setIsNearBottom(false);
            }

            lastScrollTopRef.current = currentTop;

            if (currentTop <= 80) {
                loadOlderMessages();
            }

            const distanceFromBottom = el.scrollHeight - currentTop - el.clientHeight;
            const nearBottom = distanceFromBottom < 40;

            if (isNearBottomRef.current !== nearBottom) {
                isNearBottomRef.current = nearBottom;
                setIsNearBottom(nearBottom);
            }
        };

        // Khởi tạo trạng thái ban đầu
        handleScroll();

        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, [loadOlderMessages]);

    // ===================== Handlers =====================
    const handleSelectConvo = useCallback(
        async (conversation) => {
            if (selectedConvo?.id === conversation.id) return;

            const s = socketRef.current;
            if (!s) return;

            // dừng watcher cũ (nếu có)
            if (selectedConvo?.id) {
                s.emit('msg:watchStop', { pageId: pageConfig.id, conversationId: selectedConvo.id });
            }

            // set UI & tải messages 1 lần
            // Defensive: if conversation lacks customers/from, try to find richer object in current state
            setConversations((prev) => {
                const richer = prev.find((c) => c.id === conversation.id) || prev.find((c) => extractConvoKey(c.id) === extractConvoKey(conversation.id));
                if (richer) {
                    setSelectedConvo({ ...richer, ...conversation });
                } else {
                    setSelectedConvo(conversation);
                }
                return prev;
            });
            // Sửa lỗi: Chỉ reset messages nếu chuyển sang hội thoại khác
            if (selectedConvo?.id !== conversation.id) {
                setMessages([]);
            }
            setHasMore(true); // reset state load-more
            setIsLoadingMessages(true);
            isNearBottomRef.current = true;
            setIsNearBottom(true);
            lastScrollTopRef.current = 0;

            // ✅ QUAN TRỌNG: Với Zalo (pzl_*), phải giữ nguyên conversation.id GỐC
            // Không được extract vì server sẽ build URL sai
            const isZalo = pageConfig?.platform === 'personal_zalo';
            const conversationIdForRequest = isZalo 
                ? conversation.id  // ✅ Zalo: giữ nguyên "pzl_12345_67890"
                : extractConvoKey(conversation.id);  // Facebook/Instagram: extract "123456789"
            
            // Với Zalo cá nhân và một số nguồn, không có customers[0].id -> dùng from.id hoặc from_psid
            // Đối với Zalo, có thể không cần customerId để tải tin nhắn
            const customerId = conversation?.customers?.[0]?.id
                || conversation?.from?.id
                || conversation?.from_psid
                || null;
            
            console.log('📤 [ChatClient] Loading messages:', {
                platform: pageConfig?.platform,
                conversationId: conversation.id,
                conversationIdForRequest,
                isZalo,
                customerId
            });
            
            // Tải tin nhắn - với Zalo, customerId có thể là null
            s.emit(
                'msg:get',
                { 
                    pageId: pageConfig.id, 
                    token, 
                    conversationId: conversationIdForRequest,  // ✅ Gửi ID gốc cho Zalo
                    customerId: customerId || null, 
                    count: 0 
                },
                (res) => {
                    console.log('📥 [ChatClient] Messages response:', {
                        ok: res?.ok,
                        itemsCount: res?.items?.length || 0,
                        error: res?.error
                    });
                    
                    if (res?.ok && Array.isArray(res.items)) {
                        const normalized = sortAscByTime(
                            res.items.map((m) => normalizePancakeMessage(m, pageConfig.id))
                        );
                        console.log('✅ [ChatClient] Normalized messages:', normalized.length);
                        setMessages(normalized);
                        setHasMore(res.items.length > 0);
                        if (isNearBottomRef.current) {
                            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                        }
                    } else if (res?.error) {
                        console.error('❌ [ChatClient] msg:get error:', res.error);
                        console.warn('⚠️ [ChatClient] Không thể tải tin nhắn:', res.error);
                        // Hiển thị thông báo lỗi cho user
                        toast.error(`Không thể tải tin nhắn: ${res.error}`);
                    } else {
                        console.warn('⚠️ [ChatClient] Response không hợp lệ:', res);
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
            console.log('✅ [Preselect Match] Selecting conversation:', {
                id: convo.id,
                name: convoName,
                ...context,
            });
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

        console.log('🔍 [Preselect Match] Looking for:', {
            customerName: preselect.name,
            normalized: preNameNormalized,
            phone: prePhone,
            nameParts: preNameParts
        });
        console.log('🔍 [Preselect Match] Scored conversations:', scored.sort((a, b) => b.score - a.score).slice(0, 5));
        console.log('🔍 [Preselect Match] Best match:', best ? {
            id: best.id,
            name: best?.customers?.[0]?.name || best?.from?.name || 'Unknown',
            score: bestScore
        } : 'None');

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
                // 2) Upload in background; store returned id for sending
                try {
                    const res = await uploadImageToDriveAction(f);
                    if (!res?.success) {
                        toast.error(`Tải ảnh thất bại: ${res?.error || ''}`);
                        continue;
                    }
                    setPendingImages((prev) => prev.map((it) => it.localId === localId ? { ...it, id: res.id } : it));
                } catch (err) {
                    toast.error(`Tải ảnh thất bại: ${err?.message || ''}`);
                }
            }
            if (fileInputRef.current) fileInputRef.current.value = '';
        } finally {
            setIsUploadingImage(false);
        }
    }, []);

    const removePendingImage = useCallback((localId) => {
        setPendingImages((prev) => prev.filter((x) => x.localId !== localId));
    }, []);

    const handleSendMessage = async (formData) => {
        console.log('=== SENDING MESSAGE ===');
        console.log('FormData:', formData);
        console.log('Selected conversation:', selectedConvo);
        console.log('PageConfig:', pageConfig);
        
        if (!selectedConvo) {
            console.log('❌ No selected conversation');
            return;
        }
        
        const text = (formData.get('message') || '').trim();
        const hasImages = pendingImages.length > 0;
        console.log('Message text:', text);
        console.log('Has images:', hasImages);
        
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
        console.log('🚀 Sending message to server...');
        let overallOk = true;
        let lastError = null;
        try {
            if (hasImages) {
                console.log('📷 Sending image message...');
                const first = pendingImages[0];
                const res1 = await sendImageAction(
                    pageConfig.id,
                    pageConfig.accessToken,
                    selectedConvo.id,
                    first.id,
                    text || ''
                );
                console.log('📷 Image send result:', res1);
                if (!res1?.success) {
                    overallOk = false;
                    lastError = res1?.error || 'SEND_IMAGE_FAILED';
                }
                for (let i = 1; i < pendingImages.length; i++) {
                    const it = pendingImages[i];
                    const r = await sendImageAction(
                        pageConfig.id,
                        pageConfig.accessToken,
                        selectedConvo.id,
                        it.id,
                        ''
                    );
                    console.log(`📷 Additional image ${i} send result:`, r);
                    if (!r?.success) {
                        overallOk = false;
                        lastError = r?.error || 'SEND_IMAGE_FAILED';
                    }
                }
            } else if (text) {
                console.log('💬 Sending text message...');
                const r = await sendMessageAction(
                    pageConfig.id,
                    pageConfig.accessToken,
                    selectedConvo.id,
                    text,
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
        

        // Xóa optimistic entries sau khi gửi (tin nhắn thật sẽ được thêm qua msg:new)
        if (overallOk) {
            setMessages((prev) => prev.filter(m => !optimisticEntries.find(o => o.id === m.id)));
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
                        {filteredSortedConversations.map((convo) => {
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

                                    <div className="flex-1 overflow-hidden">
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

                                    <div className="text-right ml-2 whitespace-nowrap">
                                        <div className="text-xs text-gray-500">{formattedDateTime}</div>
                                    </div>
                                </li>
                            );
                        })}
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
                                        Đang tải tin nhắn cũ…
                                    </div>
                                )}

                                {isLoadingMessages && (
                                    <div className="text-center text-gray-500">Đang tải tin nhắn...</div>
                                )}

                                {messages.map((msg, index) => {
                                    if (!msg) return null;
                                    const formattedTime = fmtDateTimeVN(msg.inserted_at);
                                    
                                    
                                    return msg.content?.type === 'system' ? (
                                        <MessageContent key={msg.id || `msg-${index}`} content={msg.content} />
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
                                                    <MessageContent content={msg.content} />
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

                            <form ref={formRef} action={handleSendMessage} className="p-4 border-t border-gray-200 bg-white">
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
