"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import omicallSDKManager from '@/lib/omicall-sdk-manager';
import RecordingPlayer from '@/components/call/RecordingPlayer';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
    Loader2, 
    Phone, 
    PhoneOff, 
    CircleDot, 
    AlertCircle, 
    CheckCircle,
    X,
    Calendar,
    Clock,
    User,
    MessageSquare,
    History,
    Download,
    Volume2,
    RotateCw
} from 'lucide-react';
import { maskPhoneNumber } from '@/function/index';
import { saveCallAction, call_data, reloadCallsByCustomer } from '@/data/call/wraperdata.db';

// Map SIP → Call.status
const toCallStatus = (sipCode, seconds) => {
    if (Number(seconds) > 0) return 'completed';
    const c = Number(sipCode) || 0;
    if (c === 486) return 'busy';
    if (c === 603) return 'rejected';
    if (c === 480 || c === 408) return 'no_answer';
    if (c === 487) return 'missed';
    if (c >= 500 || c >= 400) return 'failed';
    return 'failed';
};

// Map call status to Vietnamese text
const getCallStatusText = (status) => {
    const statusMap = {
        completed: 'Hoàn thành',
        busy: 'Máy bận',
        rejected: 'Từ chối',
        no_answer: 'Không trả lời',
        missed: 'Nhỡ cuộc gọi',
        failed: 'Thất bại'
    };
    return statusMap[status] || 'Không xác định';
};

// Parse duration text
const hhmmssToSec = (txt = '00:00') => {
    const parts = String(txt).split(':').map(n => Number(n) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
};

export default function CallPopup({ customer, user, onClose, isOpen }) {
    // ===== STATE MANAGEMENT =====
    const [connectionStatus, setConnectionStatus] = useState({ status: 'disconnected', text: 'Chưa kết nối' });
    const [callStage, setCallStage] = useState('idle'); // idle | connecting | ringing | in_call
    const [statusText, setStatusText] = useState('Sẵn sàng để gọi');
    const [durationText, setDurationText] = useState('00:00');
    const [isRecording, setIsRecording] = useState(false);
    const [isCalling, setIsCalling] = useState(false);
    const [callHistory, setCallHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('call');
    const [isInitialized, setIsInitialized] = useState(false);

    // ===== REFS =====
    const currentCallRef = useRef(null);
    const remoteAudioRef = useRef(null);
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const mixedCtxRef = useRef(null);
    const mixedDestRef = useRef(null);
    const endedOnceRef = useRef(false);
    const recordingStopOnceRef = useRef(false);
    const lastEndInfoRef = useRef({ statusCode: null, by: null });
    const lastDurationSecRef = useRef(0);
    const acceptedAtRef = useRef(0);
    const initializationAttemptsRef = useRef(0);
    const maxInitAttempts = 3;

    // ===== INITIALIZATION =====
    const initializeSDK = useCallback(async () => {
        console.log('[CallPopup] 🔄 Checking SDK status...');
        
        // Check if SDK is already initialized and connected
        const status = omicallSDKManager.getStatus();
        console.log('[CallPopup] 📊 Current SDK status:', status);
        
        if (status.isInitialized && status.isConnected) {
            console.log('[CallPopup] ✅ SDK already initialized and connected');
            setConnectionStatus(status.connectionStatus);
            setIsInitialized(true);
            setupEventListeners();
            return;
        }
        
        // If not connected, try to reconnect
        if (status.isInitialized && !status.isConnected) {
            console.log('[CallPopup] 🔄 SDK initialized but not connected, attempting reconnect...');
            try {
                await omicallSDKManager.connect();
                setConnectionStatus({ status: 'connected', text: 'Đã kết nối' });
                setIsInitialized(true);
                setupEventListeners();
                return;
            } catch (error) {
                console.error('[CallPopup] ❌ Reconnect failed:', error);
            }
        }
        
        // If not initialized, initialize
        try {
            initializationAttemptsRef.current += 1;
            console.log(`[CallPopup] 🔄 Initializing SDK (attempt ${initializationAttemptsRef.current}/${maxInitAttempts})...`);
            
            await omicallSDKManager.initialize();
            console.log('[CallPopup] ✅ SDK initialized');
            
            await omicallSDKManager.connect();
            console.log('[CallPopup] ✅ Connected to server');
            
            setupEventListeners();
            
            setConnectionStatus({ status: 'connected', text: 'Đã kết nối' });
            setIsInitialized(true);
            
            console.log('[CallPopup] ✅ Initialization completed successfully');
            
        } catch (error) {
            console.error('[CallPopup] ❌ Initialization failed:', error);
            
            if (initializationAttemptsRef.current < maxInitAttempts) {
                console.log(`[CallPopup] 🔄 Retrying initialization in 2 seconds...`);
                setTimeout(() => {
                    initializeSDK();
                }, 2000);
            } else {
                console.error('[CallPopup] ❌ Max initialization attempts reached');
                setConnectionStatus({ status: 'disconnected', text: 'Lỗi khởi tạo' });
                toast.error('Không thể khởi tạo hệ thống gọi');
            }
        }
    }, []);

    // ===== EVENT LISTENERS =====
    const setupEventListeners = useCallback(() => {
        console.log('[CallPopup] 🔧 Setting up event listeners...');
        
        // Status events
        const handleStatus = (status) => {
            console.log('[CallPopup] 📡 Status update:', status);
            setConnectionStatus(status);
        };

        // Call events
        const handleCall = (data) => {
            console.log('[CallPopup] 📞 Call event:', data.event, data.data);
            handleCallEvent(data.event, data.data);
        };

        // Register listeners
        omicallSDKManager.on('status', handleStatus);
        omicallSDKManager.on('call', handleCall);
        
        console.log('[CallPopup] ✅ Event listeners registered');
    }, []);

    // ===== CALL EVENT HANDLER =====
    const handleCallEvent = useCallback(async (event, data) => {
        console.log('[CallPopup] 📞 handleCallEvent:', event, data);
        
        switch (event) {
            case 'connecting':
                console.log('[CallPopup] 📞 Connecting...');
                currentCallRef.current = data;
                resetCallFlags();
                
                flushSync(() => {
                    setCallStage('connecting');
                    setStatusText('Đang kết nối...');
                    setDurationText('00:00');
                    setIsCalling(true);
                });
                break;
                
            case 'ringing':
                console.log('[CallPopup] 📞 Ringing...');
                currentCallRef.current = data;
                
                flushSync(() => {
                    setCallStage('ringing');
                    setStatusText('Đang đổ chuông...');
                });
                break;
                
            case 'accepted':
                console.log('[CallPopup] 📞 Accepted...');
                currentCallRef.current = data;
                
                flushSync(() => {
                    setCallStage('in_call');
                    setStatusText('Đang trong cuộc gọi');
                    setIsRecording(true);
                });
                
                acceptedAtRef.current = Date.now();
                await startRecording();
                break;
                
            case 'on_calling':
                console.log('[CallPopup] 📞 Duration update...');
                const text = data?.callingDuration?.text || '00:00';
                setDurationText(text);
                lastDurationSecRef.current = hhmmssToSec(text);
                break;
                
            case 'ended':
                console.log('[CallPopup] 📞 Ended...');
                const code = data?.statusCode ?? data?.code ?? data?.reasonCode ?? null;
                const by = data?.by || null;
                lastEndInfoRef.current = { statusCode: code, by };
                
                flushSync(() => {
                    setCallStage('idle');
                    setStatusText('Sẵn sàng để gọi');
                    setIsCalling(false);
                    setIsRecording(false);
                    setDurationText('00:00');
                });
                
                stopRecording();
                break;
                
            default:
                console.log('[CallPopup] 📞 Unknown event:', event);
                break;
        }
    }, []);

    // ===== RECORDING FUNCTIONS =====
    const startRecording = async () => {
        console.log('[CallPopup] 🎤 Starting recording...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            
            localStreamRef.current = stream;
            
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            mediaRecorderRef.current = mediaRecorder;
            recordedChunksRef.current = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };
            
            mediaRecorder.onstop = async () => {
                console.log('[CallPopup] 🎤 Recording stopped, processing...');
                await processRecording();
            };
            
            mediaRecorder.start(1000);
            console.log('[CallPopup] 🎤 Recording started');
            
        } catch (error) {
            console.error('[CallPopup] ❌ Recording start failed:', error);
            toast.error('Không thể bắt đầu ghi âm');
        }
    };

    const stopRecording = () => {
        console.log('[CallPopup] 🎤 Stopping recording...');
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
            
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            
            console.log('[CallPopup] 🎤 Recording stopped');
        } catch (error) {
            console.error('[CallPopup] ❌ Recording stop failed:', error);
        }
    };

    const processRecording = async () => {
        try {
            console.log('[CallPopup] 🎤 Processing recording...');
            
            const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
            console.log('[CallPopup] 🎤 Audio blob created:', audioBlob.size, 'bytes');
            
            const formData = new FormData();
            formData.append('recordingFile', audioBlob, `recording-${Date.now()}.webm`);
            formData.append('recordingFileName', `recording-${Date.now()}.webm`);
            formData.append('customerId', customer._id);
            formData.append('userId', user._id);
            formData.append('duration', lastDurationSecRef.current);
            formData.append('startTime', new Date().toISOString());
            formData.append('callStatus', 'completed');
            
            const result = await saveCallAction(null, formData);
            
            if (result.success) {
                console.log('[CallPopup] 🎤 Call saved successfully');
                toast.success('Cuộc gọi đã được lưu thành công');
                
                // Reload call history
                const history = await call_data({ customerId: customer._id });
                setCallHistory(history || []);
            } else {
                console.error('[CallPopup] ❌ Save call failed:', result.error);
                toast.error('Không thể lưu cuộc gọi: ' + result.error);
            }
            
        } catch (error) {
            console.error('[CallPopup] ❌ Process recording failed:', error);
            toast.error('Không thể xử lý ghi âm');
        }
    };

    // ===== CALL FUNCTIONS =====
    const makeCall = async () => {
        console.log('[CallPopup] 📞 makeCall() called');
        
        try {
            if (connectionStatus.status !== 'connected') {
                console.log('[CallPopup] ❌ Not connected');
                toast.error('Chưa kết nối tổng đài');
                return;
            }

            if (isCalling) {
                console.log('[CallPopup] ❌ Already calling');
                toast.warning('Đang có cuộc gọi khác');
                return;
            }

            const phoneNumber = customer?.phone;
            if (!phoneNumber) {
                console.log('[CallPopup] ❌ No phone number');
                toast.error('Thiếu số điện thoại khách hàng');
                return;
            }

            console.log('[CallPopup] 📞 Making call to:', phoneNumber);

            // Request microphone permission
            try {
                await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                    video: false
                });
            } catch (micError) {
                console.error('[CallPopup] ❌ Microphone permission denied:', micError);
                toast.error('Cần quyền truy cập microphone để thực hiện cuộc gọi');
                return;
            }
            
            const makeCallResult = await omicallSDKManager.makeCall(phoneNumber, `Gọi từ web app - ${new Date().toLocaleString('vi-VN')}`);
            console.log('[CallPopup] 📞 SDK makeCall result:', makeCallResult);
            toast.success('Đang thực hiện cuộc gọi...');
            
        } catch (error) {
            console.error('[CallPopup] ❌ Make call error:', error);
            toast.error('Không thể thực hiện cuộc gọi');
        }
    };

    const endCall = () => {
        try {
            console.log('[CallPopup] 📞 Ending call');
            
            // Reset UI state
            setCallStage('idle');
            setStatusText('Sẵn sàng để gọi');
            setIsCalling(false);
            setIsRecording(false);
            setDurationText('00:00');
            
            // End call in SDK
            omicallSDKManager.endCall();
            
            toast.success('Đã kết thúc cuộc gọi');
        } catch (error) {
            console.error('[CallPopup] ❌ End call error:', error);
            toast.error('Không thể kết thúc cuộc gọi');
        }
    };

    // ===== UTILITY FUNCTIONS =====
    const resetCallFlags = () => {
        endedOnceRef.current = false;
        recordingStopOnceRef.current = false;
        lastDurationSecRef.current = 0;
        acceptedAtRef.current = 0;
    };

    const getStatusIcon = () => {
        switch (connectionStatus.status) {
            case 'connected':
                return <CheckCircle className="h-5 w-5 text-green-500" />;
            case 'connecting':
                return <Loader2 className="h-5 w-5 animate-spin" />;
            case 'disconnected':
            default:
                return <AlertCircle className="h-5 w-5 text-red-500" />;
        }
    };

    const getLatestCall = () => {
        if (callHistory.length === 0) return null;
        return callHistory[0];
    };

    const forceReloadHistory = async () => {
        try {
            console.log('[CallPopup] 🔄 Force reloading call history...');
            await reloadCallsByCustomer(customer._id);
            
            const history = await call_data({ customerId: customer._id });
            setCallHistory(history || []);
            
            toast.success('Đã tải lại dữ liệu cuộc gọi');
        } catch (error) {
            console.error('[CallPopup] ❌ Force reload error:', error);
            toast.error('Có lỗi khi tải lại dữ liệu');
        }
    };

    const downloadAllRecordings = async () => {
        if (callHistory.length === 0) {
            toast.error('Không có ghi âm nào để tải về');
            return;
        }

        try {
            toast.info(`Đang tải về ${callHistory.length} file ghi âm...`);
            
            for (let i = 0; i < callHistory.length; i++) {
                const call = callHistory[i];
                const audioUrl = `/api/calls/${call._id}/audio`;
                
                const link = document.createElement('a');
                link.href = audioUrl;
                link.download = `Ghi_am_${customer?.name}_${new Date(call.createdAt).toLocaleDateString('vi-VN').replace(/\//g, '-')}_${i + 1}.webm`;
                link.target = '_blank';
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                if (i < callHistory.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            toast.success(`Đã tải về ${callHistory.length} file ghi âm thành công!`);
        } catch (error) {
            console.error('[CallPopup] ❌ Download all recordings error:', error);
            toast.error('Có lỗi khi tải về file ghi âm');
        }
    };

    // ===== EFFECTS =====
    useEffect(() => {
        if (!isOpen) return;
        
        console.log('[CallPopup] 🚀 Component opened, checking SDK status...');
        
        // Check if SDK is already initialized and connected
        const status = omicallSDKManager.getStatus();
        console.log('[CallPopup] 📊 SDK status:', status);
        
        if (status.isInitialized && status.isConnected) {
            console.log('[CallPopup] ✅ SDK already ready, just setting up listeners...');
            setConnectionStatus(status.connectionStatus);
            setIsInitialized(true);
            setupEventListeners();
        } else {
            console.log('[CallPopup] 🔄 SDK not ready, initializing...');
            initializeSDK();
        }
        
        return () => {
            console.log('[CallPopup] 🧹 Component closed, keeping SDK alive...');
            // Don't cleanup SDK here to maintain connection across tab switches
        };
    }, [isOpen, initializeSDK]);

    // Tab switching is handled by CallPopupWrapper

    useEffect(() => {
        if (!isOpen || !customer?._id) return;
        
        const loadCallHistory = async () => {
            try {
                setLoading(true);
                console.log('[CallPopup] 📚 Loading call history for customer:', customer._id);
                
                const history = await call_data({ customerId: customer._id });
                setCallHistory(history || []);
            } catch (error) {
                console.error('[CallPopup] ❌ Load history error:', error);
            } finally {
                setLoading(false);
            }
        };

        loadCallHistory();
    }, [customer?._id, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                            <AvatarImage src={customer?.avatar} />
                            <AvatarFallback>{customer?.name?.charAt(0) || 'C'}</AvatarFallback>
                        </Avatar>
                        <div>
                            <h2 className="text-lg font-semibold">{customer?.name || 'Không có tên'}</h2>
                            <p className="text-sm text-gray-600">{maskPhoneNumber(customer?.phone) || 'Không có số điện thoại'}</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex h-[calc(90vh-80px)]">
                    {/* Main Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        {/* Connection Status */}
                        <div className="mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    {getStatusIcon()}
                                    <span className="font-medium">Trạng thái kết nối</span>
                                </div>
                                {connectionStatus.status !== 'connected' && (
                                    <Button
                                        onClick={() => omicallSDKManager.forceReinitialize()}
                                        variant="outline"
                                        size="sm"
                                        className="flex items-center gap-2"
                                    >
                                        <RotateCw className="h-4 w-4" />
                                        Kết nối lại
                                    </Button>
                                )}
                            </div>
                            <Badge variant={connectionStatus.status === 'connected' ? 'default' : 'destructive'}>
                                {connectionStatus.text}
                            </Badge>
                        </div>

                        {/* Call Section */}
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold mb-4">Thông tin & Gọi</h3>
                            
                            {/* Customer Info */}
                            <div className="flex items-center gap-3 mb-4">
                                <Avatar className="h-12 w-12">
                                    <AvatarImage src={customer?.avatar} />
                                    <AvatarFallback>{customer?.name?.charAt(0) || 'C'}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <div className="font-medium">{customer?.name || 'Không có tên'}</div>
                                    <div className="text-sm text-gray-600">{maskPhoneNumber(customer?.phone) || 'Không có số điện thoại'}</div>
                                </div>
                            </div>

                            {/* Call Button */}
                            <div className="mb-4">
                                {callStage === 'idle' ? (
                                    <Button
                                        onClick={makeCall}
                                        disabled={connectionStatus.status !== 'connected' || !customer?.phone || isCalling}
                                        className="w-full h-12 text-lg"
                                        size="lg"
                                    >
                                        <Phone className="mr-2 h-5 w-5" />
                                        Gọi
                                    </Button>
                                ) : (
                                    <Button 
                                        variant="destructive" 
                                        onClick={endCall} 
                                        className="w-full h-12 text-lg"
                                        size="lg"
                                        disabled={!isCalling}
                                    >
                                        <PhoneOff className="mr-2 h-5 w-5" />
                                        Kết thúc cuộc gọi
                                    </Button>
                                )}
                            </div>

                            {/* Call Status Display */}
                            {isCalling && (
                                <div className="text-center space-y-2 mb-4">
                                    <div className="font-medium text-blue-600">{statusText}</div>
                                    <div className="text-2xl font-mono tracking-wider">{durationText}</div>
                                    {isRecording && (
                                        <div className="flex items-center justify-center gap-2 text-red-600">
                                            <CircleDot className="h-4 w-4 animate-pulse" />
                                            <span>Đang ghi âm…</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Recording Player */}
                            {getLatestCall() && (
                                <div className="mb-6">
                                    <div className="text-sm font-medium text-gray-700 mb-2">Ghi âm cuộc gọi gần nhất:</div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                        <RecordingPlayer 
                                            callId={getLatestCall()._id} 
                                            className="w-full"
                                        />
                                    </div>
                                </div>
                            )}

                            <Separator className="my-6" />

                            {/* Call History */}
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">Lịch sử cuộc gọi</h3>
                                    <div className="flex items-center gap-3">
                                        <div className="text-xs text-gray-500">
                                            Tổng: {callHistory.length} cuộc gọi
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                onClick={forceReloadHistory}
                                                variant="outline"
                                                size="sm"
                                                className="flex items-center gap-2"
                                            >
                                                <RotateCw className="h-4 w-4" />
                                                Tải lại
                                            </Button>
                                            {callHistory.length > 0 && (
                                                <Button
                                                    onClick={downloadAllRecordings}
                                                    variant="outline"
                                                    size="sm"
                                                    className="flex items-center gap-2"
                                                >
                                                    <Download className="h-4 w-4" />
                                                    Tải về tất cả
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {loading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <div className="text-center">
                                            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                                            <p className="text-sm text-gray-600">Đang tải lịch sử cuộc gọi...</p>
                                        </div>
                                    </div>
                                ) : callHistory.length > 0 ? (
                                    <div className="space-y-4">
                                        {callHistory.map((call, index) => (
                                            <div key={call._id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                                call.status === 'completed' ? 'bg-green-100 text-green-800' :
                                                                call.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                                call.status === 'busy' ? 'bg-yellow-100 text-yellow-800' :
                                                                'bg-gray-100 text-gray-800'
                                                            }`}>
                                                                {getCallStatusText(call.status)}
                                                            </span>
                                                            <span className="text-sm text-gray-500">
                                                                {new Date(call.createdAt).toLocaleString('vi-VN')}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-gray-600 space-y-1">
                                                            <div>👤 NV: <span className="font-medium">{call.user?.name || 'Admin'}</span></div>
                                                            <div>⏱️ Thời lượng: <span className="font-medium">
                                                                {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : '00:00'}
                                                            </span></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                <div className="bg-gray-50 rounded-lg p-3">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                                        <span className="text-sm font-medium text-gray-700">Ghi âm cuộc gọi</span>
                                                    </div>
                                                    <RecordingPlayer 
                                                        callId={call._id} 
                                                        className="w-full"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                                        <div className="text-gray-400 mb-2">
                                            <Phone className="h-12 w-12 mx-auto" />
                                        </div>
                                        <h4 className="text-lg font-medium text-gray-600 mb-2">Chưa có lịch sử cuộc gọi</h4>
                                        <p className="text-sm text-gray-500">
                                            Khách hàng <span className="font-medium">{customer?.name}</span> chưa có cuộc gọi nào được ghi lại.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar */}
                    <div className="w-64 border-l bg-gray-50 p-4">
                        <div className="space-y-2">
                            <Button
                                variant={activeTab === 'call' ? 'default' : 'ghost'}
                                className="w-full justify-start"
                                onClick={() => setActiveTab('call')}
                            >
                                <Phone className="mr-2 h-4 w-4" />
                                Cuộc gọi
                            </Button>
                            <Button
                                variant={activeTab === 'schedule' ? 'default' : 'ghost'}
                                className="w-full justify-start"
                                onClick={() => setActiveTab('schedule')}
                            >
                                <Calendar className="mr-2 h-4 w-4" />
                                Lịch trình
                            </Button>
                            <Button
                                variant={activeTab === 'history' ? 'default' : 'ghost'}
                                className="w-full justify-start"
                                onClick={() => setActiveTab('history')}
                            >
                                <History className="mr-2 h-4 w-4" />
                                Lịch sử
                            </Button>
                            <Button
                                variant={activeTab === 'info' ? 'default' : 'ghost'}
                                className="w-full justify-start"
                                onClick={() => setActiveTab('info')}
                            >
                                <User className="mr-2 h-4 w-4" />
                                Thông tin
                            </Button>
                            <Button
                                variant={activeTab === 'zalo' ? 'default' : 'ghost'}
                                className="w-full justify-start"
                                onClick={() => setActiveTab('zalo')}
                            >
                                <MessageSquare className="mr-2 h-4 w-4" />
                                Zalo
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}