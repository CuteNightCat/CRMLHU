'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Bell, X, Eye } from 'lucide-react';

// Component notification cho tin nhắn mới
const MessageNotification = ({ 
    messages = [], 
    onViewMessage, 
    onClear, 
    maxNotifications = 3 
}) => {
    const [notifications, setNotifications] = useState([]);
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        if (messages.length > 0) {
            const newNotifications = messages.slice(0, maxNotifications).map(msg => ({
                id: msg.id,
                content: msg.content?.content || '[Nội dung không xác định]',
                time: new Date(msg.inserted_at).toLocaleTimeString('vi-VN'),
                conversationId: msg.conversationId || msg.conversation?.id,
                senderType: msg.senderType
            }));
            
            setNotifications(newNotifications);
            setIsVisible(true);

            // Auto hide after 10 seconds
            const timer = setTimeout(() => {
                setIsVisible(false);
            }, 10000);

            return () => clearTimeout(timer);
        }
    }, [messages, maxNotifications]);

    const handleViewMessage = (notification) => {
        if (onViewMessage) {
            onViewMessage(notification);
        }
        removeNotification(notification.id);
    };

    const removeNotification = (id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        if (notifications.length === 1) {
            setIsVisible(false);
        }
    };

    const handleClearAll = () => {
        setNotifications([]);
        setIsVisible(false);
        if (onClear) {
            onClear();
        }
    };

    if (!isVisible || notifications.length === 0) {
        return null;
    }

    return (
        <div className="fixed top-4 right-4 z-50 space-y-2">
            <AnimatePresence>
                {notifications.map((notification, index) => (
                    <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, x: 300, scale: 0.8 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 300, scale: 0.8 }}
                        transition={{ 
                            duration: 0.3, 
                            delay: index * 0.1,
                            ease: "easeOut" 
                        }}
                        className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-sm"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0">
                                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                                    <MessageCircle className="h-4 w-4 text-white" />
                                </div>
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-sm font-medium text-gray-900">
                                        Tin nhắn mới
                                    </p>
                                    <button
                                        onClick={() => removeNotification(notification.id)}
                                        className="text-gray-400 hover:text-gray-600"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                
                                <p className="text-sm text-gray-600 truncate">
                                    {notification.content}
                                </p>
                                
                                <div className="flex items-center justify-between mt-2">
                                    <p className="text-xs text-gray-400">
                                        {notification.time}
                                    </p>
                                    <button
                                        onClick={() => handleViewMessage(notification)}
                                        className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                                    >
                                        <Eye className="h-3 w-3" />
                                        Xem
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>

            {/* Clear all button */}
            {notifications.length > 1 && (
                <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={handleClearAll}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs py-2 px-3 rounded-lg transition-colors"
                >
                    Xóa tất cả ({notifications.length})
                </motion.button>
            )}
        </div>
    );
};

// Component badge hiển thị số lượng tin nhắn chưa đọc
export const UnreadBadge = ({ count, onClick }) => {
    if (count === 0) return null;

    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 cursor-pointer"
            onClick={onClick}
        >
            {count > 99 ? '99+' : count}
        </motion.div>
    );
};

// Component connection status
export const ConnectionStatus = ({ isConnected }) => {
    return (
        <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={isConnected ? 'text-green-600' : 'text-red-600'}>
                {isConnected ? 'Đã kết nối' : 'Mất kết nối'}
            </span>
        </div>
    );
};

export default MessageNotification;


























