'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Search, Send, Loader2, ChevronLeft, RefreshCw, AlertCircle } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import Link from 'next/link';
import FallbackAvatar from '@/components/FallbackAvatar';

const SOCKET_URL = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3100';

// Simple message normalization
const normalizeMessage = (raw, pageId) => {
    const senderType = String(raw?.from?.id || '') === String(pageId) ? 'page' : 'customer';
    const text = raw?.original_message || raw?.message || '';
    
    return {
        id: raw.id,
        inserted_at: raw.inserted_at,
        senderType,
        content: { type: 'text', content: text.trim() },
    };
};

const fmtTime = (dateLike) => {
    try {
        const d = new Date(dateLike);
        d.setHours(d.getHours() + 7);
        return d.toLocaleString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '--:--';
    }
};

export default function QuickFixChat({ pageConfig, token }) {
    const [conversations, setConversations] = useState([]);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const [messages, setMessages] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    const socketRef = useRef(null);
    const messagesEndRef = useRef(null);
    const selectedConvoRef = useRef(null);
    const lastMessageIdRef = useRef(null);

    useEffect(() => {
        selectedConvoRef.current = selectedConvo;
    }, [selectedConvo]);

    // Socket connection
    useEffect(() => {
        if (!pageConfig?.id || !token) return;

        // console.log('🔌 Connecting to socket...');
        const socket = io(SOCKET_URL, {
            path: '/socket.io',
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
            withCredentials: true,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            // console.log('✅ Socket connected');
            setIsConnected(true);
        });

        socket.on('disconnect', () => {
            // console.log('❌ Socket disconnected');
            setIsConnected(false);
        });

        // Handle new messages
        socket.on('msg:new', (rawMsg) => {
            // console.log('📨 New message:', rawMsg);
            
            const current = selectedConvoRef.current;
            const msgConvId = rawMsg?.conversationId || rawMsg?.conversation?.id;
            
            // Check if this message is for current conversation
            const isCurrentConv = current && (
                msgConvId === current.id || 
                msgConvId?.includes(current.id?.split('_')[1]) ||
                current.id?.includes(msgConvId?.split('_')[1])
            );

            if (isCurrentConv) {
                const normalizedMsg = normalizeMessage(rawMsg, pageConfig.id);
                
                setMessages(prev => {
                    // Avoid duplicates
                    if (prev.some(m => m.id === normalizedMsg.id)) {
                        // console.log('⚠️ Duplicate message, skipping');
                        return prev;
                    }
                    
                    const newMessages = [...prev, normalizedMsg].sort(
                        (a, b) => new Date(a.inserted_at) - new Date(b.inserted_at)
                    );
                    
                    // console.log('✅ Message added, total:', newMessages.length);
                    
                    // Auto scroll
                    setTimeout(() => {
                        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                    
                    return newMessages;
                });
            }

            // Update conversations
            if (msgConvId) {
                setConversations(prev => {
                    const existing = prev.find(c => 
                        c.id === msgConvId || 
                        c.id?.includes(msgConvId?.split('_')[1]) ||
                        msgConvId?.includes(c.id?.split('_')[1])
                    );
                    
                    const updated = {
                        ...existing,
                        id: msgConvId,
                        snippet: rawMsg?.original_message || rawMsg?.message || '',
                        updated_at: rawMsg?.inserted_at || new Date().toISOString(),
                    };
                    
                    const others = prev.filter(c => c.id !== msgConvId);
                    return [updated, ...others].sort(
                        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
                    );
                });
            }
        });

        // Load initial conversations
        socket.emit('conv:get', { 
            pageId: pageConfig.id, 
            token, 
            current_count: 0 
        }, (res) => {
            // console.log('📋 Conversations loaded:', res);
            if (res?.ok && Array.isArray(res.items)) {
                setConversations(res.items.filter(c => {
                    const type = c?.type;
                    return type === 'INBOX' || type === 'COMMENT' || type === 'MESSAGE';
                }));
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [pageConfig?.id, token]);

    // Load messages for conversation
    const loadMessages = useCallback(async (conversationId) => {
        if (!socketRef.current || !conversationId) return;

        // console.log('📤 Loading messages for:', conversationId);
        setIsLoading(true);
        
        socketRef.current.emit('msg:get', {
            pageId: pageConfig.id,
            token,
            conversationId,
            customerId: null,
            count: 0
        }, (res) => {
            // console.log('📨 Messages response:', res);
            if (res?.ok && Array.isArray(res.items)) {
                const normalizedMessages = res.items.map(msg => normalizeMessage(msg, pageConfig.id));
                setMessages(normalizedMessages.sort(
                    (a, b) => new Date(a.inserted_at) - new Date(b.inserted_at)
                ));
                
                // Auto scroll to bottom
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
            setIsLoading(false);
        });
    }, [pageConfig?.id, token]);

    // Start watching messages
    const startWatching = useCallback((conversationId) => {
        if (!socketRef.current || !conversationId) return;

        // console.log('👁️ Starting to watch:', conversationId);
        socketRef.current.emit('msg:watchStart', {
            pageId: pageConfig.id,
            token,
            conversationId,
            customerId: null,
            count: 50, // Load more messages
            intervalMs: 1000 // Faster polling
        }, (res) => {
            // console.log('👁️ Watch started:', res);
        });
    }, [pageConfig?.id, token]);

    // Select conversation
    const selectConversation = useCallback(async (conversation) => {
        console.log('🎯 Selecting conversation:', conversation);
        
        // Stop watching previous conversation
        if (selectedConvo?.id) {
            socketRef.current?.emit('msg:watchStop', {
                pageId: pageConfig.id,
                conversationId: selectedConvo.id
            });
        }

        setSelectedConvo(conversation);
        setMessages([]);
        
        if (conversation?.id) {
            await loadMessages(conversation.id);
            startWatching(conversation.id);
        }
    }, [selectedConvo?.id, loadMessages, startWatching, pageConfig?.id]);

    // Force refresh messages
    const forceRefresh = useCallback(() => {
        if (!selectedConvo?.id) return;
        
        console.log('🔄 Force refreshing messages...');
        setIsLoading(true);
        
        // Stop current watching
        socketRef.current?.emit('msg:watchStop', {
            pageId: pageConfig.id,
            conversationId: selectedConvo.id
        });
        
        // Reload messages
        setTimeout(() => {
            loadMessages(selectedConvo.id);
            startWatching(selectedConvo.id);
        }, 500);
        
        toast.success('Đang làm mới tin nhắn...');
    }, [selectedConvo?.id, loadMessages, startWatching, pageConfig?.id]);

    return (
        <div className="h-screen flex bg-gray-50">
            <Toaster />
            
            {/* Connection Status */}
            <div className="fixed top-4 left-4 z-50">
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                    isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                    {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
            </div>

            {/* Sidebar */}
            <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-3 mb-3">
                        <Link href="/pancake" className="text-gray-500 hover:text-gray-700">
                            <ChevronLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-semibold text-gray-900">{pageConfig?.name}</h1>
                            <p className="text-xs text-gray-500">Quick Fix Chat</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {conversations.map((convo) => {
                        const isSelected = selectedConvo?.id === convo.id;
                        const displayName = convo?.customers?.[0]?.name || convo?.from?.name || 'Khách hàng';
                        
                        return (
                            <div
                                key={convo.id}
                                onClick={() => selectConversation(convo)}
                                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                                    isSelected ? 'bg-blue-50 border-blue-200' : ''
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <FallbackAvatar
                                        src={`https://pancake.vn/api/v1/pages/${pageConfig.id}/avatar/${convo?.from_psid || convo?.customers?.[0]?.fb_id}`}
                                        name={displayName}
                                        size={40}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 truncate">{displayName}</p>
                                        <p className="text-sm text-gray-500 truncate">
                                            {convo.snippet || 'Chưa có tin nhắn'}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {fmtTime(convo.updated_at)}
                                        </p>
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
                                    <FallbackAvatar
                                        src={`https://pancake.vn/api/v1/pages/${pageConfig.id}/avatar/${selectedConvo?.from_psid || selectedConvo?.customers?.[0]?.fb_id}`}
                                        name={selectedConvo?.customers?.[0]?.name || selectedConvo?.from?.name || 'Khách hàng'}
                                        size={40}
                                    />
                                    <div>
                                        <h3 className="font-semibold text-gray-900">
                                            {selectedConvo?.customers?.[0]?.name || selectedConvo?.from?.name || 'Khách hàng'}
                                        </h3>
                                        <p className="text-sm text-gray-500">Hộp thư đến</p>
                                    </div>
                                </div>
                                
                                <button
                                    onClick={forceRefresh}
                                    disabled={isLoading}
                                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                    <span>Làm mới</span>
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-1">
                            {isLoading && (
                                <div className="text-center text-gray-500 py-8">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                    Đang tải tin nhắn...
                                </div>
                            )}

                            {messages.map((msg, index) => {
                                const isFromPage = msg.senderType === 'page';
                                const formattedTime = fmtTime(msg.inserted_at);
                                
                                return (
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
                                            <p className="w-full" style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>
                                                {msg.content?.content || 'Nội dung không hợp lệ'}
                                            </p>
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
                        <form className="p-4 border-t border-gray-200 bg-white">
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
                        <div className="text-center">
                            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                            <p className="text-lg font-medium">Chọn một hội thoại để bắt đầu</p>
                            <p className="text-sm mt-2">Quick Fix Chat - Đồng bộ tin nhắn realtime</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
