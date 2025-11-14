'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Send, Loader2, ChevronLeft, Tag, ChevronDown, X, Image as ImageIcon } from 'lucide-react';
import { sendMessageAction, uploadImageToDriveAction, sendImageAction } from './actions';
import { Toaster, toast } from 'sonner';

import Image from 'next/image';
import Link from 'next/link';
import FallbackAvatar from '@/components/FallbackAvatar';
import EnhancedMessageList from '@/components/EnhancedMessageList';
import MessageNotification, { UnreadBadge, ConnectionStatus } from '@/components/MessageNotification';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';

// ======================= Cấu hình nhỏ =======================
const PAGE_SIZE = 40;

// Helper functions
const isInbox = (convo) => convo?.type === 'INBOX';
const getConvoPsid = (convo) => convo?.from_psid || null;
const getConvoAvatarId = (convo) =>
    convo?.from_psid || convo?.customers?.[0]?.fb_id || convo?.from?.id || null;
const getConvoDisplayName = (convo) =>
    convo?.customers?.[0]?.name || convo?.from?.name || 'Khách hàng ẩn';
const avatarUrlFor = ({ idpage, iduser, token }) =>
    iduser ? `https://pancake.vn/api/v1/pages/${idpage}/avatar/${iduser}?access_token=${token}` : undefined;

const extractConvoKey = (id) => {
    if (!id) return null;
    const parts = String(id).split('_');
    return parts.length > 1 ? parts[1] : parts[0];
};

// ====== THỜI GIAN: Chuẩn hoá sang VN, chỉ cộng +7 nếu chuỗi thiếu timezone ======
const parseToVNDate = (dateLike) => {
    if (!dateLike) return null;
    const raw = String(dateLike);
    const hasTZ = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return null;
    if (!hasTZ) d.setHours(d.getHours() + 7);
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

// Component chính
export default function EnhancedChatClient({
    pageConfig,
    label: initialLabels,
    token,
}) {
    // State management
    const [allLabels, setAllLabels] = useState(initialLabels || []);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [selectedFilterLabelIds, setSelectedFilterLabelIds] = useState([]);
    const [pendingImages, setPendingImages] = useState([]);
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    // Refs
    const formRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messagesScrollRef = useRef(null);
    const sidebarRef = useRef(null);
    const fileInputRef = useRef(null);

    // Use realtime messages hook
    const {
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
        setMessages
    } = useRealtimeMessages(pageConfig, token, selectedConvo?.id);

    // Handle conversation selection
    const handleSelectConversation = useCallback(async (conversation) => {
        if (selectedConvo?.id) {
            stopWatching(selectedConvo.id);
        }

        setSelectedConvo(conversation);
        
        if (conversation?.id) {
            await loadMessages(conversation.id);
            startWatching(conversation.id);
        }
    }, [selectedConvo?.id, stopWatching, loadMessages, startWatching]);

    // Handle load more messages
    const handleLoadMore = useCallback(() => {
        if (selectedConvo?.id && hasMore) {
            loadMoreMessages(selectedConvo.id);
        }
    }, [selectedConvo?.id, hasMore, loadMoreMessages]);

    // Handle sending message
    const handleSendMessage = useCallback(async (formData) => {
        const message = formData.get('message');
        if (!message?.trim() || !selectedConvo?.id) return;

        const tempMessageId = Date.now().toString();
        const tempMessage = {
            id: tempMessageId,
            inserted_at: new Date().toISOString(),
            senderType: 'page',
            status: 'sending',
            content: { type: 'text', content: message.trim() }
        };

        // Add optimistic message
        setMessages(prev => [...prev, tempMessage]);
        
        // Scroll to bottom
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);

        try {
            const result = await sendMessageAction({
                pageId: pageConfig.id,
                token,
                conversationId: selectedConvo.id,
                message: message.trim()
            });

            if (result.success) {
                // Update message status
                setMessages(prev => prev.map(m => 
                    m.id === tempMessageId 
                        ? { ...m, status: 'sent', id: result.messageId || tempMessageId }
                        : m
                ));
            } else {
                // Mark as failed
                setMessages(prev => prev.map(m => 
                    m.id === tempMessageId 
                        ? { ...m, status: 'failed', error: result.error }
                        : m
                ));
            }
        } catch (error) {
            // Mark as failed
            setMessages(prev => prev.map(m => 
                m.id === tempMessageId 
                    ? { ...m, status: 'failed', error: error.message }
                    : m
            ));
        }

        // Clear form
        if (formRef.current) {
            formRef.current.reset();
        }
    }, [selectedConvo?.id, pageConfig.id, token, setMessages]);

    // Handle image upload
    const handleImageUpload = useCallback(async (files) => {
        if (!files.length || !selectedConvo?.id) return;

        setIsUploadingImage(true);
        
        try {
            for (const file of files) {
                const uploadResult = await uploadImageToDriveAction(file);
                if (uploadResult.success) {
                    const sendResult = await sendImageAction({
                        pageId: pageConfig.id,
                        token,
                        conversationId: selectedConvo.id,
                        imageUrl: uploadResult.url
                    });
                    
                    if (!sendResult.success) {
                        toast.error('Gửi ảnh thất bại: ' + sendResult.error);
                    }
                } else {
                    toast.error('Tải ảnh lên thất bại: ' + uploadResult.error);
                }
            }
        } catch (error) {
            toast.error('Lỗi khi gửi ảnh: ' + error.message);
        } finally {
            setIsUploadingImage(false);
            setPendingImages([]);
        }
    }, [selectedConvo?.id, pageConfig.id, token]);

    // Handle notification view
    const handleNotificationView = useCallback((notification) => {
        const conversation = conversations.find(c => 
            c.id === notification.conversationId || 
            extractConvoKey(c.id) === extractConvoKey(notification.conversationId)
        );
        
        if (conversation) {
            handleSelectConversation(conversation);
            clearNewMessageCount();
        }
    }, [conversations, handleSelectConversation, clearNewMessageCount]);

    // Filter conversations
    const filteredConversations = conversations.filter(convo => {
        if (selectedFilterLabelIds.length === 0) return true;
        // Add label filtering logic here
        return true;
    });

    return (
        <div className="h-screen flex bg-gray-50">
            <Toaster />
            
            {/* Sidebar */}
            <div ref={sidebarRef} className="w-80 bg-white border-r border-gray-200 flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-3 mb-3">
                        <Link href="/pancake" className="text-gray-500 hover:text-gray-700">
                            <ChevronLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-semibold text-gray-900">{pageConfig?.name}</h1>
                            <ConnectionStatus isConnected={isConnected} />
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Tìm kiếm hội thoại..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.map((convo) => {
                        const psid = getConvoPsid(convo);
                        const avatarId = getConvoAvatarId(convo);
                        const displayName = getConvoDisplayName(convo);
                        const isSelected = selectedConvo?.id === convo.id;

                        return (
                            <div
                                key={convo.id}
                                onClick={() => handleSelectConversation(convo)}
                                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                                    isSelected ? 'bg-blue-50 border-blue-200' : ''
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <FallbackAvatar
                                            src={avatarUrlFor({ idpage: pageConfig.id, iduser: avatarId, token })}
                                            name={displayName}
                                            size={40}
                                        />
                                        {convo.unread_count > 0 && (
                                            <UnreadBadge 
                                                count={convo.unread_count} 
                                                onClick={() => handleSelectConversation(convo)}
                                            />
                                        )}
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
                                        src={avatarUrlFor({ 
                                            idpage: pageConfig.id, 
                                            iduser: getConvoAvatarId(selectedConvo),
                                            token
                                        })}
                                        name={getConvoDisplayName(selectedConvo)}
                                        size={40}
                                    />
                                    <div>
                                        <h3 className="font-semibold text-gray-900">
                                            {getConvoDisplayName(selectedConvo)}
                                        </h3>
                                        <p className="text-sm text-gray-500">
                                            {selectedConvo.type === 'INBOX' ? 'Hộp thư đến' : 'Khác'}
                                        </p>
                                    </div>
                                </div>
                                
                                {/* Add label button */}
                                {getConvoPsid(selectedConvo) ? (
                                    <button className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100">
                                        <Tag className="h-4 w-4 text-gray-500" />
                                        <span>Thêm nhãn</span>
                                    </button>
                                ) : (
                                    <button
                                        disabled
                                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-400 cursor-not-allowed"
                                    >
                                        <Tag className="h-4 w-4" />
                                        <span>Không thể gán nhãn</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Messages */}
                        <EnhancedMessageList
                            messages={messages}
                            pageId={pageConfig.id}
                            isLoadingMessages={isLoadingMessages}
                            hasMore={hasMore}
                            onLoadMore={handleLoadMore}
                            messagesEndRef={messagesEndRef}
                            messagesScrollRef={messagesScrollRef}
                        />

                        {/* Message Input */}
                        <form ref={formRef} action={handleSendMessage} className="p-4 border-t border-gray-200 bg-white">
                            {pendingImages.length > 0 && (
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
                                                onClick={() => setPendingImages(prev => prev.filter(p => p.localId !== img.localId))}
                                                className="absolute -top-2 -right-2 bg-white border rounded-full p-0.5 shadow hover:bg-gray-50"
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
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingImage}
                                >
                                    <ImageIcon className="h-5 w-5" />
                                </button>
                                
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files);
                                        handleImageUpload(files);
                                    }}
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
                                    className="text-blue-500 hover:text-blue-700 disabled:opacity-60"
                                    disabled={isUploadingImage}
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

            {/* Notifications */}
            <MessageNotification
                messages={[]} // Will be populated by the hook
                onViewMessage={handleNotificationView}
                onClear={clearNewMessageCount}
            />
        </div>
    );
}









