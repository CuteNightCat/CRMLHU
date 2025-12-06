"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Phone, PhoneOff, CircleDot, AlertCircle, CheckCircle } from 'lucide-react';
import RecordingPlayer from '@/components/call/RecordingPlayer';

// Số điện thoại cố định cho trang test
const TEST_PHONE_NUMBER = '0346270820';

// SIP Credentials - Định nghĩa sẵn (giống Default-UI.html nhưng không cần input)
const SIP_CONFIG = {
    sipRealm: 'info268',
    sipUser: '100',
    sipPassword: 'Ws9nsNEClG'
};

// SDK Version - Giống Default-UI.html
const SDK_VERSION = '3.0.33';

export default function TestCallComponent() {
    // ===== STATE MANAGEMENT =====
    
    // Connection & Call State
    const [connectionStatus, setConnectionStatus] = useState({ 
        status: 'disconnected', 
        text: 'Chưa kết nối' 
    });
    const [callStage, setCallStage] = useState('idle'); // idle | connecting | ringing | in_call
    const [statusText, setStatusText] = useState('Sẵn sàng để gọi');
    const [durationText, setDurationText] = useState('00:00');
    const [isRecording, setIsRecording] = useState(false);
    
    // Remote Party Status (Trạng thái người được gọi)
    const [remoteStatus, setRemoteStatus] = useState({
        status: 'idle', // idle | connecting | ringing | answered | hung_up | rejected | busy | no_answer
        message: 'Chưa có cuộc gọi',
        detail: '',
        timestamp: null
    });
    
    // Modal State
    const [isPostCallModalOpen, setIsPostCallModalOpen] = useState(false);
    const [lastCallInfo, setLastCallInfo] = useState(null);
    
    // ===== REFS =====
    
    // SDK & Media Refs
    const sdkRef = useRef(null);
    const socketRef = useRef(null);
    const callIdRef = useRef(null);
    const currentCallRef = useRef(null);
    const remoteAudioRef = useRef(null);
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);
    
    // Recording Refs
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const mixedCtxRef = useRef(null);
    const mixedDestRef = useRef(null);
    
    // Anti-duplicate Refs
    const endedOnceRef = useRef(false);
    const recordingStopOnceRef = useRef(false);
    const playbackReadyRef = useRef(false);
    
    // Duration & Info Refs
    const lastEndInfoRef = useRef({ statusCode: null, by: null });
    const lastDurationSecRef = useRef(0);
    const acceptedAtRef = useRef(0);
    const transactionIdRef = useRef(null); // Lưu transactionId để gọi API tắt popup
    const authTokenRef = useRef(null); // Lưu token để gọi API
    
    // ===== HELPER FUNCTIONS =====
    
    // Get color for remote status
    const getRemoteStatusColor = (status) => {
        switch(status) {
            case 'connecting':
            case 'ringing':
                return '#fff3cd'; // Light yellow/orange
            case 'answered':
                return '#d4edda'; // Light green
            case 'hung_up':
            case 'rejected':
                return '#f8d7da'; // Light red
            case 'busy':
            case 'no_answer':
                return '#ffeaa7'; // Light yellow
            default:
                return '#f0f0f0'; // Light gray
        }
    };
    
    // Get text color for remote status
    const getRemoteStatusTextColor = (status) => {
        switch(status) {
            case 'connecting':
            case 'ringing':
                return '#856404'; // Dark yellow
            case 'answered':
                return '#155724'; // Dark green
            case 'hung_up':
            case 'rejected':
                return '#721c24'; // Dark red
            case 'busy':
            case 'no_answer':
                return '#856404'; // Dark yellow
            default:
                return '#666'; // Gray
        }
    };
    
    // Parse duration từ "MM:SS" hoặc "HH:MM:SS" → seconds
    const hhmmssToSec = (txt = '00:00') => {
        const parts = String(txt).split(':').map(n => Number(n) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return 0;
    };
    
    // Map SIP status code to call status
    const toCallStatus = (statusCode, durationSec) => {
        if (durationSec === 0) {
            if (statusCode === 486) return 'busy';
            else if (statusCode === 603) return 'rejected';
            else if (statusCode === 480 || statusCode === 408) return 'no_answer';
            else if (statusCode === 487) return 'missed';
            else return 'failed';
        }
        return 'completed';
    };
    
    // Reset flags cho mỗi cuộc gọi
    const resetPerCallFlags = () => {
        endedOnceRef.current = false;
        recordingStopOnceRef.current = false;
        lastEndInfoRef.current = { statusCode: null, by: null };
    };
    
    const resetUIToIdle = () => {
        currentCallRef.current = null;
        setCallStage('idle');
        setStatusText('Sẵn sàng để gọi');
        setDurationText('00:00');
        setIsRecording(false);
        endedOnceRef.current = false;
        recordingStopOnceRef.current = false;
        playbackReadyRef.current = false;
        lastDurationSecRef.current = 0;
        acceptedAtRef.current = 0;
        setRemoteStatus({
            status: 'idle',
            message: 'Chưa có cuộc gọi',
            detail: '',
            timestamp: null
        });
    };
    
    // ===== HELPER FUNCTIONS (Giống Default-UI.html) =====
    
    const loadScript = async (src) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        document.head.appendChild(script);
        await new Promise((resolve) => (script.onload = resolve));
    };
    
    const validateCallSDK = () => {
        if (typeof window.OMICallSDK == 'undefined') {
            throw new Error('OMICallSDK not loaded!');
        }
    };
    
    // ===== SDK INITIALIZATION (Giống Default-UI.html) =====
    
    const initCallSDK = async () => {
        try {
            // console.log('[TestCallComponent] Initializing SDK...');
            
            // 1. Load script - Giống Default-UI.html
            await loadScript(`https://cdn.omicrm.com/sdk/web/${SDK_VERSION}/core.min.js`);
            
            validateCallSDK();
            
            // 2. Init config for SDK - Giống Default-UI.html
            const initSuccess = await window.OMICallSDK.init({
                lng: 'vi',
                ui: {
                    toggleDial: 'hide', // Ẩn UI mặc định của SDK
                    dialPosition: 'right',
                },
            });
            
            if (!initSuccess) {
                console.error('[TestCallComponent] SDK init failed');
                setConnectionStatus({ status: 'disconnected', text: 'Lỗi khởi tạo SDK' });
                return;
            }
            
            sdkRef.current = window.OMICallSDK;
            // console.log('[TestCallComponent] ✅ SDK initialized');
            
            // 3. Setup event listeners
            setupEventListeners();
            
            // 4. Auto register - Giống Default-UI.html nhưng tự động
            await registerCallSDK();
            
        } catch (error) {
            console.error('[TestCallComponent] initCallSDK -> error:', error);
            setConnectionStatus({ status: 'disconnected', text: 'Lỗi khởi tạo' });
            toast.error('Không thể khởi tạo OMI Call SDK');
        }
    };
    
    // ===== SIP CONNECTION (Giống Default-UI.html) =====
    
    const registerCallSDK = async () => {
        try {
            validateCallSDK();
            
            setConnectionStatus({ status: 'connecting', text: 'Đang kết nối...' });
            
            // Register với giá trị định nghĩa sẵn - Giống Default-UI.html
            const registerStatus = await window.OMICallSDK.register({
                sipRealm: SIP_CONFIG.sipRealm,
                sipUser: SIP_CONFIG.sipUser,
                sipPassword: SIP_CONFIG.sipPassword,
            });
            
            if (!registerStatus.status) {
                throw registerStatus;
            }
            
            // console.log('[TestCallComponent] ✅ Registered successfully:', registerStatus);
            // Status sẽ được cập nhật qua event 'register'
            
        } catch (error) {
            console.error('[TestCallComponent] registerCallSDK -> error:', error);
            setConnectionStatus({ status: 'disconnected', text: 'Kết nối thất bại' });
            toast.error('Kết nối tổng đài thất bại. Vui lòng thử lại.');
        }
    };
    
    const unRegisterCallSDK = () => {
        try {
            validateCallSDK();
            window.OMICallSDK.unregister();
            // console.log('[TestCallComponent] Unregistered');
        } catch (error) {
            console.error('[TestCallComponent] unRegisterCallSDK -> error:', error);
        }
    };
    
    // ===== EVENT LISTENERS =====
    
    const setupEventListeners = useCallback(() => {
        // console.log('[TestCallComponent] Setting up event listeners...');
        
        const sdk = sdkRef.current;
        if (!sdk) {
            console.error('[TestCallComponent] No SDK available for event listeners');
            return;
        }
        
        // Kết nối tổng đài
        sdk.on('register', (data) => {
            const statusMap = {
                connected: { status: 'connected', text: 'Đã kết nối' },
                connecting: { status: 'connecting', text: 'Đang kết nối...' },
                disconnect: { status: 'disconnected', text: 'Mất kết nối' }
            };
            const status = statusMap[data?.status] || { status: 'disconnected', text: 'Chưa kết nối' };
            setConnectionStatus(status);
            
            if (status.status === 'connected') {
                toast.success('Đã kết nối tổng đài');
            } else if (status.status === 'disconnected') {
                toast.error('Mất kết nối tổng đài');
            }
        });
        
        // Chuỗi sự kiện cuộc gọi
        sdk.on('connecting', (callData) => {
            // console.log('[TestCallComponent] Connecting event:', callData);
            resetPerCallFlags();
            currentCallRef.current = callData;
            callIdRef.current = callData?.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Lưu transactionId từ callData (ưu tiên uuid, sau đó là uid hoặc callId)
            transactionIdRef.current = callData?.uuid || callData?.uid || callData?.callId || null;
            // console.log('[TestCallComponent] TransactionId saved:', transactionIdRef.current);
            
            setCallStage('connecting');
            setStatusText('Đang kết nối...');
            setDurationText('00:00');
            lastDurationSecRef.current = 0;
            acceptedAtRef.current = 0;
            
            // Cập nhật trạng thái người được gọi
            setRemoteStatus({
                status: 'connecting',
                message: 'Đang kết nối tới người được gọi',
                detail: `Số điện thoại: ${TEST_PHONE_NUMBER}`,
                timestamp: new Date()
            });
        });
        
        sdk.on('ringing', (callData) => {
            // console.log('[TestCallComponent] Ringing event:', callData);
            currentCallRef.current = callData;
            setCallStage('ringing');
            setStatusText('Đang đổ chuông...');
            
            // Cập nhật trạng thái người được gọi
            setRemoteStatus({
                status: 'ringing',
                message: '📞 Đang đổ chuông...',
                detail: 'Đang chờ người được gọi bắt máy',
                timestamp: new Date()
            });
        });
        
        sdk.on('on_ringing', (callData) => {
            const duration = callData?.ringingDuration?.text || '00:00';
            setRemoteStatus(prev => ({
                ...prev,
                detail: `Thời gian đổ chuông: ${duration}`
            }));
        });
        
        sdk.on('accepted', (callData) => {
            // console.log('[TestCallComponent] Accepted event:', callData);
            
            // Cập nhật trạng thái người được gọi - ĐÃ BẮT MÁY
            setRemoteStatus({
                status: 'answered',
                message: '✅ Người được gọi đã bắt máy',
                detail: 'Đang trong cuộc gọi',
                timestamp: new Date()
            });
            
            onAccepted(callData);
        });
        
        sdk.on('on_calling', (callData) => {
            const text = callData?.callingDuration?.text || '00:00';
            setDurationText(text);
            lastDurationSecRef.current = hhmmssToSec(text);
            
            // Cập nhật thời lượng khi đang gọi
            setRemoteStatus(prev => ({
                ...prev,
                detail: `Đang trong cuộc gọi - Thời lượng: ${text}`
            }));
        });
        
        sdk.on('ended', (info) => {
            // console.log('[TestCallComponent] Ended event:', info);
            
            // Xác định ai đã cúp máy và lý do
            const statusCode = info?.statusCode || info?.code || info?.reasonCode;
            const endedBy = info?.by || 'unknown';
            const duration = durationText;
            
            let remoteStatusMessage = '';
            let remoteStatusDetail = '';
            
            if (endedBy === 'remote' || endedBy === 'callee') {
                remoteStatusMessage = '❌ Người được gọi đã cúp máy';
            } else if (endedBy === 'user' || endedBy === 'caller') {
                remoteStatusMessage = '📞 Bạn đã cúp máy';
            } else {
                remoteStatusMessage = '📞 Cuộc gọi đã kết thúc';
            }
            
            // Xác định lý do kết thúc
            if (statusCode) {
                let reason = '';
                switch(statusCode) {
                    case 486:
                        reason = 'Máy bận';
                        break;
                    case 603:
                        reason = 'Bị từ chối';
                        break;
                    case 480:
                    case 408:
                        reason = 'Không trả lời';
                        break;
                    case 487:
                        reason = 'Đã hủy';
                        break;
                    default:
                        reason = `Mã lỗi: ${statusCode}`;
                }
                remoteStatusDetail = `Lý do: ${reason} | Thời lượng: ${duration}`;
            } else {
                remoteStatusDetail = `Thời lượng cuộc gọi: ${duration}`;
            }
            
            setRemoteStatus({
                status: 'hung_up',
                message: remoteStatusMessage,
                detail: remoteStatusDetail,
                timestamp: new Date()
            });

            // Sau khi cuộc gọi kết thúc hoàn toàn, tự động bấm nút "Đóng và lưu lại" của popup OMICall
            // để OMICall SDK tự gửi add-metadata và đóng popup giống thao tác người dùng thật.
            clickOmicallCloseAndSave();
            
            onEnded(info);
        });
        
    }, []);
    
    // ===== CALL FLOW HANDLERS =====
    
    const onAccepted = (callData) => {
        // console.log('[TestCallComponent] Call accepted, setting up audio...');
        
        currentCallRef.current = callData;
        setCallStage('in_call');
        setStatusText('Đang trong cuộc gọi');
        acceptedAtRef.current = Date.now();
        
        // Lưu audio streams
        localStreamRef.current = callData?.streams?.local || null;
        remoteStreamRef.current = callData?.streams?.remote || null;
        
        // Phát audio remote
        ensureRemotePlayback(remoteStreamRef.current);
        
        // Bắt đầu ghi âm
        startRecording();
    };
    
    const onEnded = (info) => {
        if (endedOnceRef.current) return; // Chống trùng
        endedOnceRef.current = true;
        
        // Lưu thông tin kết thúc
        const code = info?.statusCode ?? info?.code ?? info?.reasonCode ?? null;
        lastEndInfoRef.current = { statusCode: code, by: info?.by };
        
        // Reset UI
        setCallStage('idle');
        setStatusText('Sẵn sàng để gọi');
        
        // Dừng ghi âm
        stopRecording();
        currentCallRef.current = null;
        
        // ✅ CLEANUP QUAN TRỌNG!
        cleanupAudioResources();
        
        // Reset state sau 2s
        setTimeout(() => {
            endedOnceRef.current = false;
            recordingStopOnceRef.current = false;
            playbackReadyRef.current = false;
            lastDurationSecRef.current = 0;
            acceptedAtRef.current = 0;
        }, 2000);
    };
    
    // ===== AUDIO HANDLING =====
    
    const ensureRemotePlayback = async (stream) => {
        const el = remoteAudioRef.current;
        if (!el || !stream) return;
        
        // Reset audio element
        el.pause();
        el.currentTime = 0;
        el.srcObject = null;
        
        // Gán stream mới
        el.srcObject = stream;
        el.autoplay = true;
        el.volume = 1.0;
        
        // Resume AudioContext nếu cần
        if (mixedCtxRef.current && mixedCtxRef.current.state === 'suspended') {
            await mixedCtxRef.current.resume();
        }
        
        // Thử play với retry
        for (let i = 0; i < 4; i++) {
            try {
                await el.play();
                playbackReadyRef.current = true;
                break;
            } catch {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    };
    
    // ===== RECORDING =====
    
    const startRecording = () => {
        try {
            console.log('[TestCallComponent] 🎙️ Starting recording...');
            
            // ✅ TẠO AUDIO CONTEXT MỚI CHO MỖI CUỘC GỌI
            if (mixedCtxRef.current && mixedCtxRef.current.state !== 'closed') {
                mixedCtxRef.current.close();
            }
            mixedCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            
            // Tạo destination để mix streams
            mixedDestRef.current = mixedCtxRef.current.createMediaStreamDestination();
            
            // Kết nối local stream
            if (localStreamRef.current) {
                const localSrc = mixedCtxRef.current.createMediaStreamSource(localStreamRef.current);
                localSrc.connect(mixedDestRef.current);
            }
            
            // Kết nối remote stream
            if (remoteStreamRef.current) {
                const remoteSrc = mixedCtxRef.current.createMediaStreamSource(remoteStreamRef.current);
                remoteSrc.connect(mixedDestRef.current);
            }
            
            // Bắt đầu ghi âm
            recordedChunksRef.current = [];
            mediaRecorderRef.current = new MediaRecorder(mixedDestRef.current.stream, { 
                mimeType: 'audio/webm;codecs=opus' 
            });
            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data?.size > 0) recordedChunksRef.current.push(e.data);
            };
            mediaRecorderRef.current.start();
            setIsRecording(true);
            
            // console.log('[TestCallComponent] ✅ Recording started successfully');
            
        } catch (err) {
            console.error('[TestCallComponent] ❌ Recording start ERROR:', err);
            toast.error('Không thể bắt đầu ghi âm');
        }
    };
    
    const stopRecording = () => {
        if (recordingStopOnceRef.current) return;
        recordingStopOnceRef.current = true;
        
        const rec = mediaRecorderRef.current;
        if (rec && rec.state === 'recording') {
            rec.onstop = () => {
                // Tính duration
                const sdkSec = lastDurationSecRef.current || 0;
                const fallbackSec = acceptedAtRef.current ? 
                    Math.max(0, Math.floor((Date.now() - acceptedAtRef.current) / 1000)) : 0;
                const durationSec = sdkSec || fallbackSec;
                
                // Tạo file audio
                const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                const fileName = `rec-${TEST_PHONE_NUMBER}-${new Date().toISOString()}.webm`;
                
                // Lưu thông tin cuộc gọi
                setLastCallInfo({
                    file: new File([blob], fileName, { type: 'audio/webm' }),
                    name: fileName,
                    durationText: new Date(durationSec * 1000).toISOString().substr(14, 5),
                    durationSec,
                    startTime: new Date(Date.now() - durationSec * 1000),
                    sipStatusCode: lastEndInfoRef.current?.statusCode,
                    callStatus: toCallStatus(lastEndInfoRef.current?.statusCode, durationSec),
                });
                
                // Mở popup lưu kết quả
                setIsPostCallModalOpen(true);
            };
            rec.stop();
        }
    };
    
    // ===== CLEANUP AUDIO RESOURCES =====
    
    const cleanupAudioResources = () => {
        try {
            // 1. Stop MediaRecorder
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            mediaRecorderRef.current = null;
            recordedChunksRef.current = [];
            
            // 2. Stop tất cả audio tracks
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            
            if (remoteStreamRef.current) {
                remoteStreamRef.current.getTracks().forEach(track => track.stop());
                remoteStreamRef.current = null;
            }
            
            // 3. Close AudioContext
            if (mixedCtxRef.current && mixedCtxRef.current.state !== 'closed') {
                mixedCtxRef.current.close();
                mixedCtxRef.current = null;
            }
            mixedDestRef.current = null;
            
            // 4. Reset audio element
            if (remoteAudioRef.current) {
                remoteAudioRef.current.pause();
                remoteAudioRef.current.currentTime = 0;
                remoteAudioRef.current.srcObject = null;
            }
            
            // 5. Reset playback state
            playbackReadyRef.current = false;
            
        } catch (err) {
            console.error('[TestCallComponent] Cleanup error:', err);
        }
    };
    
    // ===== CALL ACTIONS (Giống Default-UI.html) =====
    
    const handleClick2Call = async () => {
        try {
            validateCallSDK();
            
            // Kiểm tra kết nối
            if (connectionStatus.status !== 'connected') {
                toast.error('Chưa kết nối tổng đài');
                return;
            }
            
            // Kiểm tra cuộc gọi hiện tại
            if (currentCallRef.current) {
                toast.warning('Đang có cuộc gọi khác');
                return;
            }
            
            // CLEANUP TRƯỚC KHI GỌI MỚI
            cleanupAudioResources();
            resetPerCallFlags();
            
            // Yêu cầu quyền microphone
            try {
                await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
            } catch (micError) {
                toast.error('Cần quyền truy cập microphone');
                return;
            }
            
            // Thực hiện cuộc gọi - Giống Default-UI.html (đơn giản)
            // console.log('[TestCallComponent] 📞 Making call to:', TEST_PHONE_NUMBER);
            window.OMICallSDK.makeCall(TEST_PHONE_NUMBER);
            
        } catch (error) {
            console.error('[TestCallComponent] handleClick2Call -> error:', error);
            toast.error('Không thể thực hiện cuộc gọi: ' + (error.message || 'Unknown error'));
            resetUIToIdle();
        }
    };
    
    // Alias cho makeCall để tương thích với UI
    const makeCall = handleClick2Call;

    // ===== OMICALL POPUP AUTO-CLOSE HELPERS =====

    // Tự động click nút "Đóng và lưu lại" trong popup OMICall
    const clickOmicallCloseAndSave = (maxRetries = 5, delayMs = 200) => {
        let attempt = 0;

        const tryClick = () => {
            try {
                const docs = [document];

                // Nếu popup được render trong iframe, duyệt thêm document của iframe
                const iframes = Array.from(document.querySelectorAll('iframe'));
                iframes.forEach((frame) => {
                    try {
                        const doc = frame.contentWindow?.document;
                        if (doc) docs.push(doc);
                    } catch {
                        // Bỏ qua iframe khác origin
                    }
                });

                for (const doc of docs) {
                    const allButtons = Array.from(doc.querySelectorAll('button'));
                    const target = allButtons.find((btn) => {
                        const text = (btn.textContent || btn.innerText || '').trim();
                        return text.includes('Đóng và lưu lại') && btn.offsetParent !== null;
                    });

                    if (target) {
                        // console.log('[TestCallComponent] 🖱️ Auto-click "Đóng và lưu lại" button in OMICall popup', target);
                        target.click(); // OMICall SDK sẽ tự gửi add-metadata như khi người dùng click thật
                        return true;
                    }
                }
            } catch (err) {
                console.error('[TestCallComponent] clickOmicallCloseAndSave error:', err);
            }

            attempt++;
            if (attempt <= maxRetries) {
                console.log('[TestCallComponent] ⚠️ Chưa tìm thấy nút "Đóng và lưu lại", thử lại lần', attempt);
                setTimeout(tryClick, delayMs);
            } else {
                console.log('[TestCallComponent] ⚠️ Không tìm thấy nút "Đóng và lưu lại" để auto-click sau', maxRetries, 'lần thử');
            }

            return false;
        };

        return tryClick();
    };
    
    const endCall = async () => {
        // console.log('[TestCallComponent] Ending call...');
        
        try {
            // 1. End call through current call object
            if (currentCallRef.current) {
                console.log('[TestCallComponent] Calling currentCallRef.current.end()...');
                
                if (typeof currentCallRef.current.end === 'function') {
                    currentCallRef.current.end();
                } else {
                    console.warn('[TestCallComponent] currentCallRef.current.end() not available');
                }
            }
            
            // 2. Force cleanup audio resources
            cleanupAudioResources();
            
            // 3. Reset UI
            resetUIToIdle();
            
            // console.log('[TestCallComponent] Call ended successfully');
            
        } catch (error) {
            console.error('[TestCallComponent] Error ending call:', error);
            
            // Force cleanup even if there's an error
            cleanupAudioResources();
            resetUIToIdle();
        }
    };
    
    // ===== POST CALL MODAL =====
    
    const handleSaveCall = async () => {
        if (!lastCallInfo) return;
        
        try {
            // Tạo download link cho file ghi âm
            const url = URL.createObjectURL(lastCallInfo.file);
            const a = document.createElement('a');
            a.href = url;
            a.download = lastCallInfo.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            toast.success('Đã tải file ghi âm!');
            setIsPostCallModalOpen(false);
            setLastCallInfo(null);
            
        } catch (error) {
            console.error('[TestCallComponent] Save call error:', error);
            toast.error('Lỗi khi lưu cuộc gọi');
        }
    };
    
    // ===== FORCE RE-INITIALIZATION =====
    
    const forceReinitialize = async () => {
        // console.log('[TestCallComponent] Force re-initializing...');
        
        // Reset connection status
        setConnectionStatus({ status: 'disconnected', text: 'Đang khởi tạo lại...' });
        
        // Unregister trước
        if (sdkRef.current) {
            unRegisterCallSDK();
        }
        
        // Re-initialize
        await initCallSDK();
    };
    
    // ===== INITIALIZATION & CLEANUP =====
    
    useEffect(() => {
        // console.log('[TestCallComponent] Component mounted, initializing...');
        
        // Initialize SDK - Giống Default-UI.html
        initCallSDK();
        
        return () => {
            // console.log('[TestCallComponent] Component unmounting, cleaning up...');
            // Cleanup audio resources
            cleanupAudioResources();
            // Unregister khi unmount
            if (sdkRef.current) {
                unRegisterCallSDK();
            }
        };
    }, []);
    
    // ===== UI RENDER =====
    
    return (
        <>
            <div className="space-y-6">
                {/* Connection Status */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Trạng thái kết nối</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2 justify-center">
                            {connectionStatus.status === 'connected' && <CheckCircle className="h-5 w-5 text-green-500" />}
                            {connectionStatus.status === 'connecting' && <Loader2 className="h-5 w-5 animate-spin" />}
                            {connectionStatus.status === 'disconnected' && <AlertCircle className="h-5 w-5 text-red-500" />}
                            <span className="font-medium">{connectionStatus.text}</span>
                        </div>
                    </CardContent>
                </Card>
                
                {/* Call Controls */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Điều khiển cuộc gọi</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {/* Phone Number Info */}
                        <div className="text-center p-4 bg-blue-50 rounded-lg">
                            <div className="text-sm text-gray-600 mb-1">Số điện thoại test</div>
                            <div className="text-2xl font-bold text-blue-600">{TEST_PHONE_NUMBER}</div>
                        </div>
                        
                        {/* Call Button */}
                        <div className="pt-1">
                            {callStage === 'idle' ? (
                                <Button
                                    onClick={makeCall}
                                    disabled={connectionStatus.status !== 'connected'}
                                    className="w-full"
                                    size="lg"
                                >
                                    <Phone className="mr-2 h-5 w-5" /> Gọi {TEST_PHONE_NUMBER}
                                </Button>
                            ) : (
                                <Button variant="destructive" onClick={endCall} className="w-full" size="lg">
                                    <PhoneOff className="mr-2 h-5 w-5" /> Kết thúc
                                </Button>
                            )}
                        </div>
                        
                        {/* Reconnect Button */}
                        {connectionStatus.status === 'disconnected' && (
                            <div className="pt-2">
                                <Button
                                    onClick={forceReinitialize}
                                    variant="outline"
                                    className="w-full"
                                >
                                    <CircleDot className="mr-2 h-4 w-4" /> Kết nối lại
                                </Button>
                            </div>
                        )}
                        
                        {/* Call Status */}
                        {callStage !== 'idle' && (
                            <div className="text-center p-4 bg-gray-50 rounded-lg">
                                <div className="font-medium text-blue-600 mb-2">{statusText}</div>
                                <div className="text-3xl font-mono tracking-wider">{durationText}</div>
                                {isRecording && (
                                    <div className="mt-3 inline-flex items-center gap-2 text-red-600">
                                        <CircleDot className="h-4 w-4 animate-pulse" />
                                        <span className="text-sm">Đang ghi âm…</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
                
                {/* Remote Party Status - Trạng thái người được gọi */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Trạng thái người được gọi</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="p-4 rounded-lg" style={{
                            backgroundColor: getRemoteStatusColor(remoteStatus.status),
                            color: getRemoteStatusTextColor(remoteStatus.status)
                        }}>
                            <div className="font-semibold text-lg mb-2">{remoteStatus.message}</div>
                            {remoteStatus.detail && (
                                <div className="text-sm opacity-90">{remoteStatus.detail}</div>
                            )}
                            {remoteStatus.timestamp && (
                                <div className="text-xs opacity-75 mt-2">
                                    {new Date(remoteStatus.timestamp).toLocaleTimeString('vi-VN')}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
                
                {/* Call History - Test Data */}
                <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <CardHeader className="pb-1 flex-shrink-0">
                        <CardTitle className="text-base">Lịch sử cuộc gọi (Test)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                        <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0 max-h-full">
                            {/* Call 1: Nguyễn Thanh */}
                            <div className="bg-gray-50 border border-gray-200 rounded p-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="px-1 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        Hoàn thành
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date().toLocaleString('vi-VN')}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mb-1">
                                    Call 1: Nguyễn Thanh • Trạng thái: completed • Thời lượng: 02:30
                                </div>
                                <div className="text-xs text-gray-500 italic">
                                    (Test call - không có recording)
                                </div>
                            </div>
                            
                            {/* Call 2: Nguyễn An */}
                            <div className="bg-gray-50 border border-gray-200 rounded p-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="px-1 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        Hoàn thành
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(Date.now() - 3600000).toLocaleString('vi-VN')}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mb-1">
                                    Call 2: Nguyễn An • Trạng thái: completed • Thời lượng: 01:45
                                </div>
                                <div className="text-xs text-gray-500 italic">
                                    (Test call - không có recording)
                                </div>
                            </div>
                            
                            {/* Call 3: Nguyễn Viên */}
                            <div className="bg-gray-50 border border-gray-200 rounded p-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="px-1 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                        Bận
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(Date.now() - 7200000).toLocaleString('vi-VN')}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mb-1">
                                    Call 3: Nguyễn Viên • Trạng thái: busy • Thời lượng: 00:00
                                </div>
                                <div className="text-xs text-gray-500 italic">
                                    (Test call - không có recording)
                                </div>
                            </div>
                            
                            {/* Call 4: Nguyễn Dưỡng */}
                            <div className="bg-gray-50 border border-gray-200 rounded p-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="px-1 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                        Thất bại
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(Date.now() - 10800000).toLocaleString('vi-VN')}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mb-1">
                                    Call 4: Nguyễn Dưỡng • Trạng thái: failed • Thời lượng: 00:00
                                </div>
                                <div className="text-xs text-gray-500 italic">
                                    (Test call - không có recording)
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            
            {/* Hidden audio element for remote playback */}
            <audio ref={remoteAudioRef} playsInline style={{ display: 'none' }} />
            
            {/* Post Call Modal */}
            <Dialog open={isPostCallModalOpen} onOpenChange={setIsPostCallModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Kết quả cuộc gọi</DialogTitle>
                        <DialogDescription>
                            Cuộc gọi đã kết thúc. Bạn có thể tải file ghi âm.
                        </DialogDescription>
                    </DialogHeader>
                    
                    {lastCallInfo && (
                        <div className="space-y-4">
                            <div className="text-center">
                                <div className="text-lg font-semibold">Thời lượng: {lastCallInfo.durationText}</div>
                                <div className="text-sm text-gray-600 mt-1">Trạng thái: {lastCallInfo.callStatus}</div>
                                <div className="text-sm text-gray-500 mt-1">Số điện thoại: {TEST_PHONE_NUMBER}</div>
                            </div>
                            
                            <div className="flex gap-2">
                                <Button onClick={handleSaveCall} className="flex-1">
                                    Tải file ghi âm
                                </Button>
                                <Button 
                                    variant="outline" 
                                    onClick={() => {
                                        setIsPostCallModalOpen(false);
                                        setLastCallInfo(null);
                                    }}
                                    className="flex-1"
                                >
                                    Đóng
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            
            {/* Load OMI Call SDK - Script được load trong initCallSDK() */}
        </>
    );
}

