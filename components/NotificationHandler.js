'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useNotifications } from '@/contexts/page_pancake';

const POLLING_INTERVAL = 5000; // 5 giây

export function NotificationHandler() {
    const { incrementUnreadCount } = useNotifications();

    useEffect(() => {
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch('/api/notifications');
                if (!response.ok) return;

                const newNotifications = await response.json();

                if (Array.isArray(newNotifications) && newNotifications.length > 0) {
                    newNotifications.forEach(notification => {
                        const pageId = notification.data?.page_id;

                        if (pageId) {
                            incrementUnreadCount(pageId);
                        }

                        const messageContent = notification.data?.data?.message?.text || 'Bạn có tin nhắn mới!';
                        const senderName = notification.data?.data?.sender?.name || 'Một khách hàng';
                        toast.info(`Tin nhắn mới từ ${senderName}`, { description: messageContent });
                    });
                }
            } catch (error) {
                console.error('Lỗi khi polling thông báo:', error);
            }
        }, POLLING_INTERVAL);

        return () => clearInterval(intervalId);
    }, [incrementUnreadCount]);

    return null;
}