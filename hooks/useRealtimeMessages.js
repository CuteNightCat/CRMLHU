'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

// Helper functions
const extractConvoKey = (id) => {
    if (!id) return null;
    const parts = String(id).split('_');
    return parts.length > 1 ? parts[1] : parts[0];
};

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

// Hook chính
export const useRealtimeMessages = (pageConfig, token, selectedConversationId) => {
    const [messages, setMessages] = useState([]);
    const [conversations, setConversations] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    
    const socketRef = useRef(null);
    const selectedConvoRef = useRef(selectedConversationId);
    const lastMessageCountRef = useRef(0);

    // Update selected conversation ref
    useEffect(() => {
        selectedConvoRef.current = selectedConversationId;
    }, [selectedConversationId]);

    // Socket connection and event handlers
    useEffect(() => {
        if (!pageConfig?.id || !token) return;

        const SOCKET_URL = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3100';
        const socket = io(SOCKET_URL, {
            path: '/socket.io',
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 3000, // port thay doi 3000 -> 4000
            withCredentials: true, // thay doi 3000 -> 4000
        });

        socketRef.current = socket;

        // Connection events
        socket.on('connect', () => {
            setIsConnected(true);
            console.log('[useRealtimeMessages] Connected to socket');
        });

        socket.on('disconnect', (reason) => {
            setIsConnected(false);
            console.log('[useRealtimeMessages] Disconnected:', reason);
        });

        socket.on('connect_error', (error) => {
            console.error('[useRealtimeMessages] Connection error:', error);
        });

        // Message events
        socket.on('msg:new', (rawMessage) => {
            console.log('[useRealtimeMessages] New message received:', rawMessage);
            
            const normalizedMessage = normalizePancakeMessage(rawMessage, pageConfig.id);
            const current = selectedConvoRef.current;
            const targetId = rawMessage?.conversationId || rawMessage?.conversation?.id;
            
            // Add to messages if it's from the current conversation
            if (
                current &&
                (targetId === current.id ||
                    extractConvoKey(targetId) === extractConvoKey(current.id))
            ) {
                setMessages((prev) => {
                    const newMessages = sortAscByTime([...prev, normalizedMessage]);
                    return newMessages;
                });
            } else {
                // Increment new message count for other conversations
                setNewMessageCount(prev => prev + 1);
            }

            // Update conversations list
            if (targetId) {
                setConversations((prev) => {
                    const conv =
                        prev.find((c) => c.id === targetId) ||
                        prev.find((c) => extractConvoKey(c.id) === extractConvoKey(targetId)) || {
                            id: targetId,
                            type: 'INBOX',
                        };
                    
                    const updated = {
                        ...conv,
                        snippet: (() => {
                            if (normalizedMessage?.content?.type === 'text') {
                                return normalizedMessage.content.content;
                            }
                            if (normalizedMessage?.content?.type === 'images') return '[Ảnh]';
                            if (normalizedMessage?.content?.type === 'files') return '[Tệp]';
                            return conv.snippet;
                        })(),
                        updated_at: rawMessage?.inserted_at || new Date().toISOString(),
                    };
                    
                    const merged = [...prev.filter(c => c.id !== targetId), updated];
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
            }
        });

        // Conversation events
        socket.on('conv:patch', (patch) => {
            if (patch?.pageId && String(patch.pageId) !== String(pageConfig.id)) return;
            
            setConversations((prev) => {
                let next = [...prev];
                
                if (patch.type === 'replace' && Array.isArray(patch.items)) {
                    next = patch.items.filter(c => {
                        const type = c?.type;
                        return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
                    });
                } else if (patch.type === 'upsert' && Array.isArray(patch.items)) {
                    const incoming = patch.items.filter(c => {
                        const type = c?.type;
                        return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
                    });
                    next = [...prev.filter(c => !incoming.some(i => i.id === c.id)), ...incoming];
                } else if (patch.type === 'remove' && Array.isArray(patch.ids)) {
                    const set = new Set(patch.ids);
                    next = prev.filter((c) => !set.has(c.id));
                }
                
                return next.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            });
        });

        // Initial data load
        socket.emit('conv:get', { 
            pageId: pageConfig.id, 
            token, 
            current_count: 0 
        }, (res) => {
            if (res?.ok && Array.isArray(res.items)) {
                const incoming = res.items.filter(c => {
                    const type = c?.type;
                    return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
                });
                setConversations(prev => {
                    const merged = [...prev.filter(c => !incoming.some(i => i.id === c.id)), ...incoming];
                    return merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                });
            } else if (res?.error) {
                console.error('[useRealtimeMessages] conv:get error:', res.error);
            }
        });

        return () => {
            if (selectedConvoRef.current?.id) {
                try {
                    socket.emit('msg:watchStop', {
                        pageId: pageConfig.id,
                        conversationId: selectedConvoRef.current.id,
                    });
                } catch (e) {
                    console.warn('[useRealtimeMessages] Error stopping watcher:', e);
                }
            }
            socket.disconnect();
        };
    }, [pageConfig?.id, token]);

    // Load messages for selected conversation
    const loadMessages = useCallback(async (conversationId, count = 0) => {
        if (!socketRef.current || !pageConfig?.id || !token) return;

        setIsLoadingMessages(true);
        
        try {
            socketRef.current.emit('msg:get', {
                pageId: pageConfig.id,
                token,
                conversationId,
                customerId: null,
                count
            }, (res) => {
                if (res?.ok && Array.isArray(res.items)) {
                    const normalizedMessages = res.items.map(msg => 
                        normalizePancakeMessage(msg, pageConfig.id)
                    );
                    setMessages(sortAscByTime(normalizedMessages));
                    setHasMore(res.items.length === (count === 0 ? 20 : count));
                } else if (res?.error) {
                    console.error('[useRealtimeMessages] msg:get error:', res.error);
                }
                setIsLoadingMessages(false);
            });
        } catch (error) {
            console.error('[useRealtimeMessages] Error loading messages:', error);
            setIsLoadingMessages(false);
        }
    }, [pageConfig?.id, token]);

    // Start watching for new messages
    const startWatching = useCallback((conversationId) => {
        if (!socketRef.current || !pageConfig?.id || !token) return;

        socketRef.current.emit('msg:watchStart', {
            pageId: pageConfig.id,
            token,
            conversationId,
            customerId: null,
            count: 20,
            intervalMs: 2500
        }, (res) => {
            if (res?.ok) {
                console.log('[useRealtimeMessages] Started watching messages');
            } else if (res?.error) {
                console.error('[useRealtimeMessages] Error starting watcher:', res.error);
            }
        });
    }, [pageConfig?.id, token]);

    // Stop watching for messages
    const stopWatching = useCallback((conversationId) => {
        if (!socketRef.current || !pageConfig?.id) return;

        socketRef.current.emit('msg:watchStop', {
            pageId: pageConfig.id,
            conversationId
        });
    }, [pageConfig?.id]);

    // Clear new message count
    const clearNewMessageCount = useCallback(() => {
        setNewMessageCount(0);
    }, []);

    // Load more messages (for pagination)
    const loadMoreMessages = useCallback(async (conversationId) => {
        if (!conversationId || isLoadingMessages) return;
        
        const currentCount = messages.length;
        await loadMessages(conversationId, currentCount);
    }, [messages.length, loadMessages, isLoadingMessages]);

    return {
        messages,
        conversations,
        isConnected,
        newMessageCount,
        isLoadingMessages,
        hasMore,
        loadMessages,
        loadMoreMessages,
        startWatching,
        stopWatching,
        clearNewMessageCount,
        setMessages,
        setConversations
    };
};

