'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Search, Send, Loader2, ChevronLeft, RefreshCw, MessageCircle, MessageSquare } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import Link from 'next/link';
import FallbackAvatar from '@/components/FallbackAvatar';

// ======================= Cấu hình =======================
const SOCKET_URL = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3100';

// Helper functions
const extractConvoKey = (id) => {
    if (!id) return null;
    const parts = String(id).split('_');
    return parts.length > 1 ? parts[1] : parts[0];
};

// Chấp nhận cả INBOX, COMMENT, và MESSAGE
const isInbox = (convo) => {
    const type = convo?.type;
    return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
};
const getConvoPsid = (convo) => convo?.from_psid || null;
const getConvoAvatarId = (convo) =>
    convo?.from_psid || convo?.customers?.[0]?.fb_id || convo?.from?.id || null;
const getConvoDisplayName = (convo) =>
    convo?.customers?.[0]?.name || convo?.from?.name || 'Khách hàng ẩn';
const avatarUrlFor = ({ idpage, iduser }) =>
    iduser ? `https://pancake.vn/api/v1/pages/${idpage}/avatar/${iduser}` : undefined;

const getSenderType = (msg, pageId) => {
    if (msg?.senderType) return msg.senderType;
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

const normalizePancakeMessage = (raw, pageId) => {
    const senderType = getSenderType(raw, pageId);
    const ts = raw.inserted_at;

    const atts = Array.isArray(raw.attachments) ? raw.attachments : [];

    // Handle image attachments
    const imageAtts = atts.filter((a) => a?.type === 'photo' && a?.url);
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
                    width: a?.image_data?.width,
                    height: a?.image_data?.height,
                })),
            },
        };
    }

    // Handle file attachments
    const fileAtts = atts.filter((a) => a?.type && a?.type !== 'photo');
    if (fileAtts.length > 0) {
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

    // Handle text messages
    const text =
        typeof raw.original_message === 'string' && raw.original_message.trim().length > 0
            ? raw.original_message.trim()
            : htmlToPlainText(raw.message || '');

    return {
        id: raw.id,
        inserted_at: ts,
        senderType,
        status: raw.status || 'sent',
        content: text ? { type: 'text', content: text } : { type: 'system', content: '' },
    };
};

const sortAscByTime = (messages) => {
    return [...messages].sort((a, b) => new Date(a.inserted_at) - new Date(b.inserted_at));
};

const fmtDateTimeVN = (dateLike) => {
    try {
        if (!dateLike) return 'Thời gian không xác định';
        const d = new Date(dateLike);
        d.setHours(d.getHours() + 7); // +7h
        return d.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return 'Thời gian không xác định';
    }
};

// Message Content Component
const MessageContent = ({ content }) => {
    if (!content) {
        return (
            <h5 className="italic text-gray-400" style={{ textAlign: 'end' }}>
                Nội dung không hợp lệ
            </h5>
        );
    }

    switch (content.type) {
        case 'text':
            return (
                <h5 className="w-full" style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>
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
        case 'files':
            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {content.files.map((file, i) => (
                        <a
                            key={i}
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
                        >
                            <span className="text-blue-500">📎</span>
                            <span>Tệp {file.kind}</span>
                        </a>
                    ))}
                </div>
            );
        default:
            return (
                <h5 className="italic text-gray-400" style={{ textAlign: 'end' }}>
                    Tin nhắn không được hỗ trợ
                </h5>
            );
    }
};

// Main Component
export default function SyncChatMessages({
    pageConfig,
    label: initialLabels,
    token,
}) {
    // State
    const [conversations, setConversations] = useState([]);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const [messages, setMessages] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [newMessageCount, setNewMessageCount] = useState(0);

    // Refs
    const socketRef = useRef(null);
    const messagesEndRef = useRef(null);
    const selectedConvoRef = useRef(null);
    const lastMessageIdsRef = useRef(new Set());
    const lastRefreshTimeRef = useRef(0);

    // Update selected conversation ref
    useEffect(() => {
        selectedConvoRef.current = selectedConvo;
    }, [selectedConvo]);

    // Socket connection and event handlers
    useEffect(() => {
        if (!pageConfig?.id || !token) {
            console.log('[SyncChatMessages] Missing pageConfig or token');
            return;
        }

        console.log('[SyncChatMessages] Initializing socket connection to:', SOCKET_URL);
        
        const socket = io(SOCKET_URL, {
            path: '/socket.io',
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 3000,
            withCredentials: true,
        });

        socketRef.current = socket;

        // Connection events
        socket.on('connect', () => {
            console.log('[SyncChatMessages] ✅ Connected to socket');
            setIsConnected(true);
        });

        socket.on('disconnect', (reason) => {
            console.log('[SyncChatMessages] ❌ Disconnected:', reason);
            setIsConnected(false);
        });

        socket.on('connect_error', (error) => {
            console.error('[SyncChatMessages] Connection error:', error);
            setIsConnected(false);
        });

        // Message events
        socket.on('msg:new', (rawMessage) => {
            console.log('[SyncChatMessages] 📨 New message received:', rawMessage);
            
            const normalizedMessage = normalizePancakeMessage(rawMessage, pageConfig.id);
            const current = selectedConvoRef.current;
            const targetId = rawMessage?.conversationId || rawMessage?.conversation?.id;
            
            // Check if message is for current conversation
            const isCurrentConversation = current && (
                targetId === current.id ||
                extractConvoKey(targetId) === extractConvoKey(current.id)
            );

            if (isCurrentConversation) {
                // Add to current conversation messages
                setMessages((prev) => {
                    // Avoid duplicates
                    if (prev.some(m => m.id === normalizedMessage.id)) {
                        console.log('[SyncChatMessages] Message already exists, skipping');
                        return prev;
                    }
                    
                    const newMessages = sortAscByTime([...prev, normalizedMessage]);
                    console.log('[SyncChatMessages] ✅ Added message to current conversation. Total:', newMessages.length);
                    
                    // Auto scroll to bottom
                    setTimeout(() => {
                        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                    
                    return newMessages;
                });
            } else {
                // Increment new message count for other conversations
                setNewMessageCount(prev => prev + 1);
                console.log('[SyncChatMessages] New message from other conversation, count:', newMessageCount + 1);
            }

            // Update conversations list
            if (targetId) {
                setConversations((prev) => {
                    const existingConv = prev.find((c) => 
                        c.id === targetId || 
                        extractConvoKey(c.id) === extractConvoKey(targetId)
                    );
                    
                    // Giữ nguyên type từ existingConv hoặc từ rawMessage/conversation
                    const conversationType = existingConv?.type 
                        || rawMessage?.conversation?.type 
                        || rawMessage?.type 
                        || 'INBOX'; // Fallback mặc định
                    
                    const updated = {
                        ...existingConv,
                        id: targetId,
                        type: conversationType, // ✅ Giữ nguyên type gốc
                        snippet: (() => {
                            if (normalizedMessage?.content?.type === 'text') {
                                return normalizedMessage.content.content.slice(0, 100);
                            }
                            if (normalizedMessage?.content?.type === 'images') return '[Ảnh]';
                            if (normalizedMessage?.content?.type === 'files') return '[Tệp]';
                            return existingConv?.snippet || 'Chưa có tin nhắn';
                        })(),
                        updated_at: rawMessage?.inserted_at || new Date().toISOString(),
                    };
                    
                    const otherConvs = prev.filter(c => 
                        c.id !== targetId && extractConvoKey(c.id) !== extractConvoKey(targetId)
                    );
                    
                    const merged = [updated, ...otherConvs];
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
            }
        });

        // Conversation events
        socket.on('conv:patch', (patch) => {
            console.log('[SyncChatMessages] 📋 Conversation patch:', patch);
            if (patch?.pageId && String(patch.pageId) !== String(pageConfig.id)) return;
            
            setConversations((prev) => {
                let next = [...prev];
                
                if (patch.type === 'replace' && Array.isArray(patch.items)) {
                    next = patch.items.filter(isInbox);
                } else if (patch.type === 'upsert' && Array.isArray(patch.items)) {
                    const incoming = patch.items.filter(isInbox);
                    next = [...prev.filter(c => !incoming.some(i => i.id === c.id)), ...incoming];
                } else if (patch.type === 'remove' && Array.isArray(patch.ids)) {
                    const set = new Set(patch.ids);
                    next = prev.filter((c) => !set.has(c.id));
                }
                
                return next.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            });
        });

        // Initial data load
        console.log('[SyncChatMessages] Loading initial conversations...');
        socket.emit('conv:get', { 
            pageId: pageConfig.id, 
            token, 
            current_count: 0 
        }, (res) => {
            console.log('[SyncChatMessages] conv:get response:', res);
            if (res?.ok && Array.isArray(res.items)) {
                const incoming = res.items.filter(isInbox);
                
                // Đếm số lượng conversation theo type
                const inboxCount = incoming.filter(c => c.type === 'INBOX').length;
                const commentCount = incoming.filter(c => c.type === 'COMMENT').length;
                const otherCount = incoming.filter(c => c.type !== 'INBOX' && c.type !== 'COMMENT').length;
                
                console.log('📊 [SyncChatMessages] Thống kê conversation types:');
                console.log(`   ✉ INBOX: ${inboxCount} cuộc hội thoại`);
                console.log(`   🗨️ COMMENT: ${commentCount} cuộc hội thoại`);
                if (otherCount > 0) {
                    console.log(`   ❓ Khác: ${otherCount} cuộc hội thoại`);
                }
                console.log(`   📝 Tổng cộng: ${incoming.length} cuộc hội thoại`);
                
                // Debug: Log types of conversations
                console.log('[SyncChatMessages] Conversation types:', incoming.map(c => ({ id: c.id, type: c.type, name: c.customers?.[0]?.name || c.from?.name })));
                
                setConversations(prev => {
                    const merged = [...prev.filter(c => !incoming.some(i => i.id === c.id)), ...incoming];
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
                console.log('[SyncChatMessages] Loaded conversations:', incoming.length);
            } else if (res?.error) {
                console.error('[SyncChatMessages] conv:get error:', res.error);
            }
        });

        return () => {
            console.log('[SyncChatMessages] Cleaning up socket connection');
            if (selectedConvoRef.current?.id) {
                try {
                    socket.emit('msg:watchStop', {
                        pageId: pageConfig.id,
                        conversationId: selectedConvoRef.current.id,
                    });
                } catch (e) {
                    console.warn('[SyncChatMessages] Error stopping watcher:', e);
                }
            }
            socket.disconnect();
        };
    }, [pageConfig?.id, token]);

    // Debug: Log conversations khi state thay đổi
    useEffect(() => {
        if (conversations.length > 0) {
            const inboxCount = conversations.filter(c => c.type === 'INBOX').length;
            const commentCount = conversations.filter(c => c.type === 'COMMENT').length;
            const noTypeCount = conversations.filter(c => !c.type || (c.type !== 'INBOX' && c.type !== 'COMMENT')).length;
            
            console.log('📊 [SyncChatMessages] Conversations state updated:');
            console.log(`   ✉ INBOX: ${inboxCount} cuộc hội thoại`);
            console.log(`   🗨️ COMMENT: ${commentCount} cuộc hội thoại`);
            if (noTypeCount > 0) {
                console.log(`   ⚠️ Không có type hoặc type khác: ${noTypeCount} cuộc hội thoại`);
                console.log('   Details:', conversations
                    .filter(c => !c.type || (c.type !== 'INBOX' && c.type !== 'COMMENT'))
                    .map(c => ({ id: c.id, type: c.type, name: c.customers?.[0]?.name || c.from?.name }))
                );
            }
            console.log(`   📝 Tổng cộng: ${conversations.length} cuộc hội thoại`);
        } else {
            console.log('[SyncChatMessages] Conversations state is empty');
        }
    }, [conversations]);

    // Load messages for selected conversation
    const loadMessages = useCallback(async (conversationId, forceRefresh = false) => {
        if (!socketRef.current || !pageConfig?.id || !token) return;

        // Prevent too frequent refreshes
        const now = Date.now();
        if (!forceRefresh && now - lastRefreshTimeRef.current < 2000) {
            console.log('[SyncChatMessages] Refresh too frequent, skipping');
            return;
        }
        lastRefreshTimeRef.current = now;

        console.log('[SyncChatMessages] Loading messages for conversation:', conversationId, forceRefresh ? '(forced)' : '');
        setIsLoadingMessages(true);
        
        try {
            socketRef.current.emit('msg:get', {
                pageId: pageConfig.id,
                token,
                conversationId,
                customerId: null,
                count: 0 // Always get latest messages
            }, (res) => {
                console.log('[SyncChatMessages] msg:get response:', res);
                if (res?.ok && Array.isArray(res.items)) {
                    const normalizedMessages = res.items.map(msg => 
                        normalizePancakeMessage(msg, pageConfig.id)
                    );
                    const sortedMessages = sortAscByTime(normalizedMessages);
                    setMessages(sortedMessages);
                    console.log('[SyncChatMessages] ✅ Loaded messages:', sortedMessages.length);
                    
                    // Auto scroll to bottom after loading
                    setTimeout(() => {
                        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                } else if (res?.error) {
                    console.error('[SyncChatMessages] msg:get error:', res.error);
                    toast.error('Không thể tải tin nhắn: ' + res.error);
                }
                setIsLoadingMessages(false);
            });
        } catch (error) {
            console.error('[SyncChatMessages] Error loading messages:', error);
            setIsLoadingMessages(false);
            toast.error('Lỗi khi tải tin nhắn: ' + error.message);
        }
    }, [pageConfig?.id, token]);

    // Start watching for new messages
    const startWatching = useCallback((conversationId) => {
        if (!socketRef.current || !pageConfig?.id || !token) return;

        console.log('[SyncChatMessages] Starting to watch messages for:', conversationId);
        socketRef.current.emit('msg:watchStart', {
            pageId: pageConfig.id,
            token,
            conversationId,
            customerId: null,
            count: 20,
            intervalMs: 1500 // Faster polling for better sync
        }, (res) => {
            console.log('[SyncChatMessages] msg:watchStart response:', res);
            if (res?.ok) {
                console.log('[SyncChatMessages] ✅ Started watching messages');
            } else if (res?.error) {
                console.error('[SyncChatMessages] ❌ Error starting watcher:', res.error);
                toast.error('Không thể theo dõi tin nhắn: ' + res.error);
            }
        });
    }, [pageConfig?.id, token]);

    // Stop watching for messages
    const stopWatching = useCallback((conversationId) => {
        if (!socketRef.current || !pageConfig?.id) return;

        console.log('[SyncChatMessages] Stopping to watch messages for:', conversationId);
        socketRef.current.emit('msg:watchStop', {
            pageId: pageConfig.id,
            conversationId
        });
    }, [pageConfig?.id]);

    // Handle conversation selection
    const handleSelectConversation = useCallback(async (conversation) => {
        console.log('[SyncChatMessages] Selecting conversation:', conversation);
        
        if (selectedConvo?.id) {
            stopWatching(selectedConvo.id);
        }

        setSelectedConvo(conversation);
        setMessages([]);
        
        if (conversation?.id) {
            // Force refresh messages when selecting conversation
            await loadMessages(conversation.id, true);
            startWatching(conversation.id);
        }
    }, [selectedConvo?.id, stopWatching, loadMessages, startWatching]);

    // Handle refresh messages
    const handleRefreshMessages = useCallback(() => {
        if (!selectedConvo?.id) return;
        
        console.log('[SyncChatMessages] Manual refresh requested');
        setIsRefreshing(true);
        loadMessages(selectedConvo.id, true).finally(() => {
            setIsRefreshing(false);
        });
    }, [selectedConvo?.id, loadMessages]);

    // Handle sending message
    const handleSendMessage = useCallback(async (formData) => {
        const message = formData.get('message');
        if (!message?.trim() || !selectedConvo?.id) return;

        console.log('[SyncChatMessages] Sending message:', message.trim());
        
        // Add optimistic message
        const tempMessageId = Date.now().toString();
        const tempMessage = {
            id: tempMessageId,
            inserted_at: new Date().toISOString(),
            senderType: 'page',
            status: 'sending',
            content: { type: 'text', content: message.trim() }
        };

        setMessages(prev => [...prev, tempMessage]);
        
        // Scroll to bottom
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);

        try {
            // Simulate sending message (replace with actual API call)
            setTimeout(() => {
                setMessages(prev => prev.map(m => 
                    m.id === tempMessageId 
                        ? { ...m, status: 'sent' }
                        : m
                ));
            }, 1000);
        } catch (error) {
            setMessages(prev => prev.map(m => 
                m.id === tempMessageId 
                    ? { ...m, status: 'failed', error: error.message }
                    : m
            ));
        }

        // Clear form
        const form = document.querySelector('form[action="' + handleSendMessage.name + '"]');
        if (form) {
            form.reset();
        }
    }, [selectedConvo?.id]);

    return (
        <div className="h-screen flex bg-gray-50">
            <Toaster />
            
            {/* Connection Status */}
            <div className="fixed top-4 left-4 z-50">
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                    isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                    {isConnected ? '🟢 Đã kết nối' : '🔴 Mất kết nối'}
                </div>
            </div>

            {/* Sidebar */}
            <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-3 mb-3">
                        <Link href="/pancake" className="text-gray-500 hover:text-gray-700">
                            <ChevronLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-semibold text-gray-900">{pageConfig?.name}</h1>
                            <p className="text-xs text-gray-500">
                                {newMessageCount > 0 && `${newMessageCount} tin nhắn mới`}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto">
                    {(() => {
                        // Debug: Log conversations khi render
                        console.log('[SyncChatMessages] Rendering conversations:', conversations.length);
                        if (conversations.length > 0) {
                            const inboxCount = conversations.filter(c => c.type === 'INBOX').length;
                            const commentCount = conversations.filter(c => c.type === 'COMMENT').length;
                            console.log('🔍 [SyncChatMessages] Render stats - INBOX:', inboxCount, 'COMMENT:', commentCount);
                        }
                        return null;
                    })()}
                    {conversations.map((convo) => {
                        const psid = getConvoPsid(convo);
                        const avatarId = getConvoAvatarId(convo);
                        const displayName = getConvoDisplayName(convo);
                        const isSelected = selectedConvo?.id === convo.id;
                        // Lấy type từ conversation, nếu không có thì tự động phát hiện
                        let conversationType = convo?.type;
                        
                        // Debug: Log conversation type trước khi xử lý
                        if (!conversationType) {
                            console.warn('[SyncChatMessages] ⚠️ Conversation không có type:', {
                                id: convo.id,
                                name: displayName,
                                post_id: convo.post_id,
                                from_psid: convo.from_psid,
                                thread_id: convo.thread_id
                            });
                        }
                        
                        // Fallback: Tự động phát hiện type dựa trên các field
                        if (!conversationType) {
                            // COMMENT: có post_id và không có from_psid
                            if (convo.post_id && !convo.from_psid) {
                                conversationType = 'COMMENT';
                                console.log('[SyncChatMessages] 🔍 Auto-detect COMMENT:', convo.id);
                            }
                            // INBOX: có from_psid hoặc thread_id
                            else if (convo.from_psid || convo.thread_id) {
                                conversationType = 'INBOX';
                                console.log('[SyncChatMessages] 🔍 Auto-detect INBOX:', convo.id);
                            }
                        }
                        
                        // Debug: Log conversation type sau khi xử lý
                        console.log('[SyncChatMessages] 📋 Conversation:', {
                            id: convo.id,
                            finalType: conversationType,
                            originalType: convo?.type,
                            name: displayName
                        });

                        return (
                            <div
                                key={convo.id}
                                onClick={() => handleSelectConversation(convo)}
                                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                                    isSelected ? 'bg-blue-50 border-blue-200' : ''
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        <FallbackAvatar
                                            src={avatarUrlFor({ idpage: pageConfig.id, iduser: avatarId })}
                                            name={displayName}
                                            size={40}
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 truncate">{displayName}</p>
                                        <p className="text-sm text-gray-500 truncate">
                                            {convo.snippet || 'Chưa có tin nhắn'}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {fmtDateTimeVN(convo.updated_at)}
                                        </p>
                                    </div>
                                    {/* Icon phân biệt loại conversation - ở bên phải như hình 2 */}
                                    <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: '24px' }}>
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
                                        ) : (
                                            // Debug: Hiển thị type nếu không khớp
                                            <span 
                                                title={`Type: ${conversationType || 'undefined'}`} 
                                                className="text-xs text-red-500 font-bold"
                                            >
                                                {conversationType || '?'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
                {selectedConvo ? (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 border-b border-gray-200 bg-white">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        <FallbackAvatar
                                            src={avatarUrlFor({ 
                                                idpage: pageConfig.id, 
                                                iduser: getConvoAvatarId(selectedConvo) 
                                            })}
                                            name={getConvoDisplayName(selectedConvo)}
                                            size={40}
                                        />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">
                                            {getConvoDisplayName(selectedConvo)}
                                        </h3>
                                        <p className="text-sm text-gray-500">
                                            {selectedConvo.type === 'INBOX' ? 'Tin nhắn Messenger' : selectedConvo.type === 'COMMENT' ? 'Bình luận Facebook' : 'Khác'}
                                        </p>
                                    </div>
                                </div>
                                
                                {/* Refresh Button */}
                                <button
                                    onClick={handleRefreshMessages}
                                    disabled={isRefreshing}
                                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                    <span>{isRefreshing ? 'Đang tải...' : 'Làm mới'}</span>
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-1">
                            {isLoadingMessages && (
                                <div className="text-center text-gray-500 py-8">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                    Đang tải tin nhắn...
                                </div>
                            )}

                            {messages.map((msg, index) => {
                                if (!msg) return null;
                                const formattedTime = fmtDateTimeVN(msg.inserted_at);
                                const isFromPage = msg.senderType === 'page';
                                
                                return msg.content?.type === 'system' ? (
                                    <MessageContent key={msg.id || `msg-${index}`} content={msg.content} />
                                ) : (
                                    <div
                                        key={msg.id || `msg-${index}`}
                                        className={`flex flex-col my-1 ${isFromPage ? 'items-end' : 'items-start'}`}
                                    >
                                        <div
                                            className={`max-w-lg p-3 rounded-xl shadow-sm flex flex-col ${
                                                isFromPage
                                                    ? 'bg-blue-500 text-white items-end'
                                                    : 'bg-white text-gray-800'
                                            }`}
                                        >
                                            <MessageContent content={msg.content} />
                                            <div
                                                className={`text-xs mt-1 ${
                                                    isFromPage
                                                        ? 'text-right text-blue-100/80'
                                                        : 'text-left text-gray-500'
                                                }`}
                                            >
                                                {formattedTime}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Message Input */}
                        <form action={handleSendMessage} className="p-4 border-t border-gray-200 bg-white">
                            <div className="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
                                <input
                                    name="message"
                                    placeholder="Nhập tin nhắn..."
                                    className="flex-1 bg-transparent text-sm focus:outline-none"
                                    autoComplete="off"
                                />
                                <button
                                    type="submit"
                                    className="text-blue-500 hover:text-blue-700"
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
    );
}
