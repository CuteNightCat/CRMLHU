"use client";

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Phone, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import CallPopup from './CallPopup';
import omicallSDKManager from '@/lib/omicall-sdk-manager';

export default function CallPopupWrapper({ customer, user }) {
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState({ status: 'disconnected', text: 'Chưa kết nối' });
    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize SDK once when component mounts
    useEffect(() => {
        const initializeSDK = async () => {
            try {
                console.log('[CallPopupWrapper] 🚀 Initializing SDK...');
                await omicallSDKManager.initialize();
                await omicallSDKManager.connect();
                setIsInitialized(true);
                console.log('[CallPopupWrapper] ✅ SDK initialized and connected');
            } catch (error) {
                console.error('[CallPopupWrapper] ❌ SDK initialization failed:', error);
            }
        };

        initializeSDK();

        // Setup event listeners
        const handleStatus = (status) => {
            console.log('[CallPopupWrapper] 📡 Status update:', status);
            setConnectionStatus(status);
        };

        omicallSDKManager.on('status', handleStatus);

        // Handle tab switching
        const handleTabSwitch = () => {
            console.log('[CallPopupWrapper] 🔄 Tab switch detected');
            omicallSDKManager.handleTabSwitch();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('[CallPopupWrapper] 👁️ Tab became visible');
                omicallSDKManager.handleTabSwitch();
            }
        };

        // Listen for tab switch events
        window.addEventListener('focus', handleTabSwitch);
        window.addEventListener('blur', handleTabSwitch);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            // Don't cleanup SDK on unmount to maintain connection
            window.removeEventListener('focus', handleTabSwitch);
            window.removeEventListener('blur', handleTabSwitch);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    const openPopup = () => {
        setIsPopupOpen(true);
    };

    const closePopup = () => {
        setIsPopupOpen(false);
    };

    const getStatusIcon = () => {
        switch (connectionStatus.status) {
            case 'connected':
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case 'connecting':
                return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
            case 'disconnected':
            default:
                return <AlertCircle className="h-4 w-4 text-red-500" />;
        }
    };

    return (
        <>
            {/* Connection Status */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {getStatusIcon()}
                        <span className="text-sm font-medium">Trạng thái kết nối</span>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                        connectionStatus.status === 'connected' 
                            ? 'bg-green-100 text-green-800' 
                            : connectionStatus.status === 'connecting'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                    }`}>
                        {connectionStatus.text}
                    </span>
                </div>
            </div>

            {/* Trigger Button */}
            <Button
                onClick={openPopup}
                className="w-full"
                size="lg"
                disabled={!isInitialized}
            >
                <Phone className="mr-2 h-4 w-4" />
                {isInitialized ? 'Mở popup gọi điện' : 'Đang khởi tạo...'}
            </Button>

            {/* Popup */}
            <CallPopup
                customer={customer}
                user={user}
                isOpen={isPopupOpen}
                onClose={closePopup}
            />
        </>
    );
}
