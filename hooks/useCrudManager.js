'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function useCrudManager() {
    const router = useRouter();
    // Cấu trúc state mới: tách biệt list và action
    const [listPopupOpen, setListPopupOpen] = useState(false);
    const [actionPopup, setActionPopup] = useState({ open: false, mode: null, item: null });
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });

    // Hàm xử lý chung sau khi action hoàn thành
    const handleActionComplete = (actionState) => {
        if (actionState?.message) {
            setNotification({ open: true, status: actionState.status, mes: actionState.message });
            if (actionState.status === true) {
                router.refresh();
                closeActionPopup(); // Chỉ đóng popup hành động
            }
        }
    };

    // Mở/đóng popup danh sách
    const toggleListPopup = () => setListPopupOpen(prev => !prev);
    const closeListPopup = () => setListPopupOpen(false);


    // Mở popup hành động (create, update, delete)
    const openActionPopup = (mode, item = null) => {
        setActionPopup({ open: true, mode, item });
    };

    // Đóng popup hành động
    const closeActionPopup = () => {
        setActionPopup({ open: false, mode: null, item: null });
    };

    // Đóng thông báo
    const closeNotification = () => {
        setNotification(prev => ({ ...prev, open: false }));
    };

    return {
        listPopupOpen,
        actionPopup,
        notification,
        toggleListPopup,
        closeListPopup,
        openActionPopup,
        closeActionPopup,
        closeNotification,
        handleActionComplete,
    };
}