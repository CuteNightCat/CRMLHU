'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Loader2, MessageCircle, Bell } from 'lucide-react';

// Component hiển thị tin nhắn với animation
const AnimatedMessage = ({ message, isNew = false, pageId }) => {
    const formattedTime = useMemo(() => {
        if (!message?.inserted_at) return 'Thời gian không xác định';
        try {
            const raw = String(message.inserted_at);
            const hasTZ = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
            const d = new Date(message.inserted_at);
            if (!Number.isNaN(d.getTime()) && !hasTZ) {
                d.setHours(d.getHours() + 7);
            }
            return d.toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return 'Thời gian không xác định';
        }
    }, [message?.inserted_at]);

    const isFromPage = message?.senderType === 'page';

    return (
        <motion.div
            initial={isNew ? { opacity: 0, y: 20, scale: 0.95 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={`flex flex-col my-1 ${isFromPage ? 'items-end' : 'items-start'}`}
        >
            <div
                className={`max-w-lg p-3 rounded-xl shadow-sm flex flex-col relative ${
                    isFromPage
                        ? 'bg-blue-500 text-white items-end'
                        : 'bg-white text-gray-800'
                }`}
            >
                {/* New message indicator */}
                {isNew && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"
                    />
                )}

                {/* Message content */}
                <MessageContent content={message?.content} />
                
                {/* Message time */}
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

            {/* Message status for sent messages */}
            {isFromPage && (
                <MessageStatus status={message?.status} error={message?.error} />
            )}
        </motion.div>
    );
};

// Component hiển thị nội dung tin nhắn
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

// Component hiển thị trạng thái tin nhắn
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

// Component chính - Enhanced Message List
const EnhancedMessageList = ({
    messages = [],
    pageId,
    isLoadingMessages = false,
    isLoadingOlder = false,
    hasMore = true,
    onLoadMore,
    messagesEndRef,
    messagesScrollRef,
    className = ""
}) => {
    const [newMessageIds, setNewMessageIds] = useState(new Set());
    const [isNearBottom, setIsNearBottom] = useState(true);
    const lastMessageCountRef = useRef(messages.length);

    // Theo dõi tin nhắn mới
    useEffect(() => {
        if (messages.length > lastMessageCountRef.current) {
            const newCount = messages.length - lastMessageCountRef.current;
            const newIds = messages.slice(-newCount).map(m => m.id);
            setNewMessageIds(new Set(newIds));
            
            // Tự động scroll xuống nếu đang ở gần cuối
            if (isNearBottom) {
                setTimeout(() => {
                    messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
            
            // Xóa flag "new" sau 3 giây
            setTimeout(() => {
                setNewMessageIds(new Set());
            }, 3000);
        }
        lastMessageCountRef.current = messages.length;
    }, [messages.length, messagesEndRef, isNearBottom]);

    // Theo dõi scroll position
    const handleScroll = useCallback(() => {
        if (messagesScrollRef?.current) {
            const { scrollTop, scrollHeight, clientHeight } = messagesScrollRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            setIsNearBottom(distanceFromBottom < 100);
        }
    }, [messagesScrollRef]);

    // Load more messages khi scroll lên đầu
    const handleScrollToTop = useCallback(() => {
        if (messagesScrollRef?.current) {
            const { scrollTop } = messagesScrollRef.current;
            if (scrollTop === 0 && hasMore && !isLoadingOlder && onLoadMore) {
                onLoadMore();
            }
        }
    }, [hasMore, isLoadingOlder, onLoadMore, messagesScrollRef]);

    const handleScrollEvent = useCallback(() => {
        handleScroll();
        handleScrollToTop();
    }, [handleScroll, handleScrollToTop]);

    return (
        <div
            className={`flex-1 overflow-y-auto ${className}`}
            ref={messagesScrollRef}
            onScroll={handleScrollEvent}
        >
            <div className="p-6 space-y-1">
                {/* Loading indicator for older messages */}
                {isLoadingOlder && (
                    <div className="text-center text-xs text-gray-400 mb-2">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                        Đang tải tin nhắn cũ…
                    </div>
                )}

                {/* Loading indicator for initial messages */}
                {isLoadingMessages && (
                    <div className="text-center text-gray-500 py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                        Đang tải tin nhắn...
                    </div>
                )}

                {/* Messages */}
                <AnimatePresence mode="popLayout">
                    {messages.map((msg, index) => {
                        if (!msg) return null;
                        const isNew = newMessageIds.has(msg.id);
                        
                        return msg.content?.type === 'system' ? (
                            <MessageContent key={msg.id || `msg-${index}`} content={msg.content} />
                        ) : (
                            <AnimatedMessage
                                key={msg.id || `msg-${index}`}
                                message={msg}
                                isNew={isNew}
                                pageId={pageId}
                            />
                        );
                    })}
                </AnimatePresence>

                {/* Scroll to bottom button */}
                {!isNearBottom && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => {
                            messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="fixed bottom-20 right-4 bg-blue-500 text-white p-2 rounded-full shadow-lg hover:bg-blue-600 transition-colors z-10"
                    >
                        <MessageCircle className="h-5 w-5" />
                    </motion.button>
                )}

                {/* End of messages marker */}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
};

export default EnhancedMessageList;

