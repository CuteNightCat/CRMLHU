'use client';

import { createContext, useContext, useState } from 'react';

// Tạo Context
const NotificationContext = createContext(undefined);

// Provider Component
export function NotificationProvider({ children }) {
    const [pages, setPages] = useState([]);

    const setInitialPages = (initialPages) => {
        const pagesWithCount = initialPages.map(p => ({ ...p, unreadCount: 0 }));
        setPages(pagesWithCount);
    };

    const incrementUnreadCount = (pageId) => {
        setPages(currentPages =>
            currentPages.map(p =>
                p.id === pageId ? { ...p, unreadCount: p.unreadCount + 1 } : p
            )
        );
    };

    const resetUnreadCount = (pageId) => {
        setPages(currentPages =>
            currentPages.map(p =>
                p.id === pageId ? { ...p, unreadCount: 0 } : p
            )
        );
    }

    return (
        <NotificationContext.Provider value={{ pages, setInitialPages, incrementUnreadCount, resetUnreadCount }}>
            {children}
        </NotificationContext.Provider>
    );
}

// Custom hook để dễ dàng sử dụng context
export function useNotifications() {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}