'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSocket } from '@/lib/realtime/socket-client';
import { Bell, MessageCircle, Eye } from 'lucide-react';

// Component hiển thị tin nhắn mới với animation
const NewMessageBubble = ({ message, onView }) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="fixed bottom-20 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-sm z-50"
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                        <MessageCircle className="h-4 w-4 text-white" />
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                            Tin nhắn mới
                        </p>
                        <button
                            onClick={onView}
                            className="text-blue-500 hover:text-blue-700"
                        >
                            <Eye className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                        {message?.content?.content || '[Nội dung không xác định]'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                        {new Date(message?.inserted_at).toLocaleTimeString('vi-VN')}
                    </p>
                </div>
            </div>
        </motion.div>
    );
};

// Component notification badge
const NotificationBadge = ({ count, onClick }) => {
    if (count === 0) return null;
    
    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center cursor-pointer"
            onClick={onClick}
        >
            {count > 99 ? '99+' : count}
        </motion.div>
    );
};

// Hook quản lý tin nhắn realtime
const useRealtimeMessages = (pageId, token, selectedConversationId) => {
    const [newMessages, setNewMessages] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef(null);
    const lastMessageRef = useRef(null);

    useEffect(() => {
        const socket = getSocket();
        socketRef.current = socket;

        // Kết nối events
        socket.on('connect', () => {
            setIsConnected(true);
            console.log('[RealtimeMessages] Connected to socket');
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
            console.log('[RealtimeMessages] Disconnected from socket');
        });

        // Lắng nghe tin nhắn mới
        socket.on('msg:new', (message) => {
            console.log('[RealtimeMessages] New message received:', message);
            
            // Chỉ hiển thị notification nếu không phải tin nhắn từ conversation đang xem
            const messageConvId = message?.conversationId || message?.conversation?.id;
            const isFromCurrentConv = selectedConversationId && 
                (messageConvId === selectedConversationId || 
                 extractConvoKey(messageConvId) === extractConvoKey(selectedConversationId));

            if (!isFromCurrentConv) {
                setNewMessages(prev => [message, ...prev.slice(0, 4)]); // Giữ tối đa 5 tin nhắn
                setUnreadCount(prev => prev + 1);
                
                // Hiển thị notification trong 5 giây
                setTimeout(() => {
                    setNewMessages(prev => prev.filter(m => m.id !== message.id));
                }, 5000);
            }
        });

        // Lắng nghe cập nhật conversation
        socket.on('conv:patch', (patch) => {
            if (patch?.pageId && String(patch.pageId) !== String(pageId)) return;
            
            // Cập nhật unread count nếu cần
            if (patch.type === 'upsert' && Array.isArray(patch.items)) {
                // Logic cập nhật unread count dựa trên patch
                console.log('[RealtimeMessages] Conversation updated:', patch);
            }
        });

        return () => {
            if (socketRef.current) {
                socketRef.current.off('msg:new');
                socketRef.current.off('conv:patch');
                socketRef.current.off('connect');
                socketRef.current.off('disconnect');
            }
        };
    }, [pageId, token, selectedConversationId]);

    const clearUnreadCount = useCallback(() => {
        setUnreadCount(0);
    }, []);

    const removeNewMessage = useCallback((messageId) => {
        setNewMessages(prev => prev.filter(m => m.id !== messageId));
    }, []);

    return {
        newMessages,
        unreadCount,
        isConnected,
        clearUnreadCount,
        removeNewMessage
    };
};

// Helper function để extract conversation key
const extractConvoKey = (id) => {
    if (!id) return null;
    const parts = String(id).split('_');
    return parts.length > 1 ? parts[1] : parts[0];
};

// Component chính
const RealtimeMessageDisplay = ({ 
    pageId, 
    token, 
    selectedConversationId, 
    onMessageClick,
    className = "" 
}) => {
    const {
        newMessages,
        unreadCount,
        isConnected,
        clearUnreadCount,
        removeNewMessage
    } = useRealtimeMessages(pageId, token, selectedConversationId);

    const [showNotifications, setShowNotifications] = useState(true);

    const handleMessageClick = useCallback((message) => {
        if (onMessageClick) {
            onMessageClick(message);
        }
        removeNewMessage(message.id);
    }, [onMessageClick, removeNewMessage]);

    const handleClearAll = useCallback(() => {
        setNewMessages([]);
        clearUnreadCount();
    }, [clearUnreadCount]);

    return (
        <div className={`relative ${className}`}>
            {/* Connection Status Indicator */}
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-gray-500">
                    {isConnected ? 'Đã kết nối' : 'Mất kết nối'}
                </span>
            </div>

            {/* Unread Count Badge */}
            {unreadCount > 0 && (
                <div className="relative inline-block">
                    <Bell className="h-6 w-6 text-gray-500" />
                    <NotificationBadge 
                        count={unreadCount} 
                        onClick={clearUnreadCount}
                    />
                </div>
            )}

            {/* New Message Notifications */}
            <AnimatePresence>
                {showNotifications && newMessages.map((message) => (
                    <NewMessageBubble
                        key={message.id}
                        message={message}
                        onView={() => handleMessageClick(message)}
                    />
                ))}
            </AnimatePresence>

            {/* Control Panel */}
            {newMessages.length > 0 && (
                <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-50">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">
                            {newMessages.length} tin nhắn mới
                        </span>
                        <button
                            onClick={handleClearAll}
                            className="text-xs text-blue-500 hover:text-blue-700"
                        >
                            Xóa tất cả
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RealtimeMessageDisplay;

