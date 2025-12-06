// components/Call.js
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import RecordingPlayer from '@/components/call/RecordingPlayer';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Phone, PhoneOff, CircleDot, AlertCircle, CheckCircle } from 'lucide-react';
import { maskPhoneNumber } from '@/function/index';
import { saveCallAction, call_data } from '@/data/call/wraperdata.db';
import Script from 'next/script';

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

export default function Call({ customer, user }) {
    // ===== STATE MANAGEMENT =====
    const [connectionStatus, setConnectionStatus] = useState({ status: 'disconnected', text: 'Chưa kết nối' });
    const [callStage, setCallStage] = useState('idle'); // idle | connecting | ringing | in_call
    const [statusText, setStatusText] = useState('Sẵn sàng để gọi');
    const [durationText, setDurationText] = useState('00:00');
    const [isRecording, setIsRecording] = useState(false);
    const [isCalling, setIsCalling] = useState(false);
    const [callHistory, setCallHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);

    // ===== REFS =====
    const sdkRef = useRef(null);              // SDK instance
    const currentCallRef = useRef(null);      // Call object hiện tại
    const remoteAudioRef = useRef(null);      // Audio element
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const lastDurationSecRef = useRef(0);
    const acceptedAtRef = useRef(0);
    const callCountRef = useRef(0);
    const durationIntervalRef = useRef(null);
    const lastEndInfoRef = useRef({ statusCode: null, by: null, durationSec: 0, callStatus: 'failed' });
    const processRecordingOnceRef = useRef(false);
    const hasRingingRef = useRef(false); // Track xem đã có ringing event (đổ chuông) chưa
    
    // Audio recording refs
    const localStreamRef = useRef(null);      // Local audio stream
    const remoteStreamRef = useRef(null);     // Remote audio stream
    const audioContextRef = useRef(null);     // Audio context for mixing
    const mixedDestinationRef = useRef(null);  // Mixed audio destination

    // ===== INITIALIZATION =====
    const initializeSDK = useCallback(async () => {
        // console.log('[Call] 🔄 Initializing call system...');
        
        try {
            // Check if we're in a browser environment
            if (typeof window === 'undefined') {
                throw new Error('Not in browser environment');
            }
            
            // Check for required APIs
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('MediaDevices API not supported');
            }
            
            setConnectionStatus({ status: 'connected', text: 'Đã kết nối' });
            setIsInitialized(true);
            
            // console.log('[Call] ✅ Call system initialized successfully');
            
        } catch (error) {
            console.error('[Call] ❌ Initialization failed:', error);
            setConnectionStatus({ status: 'disconnected', text: 'Lỗi khởi tạo' });
            toast.error('Không thể khởi tạo hệ thống gọi');
        }
    }, []);

    // ===== OMI SDK LOAD HANDLER =====
    const handleSDKLoad = useCallback(async () => {
        try {
            // console.log('[Call] 🔄 Đang khởi tạo OMI Call SDK...');
            
            // Kiểm tra đang khởi tạo
            if (isInitializing) {
                // console.log('[Call] ⚠️ SDK đang được khởi tạo, bỏ qua...');
                return;
            }
            
            // Kiểm tra SDK đã load chưa
            if (!window.OMICallSDK) {
                // console.error('[Call] ❌ SDK chưa được load');
                return;
            }
            
            setIsInitializing(true);
            
            // Kiểm tra SDK đã được khởi tạo chưa (giữ kết nối khi chuyển tab)
            // Nếu window.OMICallSDK đã tồn tại, có thể đã được init từ component khác
            if (window.OMICallSDK) {
                // Gán SDK vào ref nếu chưa có
                if (!sdkRef.current) {
                    sdkRef.current = window.OMICallSDK;
                }
                
                // Kiểm tra trạng thái kết nối từ SDK
                try {
                    const status = await sdkRef.current.getStatus?.();
                    if (status && (status.connected || status.status === 'connected')) {
                        // console.log('[Call] ✅ SDK đã kết nối, giữ nguyên kết nối (không khởi tạo lại)');
                        setConnectionStatus({ status: 'connected', text: 'Đã kết nối (OMI)' });
                        setIsInitialized(true);
                        // Đảm bảo event listeners vẫn hoạt động
                        setupOMIEventListeners();
                        return;
                    }
                } catch (error) {
                    console.log('[Call] ⚠️ Không thể kiểm tra trạng thái SDK, thử init:', error);
                }
                
                // Thử init SDK (nếu đã init rồi thì sẽ không làm gì hoặc trả về true)
                try {
                    const ok = await window.OMICallSDK.init({ 
                        lng: 'vi', 
                        ui: { toggleDial: 'hide' },
                        ringtoneVolume: 0.9 
                    });
                    
                    if (!ok) {
                        console.log('[Call] ⚠️ SDK init trả về false, có thể đã được init trước đó');
                    }
                } catch (initError) {
                    // Nếu init thất bại vì đã init rồi, bỏ qua lỗi
                    console.log('[Call] ⚠️ SDK có thể đã được init, tiếp tục...', initError);
                }
                
                sdkRef.current = window.OMICallSDK;
                
                // Setup event listeners
                setupOMIEventListeners();
                
                // Thử kết nối (sẽ xử lý "Already registered" trong connectToServer)
                try {
                    await connectToServer();
                    // console.log('[Call] ✅ SDK đã được kết nối');
                    return;
                } catch (error) {
                    console.log('[Call] ⚠️ Không thể kết nối SDK:', error);
                    // Nếu connect thất bại, vẫn tiếp tục để thử lại
                }
            }
            
            // Khởi tạo SDK mới (chỉ khi window.OMICallSDK chưa tồn tại)
            const ok = await window.OMICallSDK.init({ 
                lng: 'vi', 
                ui: { toggleDial: 'hide' },
                ringtoneVolume: 0.9 
            });
            
            if (!ok) {
                throw new Error('SDK init failed');
            }
            
            sdkRef.current = window.OMICallSDK;
            
            // Setup event listeners
            setupOMIEventListeners();
            
            // Kết nối tới tổng đài
            await connectToServer();
            
            // console.log('[Call] ✅ SDK khởi tạo thành công');
            
        } catch (error) {
            console.error('[Call] ❌ Lỗi khởi tạo SDK:', error);
            setConnectionStatus({ status: 'disconnected', text: 'Lỗi khởi tạo' });
            toast.error('Không thể khởi tạo OMI Call SDK');
        } finally {
            setIsInitializing(false);
        }
    }, [isInitializing]);

    // ===== KẾT NỐI TỚI SERVER TỔNG ĐÀI ====
    const connectToServer = useCallback(async () => {
        try {
            // console.log('[Call] 🔄 Đang kết nối tới server...');
            
            // Kiểm tra SDK có sẵn không
            if (!sdkRef.current) {
                throw new Error('SDK not available');
            }
            
            setConnectionStatus({ status: 'connecting', text: 'Đang kết nối...' });
            
            // Đăng ký với server OMICall
            const registerStatus = await sdkRef.current.register({
                sipRealm: 'info268',      // Domain từ OMICall
                sipUser: '100',           // Username từ OMICall
                sipPassword: 'Ws9nsNEClG' // Password từ OMICall
            });
            
            // console.log('[Call] 📞 Kết quả đăng ký:', registerStatus);
            
            // Xử lý trường hợp "Already registered" (nhiều format khác nhau)
            const errorMsg = registerStatus?.error || registerStatus?.message || '';
            const isAlreadyRegistered = 
                registerStatus?.status === false && (
                    errorMsg.toLowerCase().includes('already') ||
                    errorMsg.toLowerCase().includes('registered') ||
                    errorMsg === 'ALREADY_REGISTERED' ||
                    errorMsg === 'Already registered'
                );
            
            if (isAlreadyRegistered) {
                // console.log('[Call] ⚠️ SDK đã được đăng ký trước đó (từ tab khác hoặc lần trước), giữ nguyên kết nối...');
                setConnectionStatus({ status: 'connected', text: 'Đã kết nối (OMI)' });
                setIsInitialized(true);
                return;
            }
            
            // Nếu register thành công
            if (registerStatus?.status === true || registerStatus?.status === 'connected') {
                setConnectionStatus({ status: 'connected', text: 'Đã kết nối (OMI)' });
                setIsInitialized(true);
                console.log('[Call] ✅ Đã kết nối thành công');
                return;
            }
            
            // Nếu có lỗi khác (không phải Already registered)
            if (!registerStatus?.status) {
                console.error('[Call] ❌ Lỗi đăng ký:', registerStatus);
                throw new Error(errorMsg || 'Đăng ký thất bại');
            }
            
            setConnectionStatus({ status: 'connected', text: 'Đã kết nối (OMI)' });
            setIsInitialized(true);
            // console.log('[Call] ✅ Đã kết nối thành công');
            
        } catch (error) {
            console.error('[Call] ❌ Lỗi kết nối:', error);
            setConnectionStatus({ status: 'disconnected', text: 'Kết nối thất bại' });
            toast.error('Không thể kết nối tới tổng đài');
        }
    }, []);

    // ===== OMICALL POPUP AUTO-CLOSE HELPER (GIỐNG testcallCRM) =====
    
    // Tự động click nút "Đóng và lưu lại" trong popup OMICall (kể cả khi popup bị ẩn hoặc nằm trong iframe)
    const clickOmicallCloseAndSave = (maxRetries = 10, delayMs = 300) => {
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
                    // Cách 1: Tìm button trong popup container OMICall (ưu tiên)
                    const popupContainers = doc.querySelectorAll('[omi-call-dialog], [class*="omi-call"], [id*="omi-call"]');
                    for (const container of popupContainers) {
                        const buttonsInPopup = Array.from(container.querySelectorAll('button'));
                        const target = buttonsInPopup.find((btn) => {
                            const text = (btn.textContent || btn.innerText || '').trim();
                            const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
                            const title = (btn.getAttribute('title') || '').trim();
                            
                            return text.includes('Đóng và lưu lại') || 
                                   text.includes('Đóng và lưu') ||
                                   ariaLabel.includes('Đóng và lưu lại') ||
                                   ariaLabel.includes('Đóng và lưu') ||
                                   title.includes('Đóng và lưu lại') ||
                                   title.includes('Đóng và lưu');
                        });
                        
                        if (target) {
                            console.log('[Call] 🖱️ Auto-click "Đóng và lưu lại" trên popup OMICall (call chính)', target);
                            console.log('[Call] 📝 Button text:', target.textContent || target.innerText);
                            target.click();
                            console.log('[Call] ✅ ĐÃ TỰ ĐỘNG TẮT POPUP OMICall (call chính)');
                            return true;
                        }
                    }
                    
                    // Cách 2: Tìm trong tất cả button (fallback)
                    const allButtons = Array.from(doc.querySelectorAll('button'));
                    console.log('[Call] 🔍 Đang tìm nút "Đóng và lưu lại" trong', allButtons.length, 'button(s)');
                    
                    const target = allButtons.find((btn) => {
                        const text = (btn.textContent || btn.innerText || '').trim();
                        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
                        const title = (btn.getAttribute('title') || '').trim();
                        
                        // Tìm button có text chứa "Đóng và lưu lại" (bỏ điều kiện offsetParent vì popup có thể bị ẩn)
                        return text.includes('Đóng và lưu lại') || 
                               text.includes('Đóng và lưu') ||
                               ariaLabel.includes('Đóng và lưu lại') ||
                               ariaLabel.includes('Đóng và lưu') ||
                               title.includes('Đóng và lưu lại') ||
                               title.includes('Đóng và lưu');
                    });

                    if (target) {
                        // console.log('[Call] 🖱️ Auto-click "Đóng và lưu lại" trên popup OMICall (call chính - fallback)', target);
                        // console.log('[Call] 📝 Button text:', target.textContent || target.innerText);
                        target.click();
                        console.log('[Call] ✅ ĐÃ TỰ ĐỘNG TẮT POPUP OMICall (call chính)');
                        return true;
                    }
                }
            } catch (err) {
                console.error('[Call] ❌ clickOmicallCloseAndSave error:', err);
            }

            attempt++;
            if (attempt <= maxRetries) {
                console.log('[Call] ⚠️ Chưa tìm thấy nút "Đóng và lưu lại", thử lại lần', attempt);
                setTimeout(tryClick, delayMs);
            } else {
                console.log('[Call] ⚠️ Không tìm thấy nút "Đóng và lưu lại" để auto-click sau', maxRetries, 'lần thử');
            }

            return false;
        };

        return tryClick();
    };

    // ===== SETUP EVENT LISTENERS ====
    const setupOMIEventListeners = useCallback(() => {
        const sdk = sdkRef.current;
        if (!sdk) return;
        
        // console.log('[Call] 📞 Setting up OMI event listeners');
        
        // 1. Sự kiện đăng ký (register status)
        sdk.on('register', (data) => {
            // console.log('[Call] 📞 OMI register event:', data);
            const statusMap = {
                'connected': { status: 'connected', text: 'Đã kết nối (OMI)' },
                'connecting': { status: 'connecting', text: 'Đang kết nối...' },
                'disconnect': { status: 'disconnected', text: 'Mất kết nối' }
            };
            setConnectionStatus(statusMap[data?.status] || statusMap.disconnect);
        });
        
        // 2. Đang kết nối (call started)
        sdk.on('connecting', (callData) => {
            // console.log('[Call] 📞 OMI connecting event:', callData);
            currentCallRef.current = callData;
            setCallStage('connecting');
            setStatusText('Đang kết nối...');
            setDurationText('00:00');
            hasRingingRef.current = false; // Reset khi bắt đầu cuộc gọi mới
        });
        
        // 3. Đang đổ chuông (ringing)
        sdk.on('ringing', (callData) => {
            // console.log('[Call] 📞 OMI ringing event:', callData);
            currentCallRef.current = callData;
            setCallStage('ringing');
            setStatusText('Đang đổ chuông...');
            hasRingingRef.current = true; // Đánh dấu đã có ringing event (đổ chuông thành công)
        });
        
        // 4. Cuộc gọi được chấp nhận (accepted)
        sdk.on('accepted', (callData) => {
            // console.log('[Call] ✅ OMI accepted event:', callData);
            currentCallRef.current = callData;
            setCallStage('in_call');
            setStatusText('Đang trong cuộc gọi');
            setIsRecording(true);
            acceptedAtRef.current = Date.now();
            startRecording();
            
            // Setup audio playback
            setupAudioPlayback(callData);
            
            // Start duration counter
            durationIntervalRef.current = setInterval(() => {
                const elapsed = Math.floor((Date.now() - acceptedAtRef.current) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                const durationText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                setDurationText(durationText);
                lastDurationSecRef.current = elapsed;
            }, 1000);
        });
        
        // 5. Cập nhật thời lượng (tick duration)
        sdk.on('on_calling', (callData) => {
            const text = callData?.callingDuration?.text || '00:00';
            setDurationText(text);
            lastDurationSecRef.current = hhmmssToSec(text);
        });
        
        // 6. Cuộc gọi kết thúc (ended)
        sdk.on('ended', (info) => {
            // console.log('[Call] 📞 OMI ended event:', info);
            
            // Tính duration và callStatus ngay lúc SDK báo ended (giống TestCall)
            const code = info?.statusCode ?? info?.code ?? info?.reasonCode ?? null;
            const sdkSec = lastDurationSecRef.current || 0;
            const fallbackSec = acceptedAtRef.current
                ? Math.max(0, Math.floor((Date.now() - acceptedAtRef.current) / 1000))
                : 0;
            const durationSec = Math.max(sdkSec, fallbackSec);
            const callStatus = toCallStatus(code, durationSec);

            lastEndInfoRef.current = {
                statusCode: code,
                by: info?.by,
                durationSec,
                callStatus,
            };
            
            // Sau khi SDK báo ended, tự động tắt popup OMICall giống logic testcallCRM
            // (ưu tiên click "Đóng và lưu lại" để SDK tự gửi add-metadata)
            clickOmicallCloseAndSave();
            
            onCallEnded(info);
        });
        
        // 7. Lỗi cuộc gọi
        sdk.on('failed', (error) => {
            // console.log('[Call] ❌ OMI call failed:', error);
            setCallStage('idle');
            setStatusText('Cuộc gọi thất bại');
            setIsCalling(false);
            setIsRecording(false);
            setDurationText('00:00');
            toast.error('Cuộc gọi thất bại');
        });
        
    }, []);

    // ===== SETUP AUDIO PLAYBACK ====
    const setupAudioPlayback = useCallback((callData) => {
        try {
            const localStream = callData?.streams?.local;
            const remoteStream = callData?.streams?.remote;
            
            // console.log('[Call] 🎤 Setting up audio playback...');
            // console.log('[Call] 🎤 Local stream:', localStream);
            // console.log('[Call] 🎤 Remote stream:', remoteStream);
            
            // Lưu trữ audio streams
            localStreamRef.current = localStream;
            remoteStreamRef.current = remoteStream;
            
            // Setup remote audio playback với âm lượng cao
            if (remoteStream && remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = remoteStream;
                remoteAudioRef.current.autoplay = true;
                remoteAudioRef.current.playsInline = true;
                remoteAudioRef.current.volume = 1.0; // Âm lượng tối đa
                remoteAudioRef.current.muted = false;
                
                // Cài đặt âm thanh chất lượng cao
                remoteAudioRef.current.preload = 'auto';
                remoteAudioRef.current.crossOrigin = 'anonymous';
                
                // Play audio với retry
                const playAudio = async () => {
                    try {
                        await remoteAudioRef.current.play();
                        // console.log('[Call] 🔊 Audio playback started successfully');
                    } catch (err) {
                        // console.error('[Call] ❌ Lỗi play audio:', err);
                        // Retry sau 100ms
                        setTimeout(() => {
                            remoteAudioRef.current.play().catch(console.error);
                        }, 100);
                    }
                };
                
                playAudio();
            }
            
        } catch (error) {
            console.error('[Call] ❌ Lỗi setup audio:', error);
        }
    }, []);

    // ===== XỬ LÝ KẾT THÚC CUỘC GỌI ====
    const onCallEnded = useCallback((info) => {
        // console.log('[Call] 📞 Cuộc gọi kết thúc:', info);
        
        // Reset state
        setCallStage('idle');
        setStatusText('Sẵn sàng để gọi');
        setDurationText('00:00');
        setIsCalling(false);
        setIsRecording(false);
        currentCallRef.current = null;
        
        // Clear duration interval
        if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
        }
        
        // Stop recording (sẽ tự động gọi processRecording trong onstop)
        stopRecording();
        
        // Stop audio
        if (remoteAudioRef.current) {
            remoteAudioRef.current.pause();
            remoteAudioRef.current.srcObject = null;
        }
        
        // Reset lastEndInfo và flag sau khi đã xử lý (để tránh dùng lại dữ liệu cũ)
        setTimeout(() => {
            lastEndInfoRef.current = { statusCode: null, by: null, durationSec: 0, callStatus: 'failed' };
            lastDurationSecRef.current = 0;
            acceptedAtRef.current = 0;
            hasRingingRef.current = false; // Reset ringing flag
            processRecordingOnceRef.current = false; // Reset flag để cho phép lưu cuộc gọi tiếp theo
        }, 2000);
    }, [customer]);


    // ===== HIGH QUALITY AUDIO FUNCTIONS =====
    
    // 1. Cấu hình microphone với chất lượng cao
    const getHighQualityMicrophone = async () => {
        try {
            // console.log('[Call] 🎤 Getting high quality microphone...');
            const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        // Cấu hình chất lượng cao với âm lượng tối đa
                        sampleRate: 48000,           // Tần số lấy mẫu cao
                        channelCount: 2,             // Stereo
                        echoCancellation: true,      // Loại bỏ tiếng vang
                        noiseSuppression: true,      // Giảm nhiễu
                        autoGainControl: false,      // TẮT auto gain để giữ âm lượng cao
                        latency: 0.01,               // Độ trễ thấp
                        volume: 1.0,                 // Âm lượng tối đa
                        // Cấu hình nâng cao
                        sampleSize: 16,              // Bit depth
                        googEchoCancellation: true,  // Google echo cancellation
                        googNoiseSuppression: true,  // Google noise suppression
                        googAutoGainControl: false,   // TẮT Google auto gain
                        googHighpassFilter: false,   // TẮT highpass filter để giữ âm lượng
                        googTypingNoiseDetection: false, // TẮT typing noise detection
                        googAudioMirroring: false,   // Không mirror audio
                        googNoiseReduction: false    // TẮT noise reduction để giữ âm lượng
                    },
                video: false
            });
            
            // Kiểm tra chất lượng stream
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                const settings = audioTracks[0].getSettings();
                // console.log('[Call] 🎤 Microphone settings:', settings);
            }
            
            return stream;
        } catch (error) {
            console.error('[Call] ❌ High quality microphone failed, fallback to basic:', error);
            // Fallback về cấu hình cơ bản
            return await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false
            });
        }
    };

    // 2. AudioContext với xử lý âm thanh chuyên nghiệp
    const createHighQualityAudioContext = () => {
        try {
            // console.log('[Call] 🎤 Creating high quality AudioContext...');
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000,        // Tần số lấy mẫu cao
                latencyHint: 'interactive' // Độ trễ thấp
            });
            
            // Đảm bảo AudioContext hoạt động
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            
            return audioContext;
        } catch (error) {
            console.error('[Call] ❌ High quality AudioContext failed:', error);
            return new (window.AudioContext || window.webkitAudioContext)();
        }
    };

    // 3. Mix audio với xử lý âm thanh chuyên nghiệp
    const createHighQualityAudioMix = (audioContext, localStream, remoteStream) => {
        try {
            // console.log('[Call] 🎤 Creating high quality audio mix...');
            const destination = audioContext.createMediaStreamDestination();
            
            // Xử lý local stream (microphone)
            if (localStream) {
                const localSource = audioContext.createMediaStreamSource(localStream);
                
                // Thêm GainNode để điều chỉnh âm lượng
                const localGain = audioContext.createGain();
                localGain.gain.value = 2.0; // Tăng âm lượng microphone lên 2x
                
                // Thêm BiquadFilterNode để lọc tần số
                const localFilter = audioContext.createBiquadFilter();
                localFilter.type = 'highpass';
                localFilter.frequency.value = 80; // Lọc tần số thấp
                
                // Kết nối: source -> filter -> gain -> destination
                localSource.connect(localFilter);
                localFilter.connect(localGain);
                localGain.connect(destination);
                
                // console.log('[Call] 🎤 Connected local stream with audio processing');
            }
            
            // Xử lý remote stream (khách hàng)
            if (remoteStream) {
                const remoteSource = audioContext.createMediaStreamSource(remoteStream);
                
                // Thêm GainNode cho remote
                const remoteGain = audioContext.createGain();
                remoteGain.gain.value = 2.0; // Tăng âm lượng khách hàng lên 2x
                
                // Thêm filter cho remote
                const remoteFilter = audioContext.createBiquadFilter();
                remoteFilter.type = 'highpass';
                remoteFilter.frequency.value = 80;
                
                // Kết nối remote
                remoteSource.connect(remoteFilter);
                remoteFilter.connect(remoteGain);
                remoteGain.connect(destination);
                
                // console.log('[Call] 🎤 Connected remote stream with audio processing');
            }
            
            return destination;
        } catch (error) {
            console.error('[Call] ❌ High quality audio mix failed:', error);
            // Fallback về cách cũ
            const destination = audioContext.createMediaStreamDestination();
            if (localStream) {
                const localSource = audioContext.createMediaStreamSource(localStream);
                localSource.connect(destination);
            }
            if (remoteStream) {
                const remoteSource = audioContext.createMediaStreamSource(remoteStream);
                remoteSource.connect(destination);
            }
            return destination;
        }
    };

    // 4. MediaRecorder với cấu hình tối ưu
    const createHighQualityRecorder = (stream) => {
        try {
            // console.log('[Call] 🎤 Creating high quality recorder...');
            // Kiểm tra hỗ trợ codec
            const supportedTypes = [
                'audio/webm;codecs=opus',
                'audio/mp4;codecs=mp4a.40.2',
                'audio/webm',
                'audio/mp4'
            ];
            
            let selectedType = 'audio/webm;codecs=opus';
            for (const type of supportedTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    selectedType = type;
                    break;
                }
            }
            
            // console.log('[Call] 🎤 Selected codec:', selectedType);
            
            // Tạo MediaRecorder với cấu hình chất lượng cao
            const recorder = new MediaRecorder(stream, {
                mimeType: selectedType,
                audioBitsPerSecond: 128000, // Bitrate cao cho chất lượng tốt
                videoBitsPerSecond: 0
            });
            
            return recorder;
        } catch (error) {
            console.error('[Call] ❌ High quality recorder failed:', error);
            // Fallback về cấu hình cơ bản
            return new MediaRecorder(stream, { 
                mimeType: 'audio/webm;codecs=opus' 
            });
        }
    };

    // 5. Kiểm tra và tối ưu hóa môi trường ghi âm
    const optimizeRecordingEnvironment = async () => {
        try {
            // console.log('[Call] 🔍 Optimizing recording environment...');
            // Kiểm tra hỗ trợ Web Audio API
            if (!window.AudioContext && !window.webkitAudioContext) {
                throw new Error('Web Audio API not supported');
            }
            
            // Kiểm tra hỗ trợ MediaRecorder
            if (!window.MediaRecorder) {
                throw new Error('MediaRecorder not supported');
            }
            
            // Kiểm tra codec hỗ trợ
            const codecSupport = {
                opus: MediaRecorder.isTypeSupported('audio/webm;codecs=opus'),
                mp4: MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2'),
                webm: MediaRecorder.isTypeSupported('audio/webm')
            };
            
            // console.log('[Call] 🔍 Codec support:', codecSupport);
            
            // Kiểm tra microphone chất lượng
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            // console.log('[Call] 🔍 Available audio inputs:', audioInputs);
            
            return {
                audioContextSupported: true,
                mediaRecorderSupported: true,
                codecSupport,
                audioInputs
            };
        } catch (error) {
            console.error('[Call] ❌ Environment optimization failed:', error);
            return { error: error.message };
        }
    };


    // ===== RECORDING FUNCTIONS =====
    const startRecording = async () => {
        // console.log('[Call] 🎤 Starting high quality recording...');
        try {
            // 1. Tối ưu hóa môi trường
            const envCheck = await optimizeRecordingEnvironment();
            if (envCheck.error) {
                throw new Error(envCheck.error);
            }
            
            // 2. Lấy audio streams từ refs đã lưu
            const localStream = localStreamRef.current;
            const remoteStream = remoteStreamRef.current;
            
            // console.log('[Call] 🎤 Local stream:', localStream);
            // console.log('[Call] 🎤 Remote stream:', remoteStream);
            
            if (!localStream && !remoteStream) {
                // console.log('[Call] ⚠️ No audio streams available, using high quality microphone fallback');
                // Fallback: sử dụng microphone chất lượng cao
                const micStream = await getHighQualityMicrophone();
                const audioContext = createHighQualityAudioContext();
                const destination = createHighQualityAudioMix(audioContext, micStream, null);
                const recorder = createHighQualityRecorder(destination.stream);
                
                mediaRecorderRef.current = recorder;
                audioContextRef.current = audioContext;
                mixedDestinationRef.current = destination;
                recordedChunksRef.current = [];
                
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordedChunksRef.current.push(event.data);
                        // console.log('[Call] 🎤 Microphone chunk:', event.data.size, 'bytes');
                    }
                };
                
                recorder.onstop = async () => {
                    // console.log('[Call] 🎤 Recording stopped, processing...');
                    await processRecording();
                };
                
                recorder.start(1000);
                // console.log('[Call] 🎤 High quality microphone recording started');
                return;
            }
            
            // 3. Tạo AudioContext chất lượng cao
            const audioContext = createHighQualityAudioContext();
            
            // 4. Tạo destination với xử lý âm thanh
            const destination = createHighQualityAudioMix(audioContext, localStream, remoteStream);
            
            // 5. Tạo MediaRecorder chất lượng cao
            const recorder = createHighQualityRecorder(destination.stream);
            
            // 6. Lưu trữ refs
            mediaRecorderRef.current = recorder;
            audioContextRef.current = audioContext;
            mixedDestinationRef.current = destination;
            recordedChunksRef.current = [];
            
            // 7. Cấu hình event handlers
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                    // console.log('[Call] 🎤 High quality audio chunk:', event.data.size, 'bytes');
                }
            };
            
            recorder.onstop = async () => {
                // console.log('[Call] 🎤 Recording stopped, auto-saving...');
                // Tự động lưu ngay (không cần popup)
                await processRecording();
            };
            
            // 8. Bắt đầu ghi âm
            recorder.start(1000); // Chunk mỗi 1 giây
            // console.log('[Call] 🎤 High quality recording started with mixed audio streams');
            
        } catch (error) {
            console.error('[Call] ❌ High quality recording failed:', error);
            // Fallback về cách cũ
            startBasicRecording();
        }
    };

    // Fallback recording khi high quality thất bại
    const startBasicRecording = async () => {
        try {
            // console.log('[Call] 🎤 Starting basic recording (fallback)...');
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioContext.createMediaStreamDestination();
            
            // Kết nối streams
            if (localStreamRef.current) {
                const localSrc = audioContext.createMediaStreamSource(localStreamRef.current);
                localSrc.connect(destination);
            }
            
            if (remoteStreamRef.current) {
                const remoteSrc = audioContext.createMediaStreamSource(remoteStreamRef.current);
                remoteSrc.connect(destination);
            }
            
            // MediaRecorder cơ bản
            const recorder = new MediaRecorder(destination.stream, { 
                mimeType: 'audio/webm;codecs=opus' 
            });
            
            mediaRecorderRef.current = recorder;
            audioContextRef.current = audioContext;
            mixedDestinationRef.current = destination;
            recordedChunksRef.current = [];
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };
            
            recorder.onstop = async () => {
                // console.log('[Call] 🎤 Recording stopped (fallback), auto-saving...');
                // Tự động lưu ngay (không cần popup)
                await processRecording();
            };
            
            recorder.start(1000);
            // console.log('[Call] 🎤 Basic recording started (fallback)');
            
        } catch (error) {
            console.error('[Call] ❌ Basic recording also failed:', error);
            toast.error('Không thể bắt đầu ghi âm');
        }
    };

    const stopRecording = () => {
        // console.log('[Call] 🎤 Stopping recording...');
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                // Đảm bảo onstop được gọi để tự động lưu
                if (!mediaRecorderRef.current.onstop) {
                    mediaRecorderRef.current.onstop = async () => {
                        // console.log('[Call] 🎤 Recording stopped, auto-saving...');
                        await processRecording();
                    };
                }
                mediaRecorderRef.current.stop();
            } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                // Nếu recorder đã stop, gọi processRecording trực tiếp
                // console.log('[Call] 🎤 Recorder already stopped, auto-saving...');
                processRecording().catch(err => console.error('[Call] ❌ Auto-save failed:', err));
            } else if (!mediaRecorderRef.current && hasRingingRef.current) {
                // Nếu không có recorder nhưng đã có ringing event → cập nhật pipelineStatus
                // console.log('[Call] 🎤 No recorder but has ringing event, updating pipelineStatus...');
                updatePipelineStatusOnly().catch(err => console.error('[Call] ❌ Update pipelineStatus failed:', err));
            }
            
            // Cleanup audio context
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            
            // Clear refs
            mixedDestinationRef.current = null;
            localStreamRef.current = null;
            remoteStreamRef.current = null;
            
            // console.log('[Call] 🎤 Recording stopped');
        } catch (error) {
            console.error('[Call] ❌ Recording stop failed:', error);
            // Vẫn thử lưu nếu có dữ liệu hoặc đã có ringing event
            if (recordedChunksRef.current.length > 0) {
                processRecording().catch(err => console.error('[Call] ❌ Auto-save failed:', err));
            } else if (hasRingingRef.current) {
                updatePipelineStatusOnly().catch(err => console.error('[Call] ❌ Update pipelineStatus failed:', err));
            }
        }
    };

    // Function riêng để chỉ cập nhật pipelineStatus (không lưu Call record)
    const updatePipelineStatusOnly = async () => {
        if (processRecordingOnceRef.current) {
            // console.log('[Call] ⚠️ updatePipelineStatusOnly already called, skipping...');
            return;
        }

        if (!customer?._id) {
            console.error('[Call] ❌ No customer ID');
            return;
        }

        // Lấy duration và callStatus từ lastEndInfoRef
        const { statusCode, durationSec, callStatus } = lastEndInfoRef.current || {};
        const finalDuration = durationSec || lastDurationSecRef.current || 0;
        const hasRinging = hasRingingRef.current;
        const finalStatus = callStatus || toCallStatus(statusCode, finalDuration);

        // Chỉ cập nhật nếu đã có ringing và cuộc gọi kết thúc sớm
        if (!hasRinging || (finalDuration >= 5 && finalStatus === 'completed')) {
            // console.log('[Call] ⚠️ Không cần cập nhật pipelineStatus');
            return;
        }

        processRecordingOnceRef.current = true;

        try {
            // console.log('[Call] 📤 Chỉ cập nhật pipelineStatus, không lưu Call record');
            const { updatePipelineStatusForCall } = await import('@/data/call/wraperdata.db');
            const result = await updatePipelineStatusForCall(
                customer._id,
                finalStatus,
                hasRinging,
                finalDuration,
                '' // crmStatus - để trống vì không có popup
            );
            
            if (result.success) {
                // console.log('[Call] ✅ PipelineStatus đã được cập nhật:', result.pipelineStatus4);
                toast.success('Đã cập nhật trạng thái cuộc gọi');
            } else {
                console.error('[Call] ❌ Update pipelineStatus failed:', result.error);
                toast.error('Không thể cập nhật trạng thái: ' + result.error);
                processRecordingOnceRef.current = false;
            }
        } catch (error) {
            console.error('[Call] ❌ Update pipelineStatus error:', error);
            toast.error('Lỗi khi cập nhật trạng thái: ' + error.message);
            processRecordingOnceRef.current = false;
        }
    };

    const processRecording = async () => {
        // Tránh gọi nhiều lần
        if (processRecordingOnceRef.current) {
            // console.log('[Call] ⚠️ processRecording already called, skipping...');
            return;
        }
        
        // Kiểm tra có dữ liệu để lưu không
        if (recordedChunksRef.current.length === 0) {
            // console.log('[Call] ⚠️ No recording data to save');
            return;
        }
        
        // Lấy duration và callStatus từ lastEndInfoRef (đã tính trong ended event)
        const { statusCode, durationSec, callStatus } = lastEndInfoRef.current || {};
        const finalDuration = durationSec || lastDurationSecRef.current || 0;
        
        // KIỂM TRA: Nếu cuộc gọi dưới 5 giây, không lưu ghi âm
        if (finalDuration < 5) {
            console.log(`[Call] ⚠️ Cuộc gọi quá ngắn (${finalDuration}s < 2s), không lưu ghi âm`);
            toast.info(`Cuộc gọi quá ngắn (${finalDuration}s), không lưu ghi âm`);
            // Reset flag để cho phép lưu cuộc gọi tiếp theo
            processRecordingOnceRef.current = false;
            return;
        }
        
        processRecordingOnceRef.current = true;
        
        try {
            // console.log('[Call] 🎤 Processing recording (auto-save)...');
            
            // Validate customer and user IDs
            if (!customer?._id) {
                console.error('[Call] ❌ No customer ID');
                toast.error('Thiếu thông tin khách hàng');
                processRecordingOnceRef.current = false;
                return;
            }
            
            // Sử dụng thông tin khách hàng làm user
            const customerAsUser = {
                _id: customer._id,
                name: customer.name || customer.zaloname || 'Khách hàng',
                email: customer.email || `${customer.phone || customer.phonex}@customer.local`,
                phone: customer.phone || customer.phonex,
                area: customer.area || 'Không xác định'
            };
            
            // console.log('[Call] 🎤 Using customer as user:', customerAsUser);
            // console.log('[Call] 🎤 Customer ID:', customer._id);
            // console.log('[Call] 🎤 Duration:', finalDuration, 'seconds');
            
            // KIỂM TRA LẠI: Nếu cuộc gọi dưới 5 giây, không lưu ghi âm
            if (finalDuration < 5) {
                console.log(`[Call] ⚠️ Cuộc gọi quá ngắn (${finalDuration}s < 2s), không lưu ghi âm`);
                toast.info(`Cuộc gọi quá ngắn (${finalDuration}s), không lưu ghi âm`);
                processRecordingOnceRef.current = false;
                return;
            }
            
            const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
            // console.log('[Call] 🎤 Audio blob created:', audioBlob.size, 'bytes');
            
            // Tạo tên file với thông tin khách hàng
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const fileName = `rec-${customerAsUser.phone}-${timestamp}.webm`;
            
            const formData = new FormData();
            formData.append('recordingFile', audioBlob, fileName);
            formData.append('recordingFileName', fileName);
            formData.append('customerId', String(customer._id));
            formData.append('userId', String(customerAsUser._id)); // Sử dụng customer ID làm user ID
            formData.append('userName', customerAsUser.name);
            formData.append('userEmail', customerAsUser.email);
            formData.append('userPhone', customerAsUser.phone);
            formData.append('userArea', customerAsUser.area);
            // Lấy duration và callStatus từ lastEndInfoRef (đã tính trong ended event)
            const finalStatus = callStatus || toCallStatus(statusCode, finalDuration);
            const finalCode = statusCode ?? 0;

            formData.append('duration', String(finalDuration));
            formData.append('startTime', new Date(Date.now() - (finalDuration * 1000)).toISOString());
            formData.append('callStatus', finalStatus);
            formData.append('sipStatusCode', String(finalCode));
            
            const result = await saveCallAction(null, formData);
            
            if (result.success) {
                // console.log('[Call] 🎤 Call saved successfully (auto-saved)');
                toast.success('Cuộc gọi đã được lưu tự động');
                
                // Reload call history
                const history = await call_data({ customerId: customer._id });
                setCallHistory(history || []);
            } else {
                // console.error('[Call] ❌ Save call failed:', result.error);
                toast.error('Không thể lưu cuộc gọi: ' + result.error);
                processRecordingOnceRef.current = false; // Cho phép thử lại
            }
            
        } catch (error) {
            console.error('[Call] ❌ Process recording failed:', error);
            toast.error('Không thể xử lý ghi âm');
            processRecordingOnceRef.current = false; // Cho phép thử lại
        }
    };

    // ===== CALL FUNCTIONS =====
    const makeCall = async () => {
        // console.log('[Call] 📞 makeCall() called');
        
        try {
            if (connectionStatus.status !== 'connected') {
                // console.log('[Call] ❌ Not connected');
                toast.error('Chưa kết nối tổng đài');
                return;
            }

            if (isCalling) {
                // console.log('[Call] ❌ Already calling');
                toast.warning('Đang có cuộc gọi khác');
                return;
            }

            const phoneNumber = customer?.phone;
            if (!phoneNumber) {
                // console.log('[Call] ❌ No phone number');
                toast.error('Thiếu số điện thoại khách hàng');
                return;
            }

            // console.log('[Call] 📞 Making call to:', phoneNumber);

            // Request microphone permission
            try {
                await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                    video: false
                });
            } catch (micError) {
                // console.error('[Call] ❌ Microphone permission denied:', micError);
                toast.error('Cần quyền truy cập microphone để thực hiện cuộc gọi');
                return;
            }
            
            // Real call implementation
            callCountRef.current += 1;
            const callId = `call_${callCountRef.current}_${Date.now()}`;
            
            // console.log('[Call] 📞 Starting real call...');
            
            // Set connecting state
            setCallStage('connecting');
            setStatusText('Đang kết nối...');
            setDurationText('00:00');
            setIsCalling(true);
            
            // Thực hiện cuộc gọi thực tế
            try {
                // console.log('[Call] 📞 Making real call to:', phoneNumber);
                
                // Kiểm tra OMI Call SDK có sẵn không
                if (sdkRef.current) {
                    // console.log('[Call] 📞 Using OMI Call SDK for real call');
                    
                    // Gọi giống TestCallComponent: chỉ truyền số điện thoại
                    await sdkRef.current.makeCall(phoneNumber);
                    
                    // console.log('[Call] ✅ OMI Call initiated successfully');
                    toast.success(`Đang gọi ${phoneNumber} qua OMI Call SDK`);
                    
                } else {
                    // Fallback: Mở ứng dụng gọi điện thực tế
                    // console.log('[Call] 📞 OMI SDK not available, using tel: protocol');
                    const telUrl = `tel:${phoneNumber}`;
                    const link = document.createElement('a');
                    link.href = telUrl;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    // console.log('[Call] 📱 Real call initiated - Phone app opened');
                    toast.success(`Đang gọi ${phoneNumber}. Vui lòng thực hiện cuộc gọi thủ công.`);
                    
                    // Reset state sau khi mở phone app
                    setTimeout(() => {
                        setCallStage('idle');
                        setStatusText('Sẵn sàng để gọi');
                        setIsCalling(false);
                        setIsRecording(false);
                        setDurationText('00:00');
                    }, 2000);
                }
                
            } catch (error) {
                console.error('[Call] ❌ Real call failed:', error);
                toast.error('Không thể thực hiện cuộc gọi thực tế');
                
                // Reset state on error
                setCallStage('idle');
                setStatusText('Sẵn sàng để gọi');
                setIsCalling(false);
                setIsRecording(false);
                setDurationText('00:00');
            }
            
            toast.success('Đang thực hiện cuộc gọi...');
            
        } catch (error) {
            console.error('[Call] ❌ Make call error:', error);
            toast.error('Không thể thực hiện cuộc gọi');
        }
    };

    const endCall = async () => {
        try {
            // console.log('[Call] 📞 Ending call');
            
            // Debug: Log available methods
            if (currentCallRef.current) {
                console.log('[Call] 🔍 Available methods on currentCallRef:', Object.getOwnPropertyNames(currentCallRef.current));
            }
            if (sdkRef.current) {
                console.log('[Call] 🔍 Available methods on sdkRef:', Object.getOwnPropertyNames(sdkRef.current));
            }
            
            // End call using multiple methods to ensure call is terminated
            if (currentCallRef.current) {
                // console.log('[Call] 🔄 Attempting to end call via currentCallRef...');
                
                // Method 1: Try end() method
                if (typeof currentCallRef.current.end === 'function') {
                    try {
                        await currentCallRef.current.end();
                        // console.log('[Call] ✅ Call ended via currentCallRef.end()');
                    } catch (error) {
                        console.log('[Call] ⚠️ currentCallRef.end() failed:', error);
                    }
                }
                
                // Method 2: Try hangup() method
                if (currentCallRef.current && typeof currentCallRef.current.hangup === 'function') {
                    try {
                        await currentCallRef.current.hangup();
                        // console.log('[Call] ✅ Call ended via currentCallRef.hangup()');
                    } catch (error) {
                        console.log('[Call] ⚠️ currentCallRef.hangup() failed:', error);
                    }
                }
                
                // Method 3: Try terminate() method
                if (currentCallRef.current && typeof currentCallRef.current.terminate === 'function') {
                    try {
                        await currentCallRef.current.terminate();
                        // console.log('[Call] ✅ Call ended via currentCallRef.terminate()');
                    } catch (error) {
                        console.log('[Call] ⚠️ currentCallRef.terminate() failed:', error);
                    }
                }
            }
            
            // Fallback: Try SDK methods
            if (sdkRef.current) {
                // console.log('[Call] 🔄 Attempting to end call via SDK...');
                
                // Method 1: Try endCall() method
                if (typeof sdkRef.current.endCall === 'function') {
                    try {
                        await sdkRef.current.endCall();
                        // console.log('[Call] ✅ Call ended via sdkRef.endCall()');
                    } catch (error) {
                        console.log('[Call] ⚠️ sdkRef.endCall() failed:', error);
                    }
                }
                
                // Method 2: Try hangup() method
                if (typeof sdkRef.current.hangup === 'function') {
                    try {
                        await sdkRef.current.hangup();
                        // console.log('[Call] ✅ Call ended via sdkRef.hangup()');
                    } catch (error) {
                        console.log('[Call] ⚠️ sdkRef.hangup() failed:', error);
                    }
                }
                
                // Method 3: Try disconnect() method
                if (typeof sdkRef.current.disconnect === 'function') {
                    try {
                        await sdkRef.current.disconnect();
                        // console.log('[Call] ✅ Call ended via sdkRef.disconnect()');
                    } catch (error) {
                        console.log('[Call] ⚠️ sdkRef.disconnect() failed:', error);
                    }
                }
            }
            
            // Force disconnect all calls
            if (sdkRef.current && typeof sdkRef.current.disconnectAll === 'function') {
                try {
                    await sdkRef.current.disconnectAll();
                    // console.log('[Call] ✅ All calls disconnected via disconnectAll()');
                } catch (error) {
                    console.log('[Call] ⚠️ disconnectAll() failed:', error);
                }
            }
            
            // Force reset state regardless of SDK response
            // console.log('[Call] 🔄 Force resetting call state...');
            onCallEnded(null);
            
            toast.success('Đã kết thúc cuộc gọi');
            
        } catch (error) {
            console.error('[Call] ❌ End call error:', error);
            
            // Force reset state even if there's an error
            // console.log('[Call] 🔄 Force resetting call state due to error...');
            onCallEnded(null);
            
            toast.success('Đã kết thúc cuộc gọi');
        }
    };

    // ===== UTILITY FUNCTIONS =====
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


    const forceReloadHistory = async () => {
        try {
            // console.log('[Call] 🔄 Force reloading call history...');
            const history = await call_data({ customerId: customer._id });
            setCallHistory(history || []);
            toast.success('Đã tải lại dữ liệu cuộc gọi');
        } catch (error) {
            console.error('[Call] ❌ Force reload error:', error);
            toast.error('Có lỗi khi tải lại dữ liệu');
        }
    };

    // ===== EFFECTS =====
    useEffect(() => {
        // console.log('[Call] 🚀 Component mounted, initializing...');
        
        // ===== KIỂM TRA SDK INJECT STYLES =====
        // Lưu styles ban đầu của body và html để so sánh
        const originalBodyStyles = {
            overflow: document.body.style.overflow || '',
            position: document.body.style.position || '',
            width: document.body.style.width || '',
            height: document.body.style.height || '',
            margin: document.body.style.margin || '',
            padding: document.body.style.padding || ''
        };
        
        const originalHtmlStyles = {
            overflow: document.documentElement.style.overflow || '',
            position: document.documentElement.style.position || '',
            width: document.documentElement.style.width || '',
            height: document.documentElement.style.height || '',
            margin: document.documentElement.style.margin || '',
            padding: document.documentElement.style.padding || ''
        };
        
        // Lưu classes ban đầu
        const originalBodyClasses = document.body.className;
        const originalHtmlClasses = document.documentElement.className;
        
        // Đếm số lượng <style> tags ban đầu
        const originalStyleTagsCount = document.head.querySelectorAll('style').length;
        const originalLinkTagsCount = document.head.querySelectorAll('link[rel="stylesheet"]').length;
        
        // console.log('[Call] 📊 Original body styles:', originalBodyStyles);
        // console.log('[Call] 📊 Original html styles:', originalHtmlStyles);
        // console.log('[Call] 📊 Original body classes:', originalBodyClasses);
        // console.log('[Call] 📊 Original html classes:', originalHtmlClasses);
        // console.log('[Call] 📊 Original style tags count:', originalStyleTagsCount);
        // console.log('[Call] 📊 Original link tags count:', originalLinkTagsCount);
        
        // ===== TẠO SHADOW DOM ĐỂ CHẶN SDK INJECT CSS =====
        let shadowHost = null;
        let shadowRoot = null;
        
        try {
            // Kiểm tra xem shadow host đã tồn tại chưa
            shadowHost = document.getElementById('omi-shadow-host');
            
            if (!shadowHost) {
                // Tạo shadow host
                shadowHost = document.createElement('div');
                shadowHost.id = 'omi-shadow-host';
                shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: -1;';
                document.body.appendChild(shadowHost);
                
                // Tạo shadow root
                shadowRoot = shadowHost.attachShadow({ mode: 'open' });
                
                // Tạo container trong shadow DOM
                const shadowContainer = document.createElement('div');
                shadowContainer.id = 'omi-shadow-container';
                shadowRoot.appendChild(shadowContainer);
                
                // console.log('[Call] ✅ Shadow DOM đã được tạo để chặn SDK inject CSS');
            } else {
                shadowRoot = shadowHost.shadowRoot;
                // console.log('[Call] ✅ Shadow DOM đã tồn tại, sử dụng lại');
            }
        } catch (error) {
            console.error('[Call] ❌ Lỗi khi tạo Shadow DOM:', error);
        }
        
        // ===== CHẶN SDK INJECT CSS VÀO HEAD =====
        // Override document.createElement để chặn SDK tạo style/link tags
        const originalCreateElement = document.createElement.bind(document);
        let createElementOverride = null;
        let shadowHostRef = shadowHost; // Lưu ref để cleanup
        
        if (shadowRoot) {
            createElementOverride = function(tagName, options) {
                const element = originalCreateElement(tagName, options);
                
                // Nếu SDK cố tạo style hoặc link tag, chuyển vào Shadow DOM
                if (tagName.toLowerCase() === 'style' || 
                    (tagName.toLowerCase() === 'link' && element.rel === 'stylesheet')) {
                    const href = element.href || '';
                    const content = element.textContent || element.innerHTML || '';
                    
                    // Kiểm tra nếu là từ SDK (chứa omicrm.com hoặc omi-css)
                    if (href.includes('omicrm.com') || 
                        content.includes('omi-css') || 
                        content.includes('omi-toastify') ||
                        content.includes('with-scroll-bars-hidden')) {
                        // console.log('[Call] 🚫 CHẶN SDK inject CSS:', tagName, href || content.substring(0, 100));
                        
                        // Chuyển vào Shadow DOM thay vì head
                        try {
                            shadowRoot.appendChild(element);
                            // console.log('[Call] ✅ Đã chuyển CSS vào Shadow DOM');
                            return element; // Trả về element nhưng đã ở trong Shadow DOM
                        } catch (err) {
                            console.error('[Call] ❌ Lỗi khi chuyển vào Shadow DOM:', err);
                            // Fallback: Xóa element
                            return document.createDocumentFragment(); // Trả về fragment rỗng
                        }
                    }
                }
                
                return element;
            };
            
            // Override document.createElement
            document.createElement = createElementOverride;
            // console.log('[Call] ✅ Đã override document.createElement để chặn SDK inject CSS');
        }
        
        // MutationObserver để theo dõi và chặn style changes
        let styleObserver = null;
        try {
            styleObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    // Theo dõi thay đổi style attribute
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        const target = mutation.target;
                        const currentStyle = target.style.cssText;
                        
                        // if (target === document.body) {
                        //     console.log('[Call] ⚠️ Body style changed:', currentStyle);
                        //     console.log('[Call] 📊 Body computed style:', {
                        //         overflow: window.getComputedStyle(document.body).overflow,
                        //         position: window.getComputedStyle(document.body).position,
                        //         width: window.getComputedStyle(document.body).width,
                        //         height: window.getComputedStyle(document.body).height
                        //     });
                        // }
                        
                        // if (target === document.documentElement) {
                        //     console.log('[Call] ⚠️ HTML style changed:', currentStyle);
                        //     console.log('[Call] 📊 HTML computed style:', {
                        //         overflow: window.getComputedStyle(document.documentElement).overflow,
                        //         position: window.getComputedStyle(document.documentElement).position,
                        //         width: window.getComputedStyle(document.documentElement).width,
                        //         height: window.getComputedStyle(document.documentElement).height
                        //     });
                        // }
                    }
                    
                    // Theo dõi thay đổi class attribute
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const target = mutation.target;
                        // if (target === document.body) {
                        //     console.log('[Call] ⚠️ Body classes changed:', document.body.className);
                        //     console.log('[Call] 📊 Original was:', originalBodyClasses);
                        // }
                        // if (target === document.documentElement) {
                        //     console.log('[Call] ⚠️ HTML classes changed:', document.documentElement.className);
                        //     console.log('[Call] 📊 Original was:', originalHtmlClasses);
                        // }
                    }
                    
                    // Theo dõi thêm <style> tags vào head
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                if (node.tagName === 'STYLE') {
                                    const content = node.textContent || node.innerHTML || '';
                                    // console.log('[Call] ⚠️⚠️⚠️ SDK ĐÃ THÊM <style> TAG!');
                                    // console.log('[Call] Style content:', content.substring(0, 200));
                                    // console.log('[Call] Style element:', node);
                                    
                                    // Nếu style tag chứa .with-scroll-bars-hidden (gây vỡ layout)
                                    if (content.includes('with-scroll-bars-hidden') && content.includes('overflow')) {
                                        // console.log('[Call] 🚫 PHÁT HIỆN STYLE TAG GÂY VỠ LAYOUT! Đang xóa...');
                                        try {
                                            node.remove();
                                            // console.log('[Call] ✅ Đã xóa style tag gây vỡ layout');
                                        } catch (error) {
                                            console.error('[Call] ❌ Lỗi khi xóa style tag:', error);
                                        }
                                    }
                                }
                                
                                if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
                                    // console.log('[Call] ⚠️⚠️⚠️ SDK ĐÃ THÊM <link> STYLESHEET!');
                                    // console.log('[Call] Link href:', node.href);
                                    // console.log('[Call] Link element:', node);
                                    
                                    // Nếu là stylesheet từ SDK, chuyển vào Shadow DOM
                                    if (node.href && node.href.includes('omicrm.com')) {
                                        // console.log('[Call] 🚫 CHẶN SDK stylesheet, chuyển vào Shadow DOM...');
                                        try {
                                            if (shadowRoot) {
                                                shadowRoot.appendChild(node);
                                                // console.log('[Call] ✅ Đã chuyển stylesheet vào Shadow DOM');
                                            } else {
                                                node.remove();
                                                // console.log('[Call] ✅ Đã xóa stylesheet (không có Shadow DOM)');
                                            }
                                        } catch (error) {
                                            console.error('[Call] ❌ Lỗi khi chuyển stylesheet:', error);
                                        }
                                    }
                                }
                            }
                        });
                    }
                });
            });
            
            // Quan sát body và html attributes (style, class)
            styleObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
            
            styleObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
            
            // Quan sát head để phát hiện thêm <style> hoặc <link> tags
            styleObserver.observe(document.head, {
                childList: true,
                subtree: true
            });
            
            // console.log('[Call] ✅ Style observer đã được thiết lập để theo dõi SDK inject styles');
        } catch (error) {
            console.error('[Call] ❌ Lỗi khi thiết lập style observer:', error);
        }
        
        // Kiểm tra styles sau khi SDK load (với delay)
        const checkStylesAfterSDKLoad = () => {
            setTimeout(() => {
                const currentBodyStyle = {
                    overflow: document.body.style.overflow || '',
                    position: document.body.style.position || '',
                    width: document.body.style.width || '',
                    height: document.body.style.height || '',
                    margin: document.body.style.margin || '',
                    padding: document.body.style.padding || ''
                };
                
                const currentHtmlStyle = {
                    overflow: document.documentElement.style.overflow || '',
                    position: document.documentElement.style.position || '',
                    width: document.documentElement.style.width || '',
                    height: document.documentElement.style.height || '',
                    margin: document.documentElement.style.margin || '',
                    padding: document.documentElement.style.padding || ''
                };
                
                const bodyComputed = window.getComputedStyle(document.body);
                const htmlComputed = window.getComputedStyle(document.documentElement);
                
                // Kiểm tra classes
                const currentBodyClasses = document.body.className;
                const currentHtmlClasses = document.documentElement.className;
                
                // Kiểm tra style tags
                const currentStyleTagsCount = document.head.querySelectorAll('style').length;
                const currentLinkTagsCount = document.head.querySelectorAll('link[rel="stylesheet"]').length;
                
                // console.log('[Call] 📊 Body styles after SDK load:', currentBodyStyle);
                // console.log('[Call] 📊 HTML styles after SDK load:', currentHtmlStyle);
                // console.log('[Call] 📊 Body computed styles:', {
                //     overflow: bodyComputed.overflow,
                //     position: bodyComputed.position,
                //     width: bodyComputed.width,
                //     height: bodyComputed.height
                // });
                // console.log('[Call] 📊 HTML computed styles:', {
                //     overflow: htmlComputed.overflow,
                //     position: htmlComputed.position,
                //     width: htmlComputed.width,
                //     height: htmlComputed.height
                // });
                // console.log('[Call] 📊 Body classes after SDK load:', currentBodyClasses);
                // console.log('[Call] 📊 HTML classes after SDK load:', currentHtmlClasses);
                // console.log('[Call] 📊 Style tags count after SDK load:', currentStyleTagsCount, '(original:', originalStyleTagsCount, ')');
                // console.log('[Call] 📊 Link tags count after SDK load:', currentLinkTagsCount, '(original:', originalLinkTagsCount, ')');
                
                // So sánh với original
                const bodyStyleChanged = JSON.stringify(currentBodyStyle) !== JSON.stringify(originalBodyStyles);
                const htmlStyleChanged = JSON.stringify(currentHtmlStyle) !== JSON.stringify(originalHtmlStyles);
                const bodyClassChanged = currentBodyClasses !== originalBodyClasses;
                const htmlClassChanged = currentHtmlClasses !== originalHtmlClasses;
                const styleTagsAdded = currentStyleTagsCount > originalStyleTagsCount;
                const linkTagsAdded = currentLinkTagsCount > originalLinkTagsCount;
                
                if (bodyStyleChanged || htmlStyleChanged || bodyClassChanged || htmlClassChanged || styleTagsAdded || linkTagsAdded) {
                    console.warn('[Call] ⚠️⚠️⚠️ SDK ĐÃ THAY ĐỔI STYLES/CSS!');
                    console.warn('[Call] Body style changed:', bodyStyleChanged);
                    console.warn('[Call] HTML style changed:', htmlStyleChanged);
                    console.warn('[Call] Body class changed:', bodyClassChanged);
                    if (bodyClassChanged) {
                        console.warn('[Call] Body classes changed from:', originalBodyClasses, 'to:', currentBodyClasses);
                    }
                    console.warn('[Call] HTML class changed:', htmlClassChanged);
                    if (htmlClassChanged) {
                        console.warn('[Call] HTML classes changed from:', originalHtmlClasses, 'to:', currentHtmlClasses);
                    }
                    console.warn('[Call] Style tags added:', styleTagsAdded);
                    console.warn('[Call] Link tags added:', linkTagsAdded);
                } else {
                    console.log('[Call] ✅ Styles/CSS không bị thay đổi bởi SDK (inline styles và classes)');
                }
            }, 2000); // Check sau 2 giây (sau khi SDK load)
        };
        
        checkStylesAfterSDKLoad();
        
        // Thêm CSS để ẩn popup màu đen của OMICall SDK
        const styleId = 'hide-omicall-popup';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                /* Ẩn popup/overlay mặc định của OMICall SDK */
                [class*="omi-call"],
                [class*="omicall"],
                [id*="omi-call"],
                [id*="omicall"],
                [data-omicall-popup],
                [data-omi-call-popup],
                .omi-call-popup,
                .omicall-popup,
                .omi-call-overlay,
                .omicall-overlay {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
            `;
            document.head.appendChild(style);
            // console.log('[Call] ✅ CSS để ẩn popup OMICall đã được thêm');
        }
        
        // MutationObserver để ẩn popup ngay khi SDK tạo
        let observer = null;
        try {
            observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        const el = node;
                        // Kiểm tra nếu là popup của OMICall SDK (có background màu đen/xanh đậm, position fixed)
                        const style = window.getComputedStyle(el);
                        const isFixed = style.position === 'fixed';
                        const hasHighZIndex = parseInt(style.zIndex) > 1000;
                        const hasDarkBg = style.backgroundColor && (
                            style.backgroundColor.includes('rgb(0,') ||
                            style.backgroundColor.includes('rgba(0,') ||
                            style.backgroundColor.includes('#000') ||
                            style.backgroundColor.includes('#1') ||
                            style.backgroundColor.includes('rgb(13,') ||
                            style.backgroundColor.includes('rgb(17,') ||
                            style.backgroundColor.includes('rgb(30,')
                        );
                        
                        // Nếu là popup của SDK (fixed position, z-index cao, background tối)
                        if (isFixed && hasHighZIndex && hasDarkBg && !el.closest('[id*="sonner"]') && !el.closest('[class*="toast"]')) {
                            // console.log('[Call] 🚫 Phát hiện popup OMICall SDK, đang ẩn...', el);
                            el.style.display = 'none';
                            el.style.visibility = 'hidden';
                            el.style.opacity = '0';
                            el.style.pointerEvents = 'none';
                        }
                        
                        // Kiểm tra các element con có thể là popup
                        const children = el.querySelectorAll ? el.querySelectorAll('[class*="omi"], [id*="omi"], [class*="omicall"], [id*="omicall"]') : [];
                        children.forEach((child) => {
                            const childStyle = window.getComputedStyle(child);
                            if (childStyle.position === 'fixed' && parseInt(childStyle.zIndex) > 1000) {
                                // console.log('[Call] 🚫 Phát hiện popup OMICall SDK (child), đang ẩn...', child);
                                child.style.display = 'none';
                                child.style.visibility = 'hidden';
                                child.style.opacity = '0';
                                child.style.pointerEvents = 'none';
                            }
                        });
                    }
                });
            });
        });
        
            // Bắt đầu quan sát
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // console.log('[Call] ✅ MutationObserver đã được thiết lập để ẩn popup OMICall');
        } catch (error) {
            console.error('[Call] ❌ Lỗi khi thiết lập MutationObserver:', error);
        }
        
        initializeSDK();
        
        // Check if OMI SDK is available and initialize if needed
        const checkAndInitializeOMI = async () => {
            if (window.OMICallSDK && !sdkRef.current) {
                // console.log('[Call] 🔄 OMI SDK available, initializing...');
                await handleSDKLoad();
            }
        };
        
        // Check after a short delay to ensure SDK is loaded
        const timeoutId = setTimeout(checkAndInitializeOMI, 1000);
        
        return () => {
            // console.log('[Call] 🧹 Component unmounting, cleaning up...');
            clearTimeout(timeoutId);
            if (observer) {
                observer.disconnect(); // Dừng MutationObserver
            }
            
            // Clear duration interval
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
            
            // Clean up OMI SDK if needed
            if (sdkRef.current) {
                try {
                    sdkRef.current.disconnect?.();
                } catch (error) {
                    console.log('[Call] ⚠️ Error disconnecting OMI SDK:', error);
                }
            }
        };
    }, []); // Empty dependency array to prevent re-initialization

    // ===== OMI SDK LOAD WATCHER =====
    useEffect(() => {
        const checkOMISDK = () => {
            if (window.OMICallSDK && !sdkRef.current) {
                // console.log('[Call] 🔄 OMI SDK detected, initializing...');
                handleSDKLoad();
            }
        };
        
        // Check immediately
        checkOMISDK();
        
        // Check periodically
        const intervalId = setInterval(checkOMISDK, 2000);
        
        return () => {
            clearInterval(intervalId);
        };
    }, [handleSDKLoad]);

    useEffect(() => {
        if (!customer?._id) return;
        
        const loadCallHistory = async () => {
            try {
                setLoading(true);
                // console.log('[Call] 📚 Loading call history for customer:', customer._id);
                
                const history = await call_data({ customerId: customer._id });
                setCallHistory(history || []);
            } catch (error) {
                console.error('[Call] ❌ Load history error:', error);
            } finally {
                setLoading(false);
            }
        };

        loadCallHistory();
    }, [customer?._id]);

    return (
        <>
            {/* Load OMI Call SDK */}
            <Script
                src="https://cdn.omicrm.com/sdk/web/3.0.33/core.min.js"
                onLoad={handleSDKLoad}
                strategy="lazyOnload"
            />
            
            <div className="flex flex-col h-full w-full p-2 gap-2 overflow-hidden">
            {/* Call Section */}
            <Card className="flex-shrink-0">
                <CardHeader className="pb-1">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Phone className="h-3 w-3" />
                        Thông tin & Gọi
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pt-0">
                    {/* Connection Status */}
                    <div className="flex items-center gap-1 p-1 bg-gray-50 rounded">
                        {getStatusIcon()}
                        <span className="text-xs font-medium">Trạng thái kết nối</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            connectionStatus.status === 'connected' 
                                ? 'bg-green-100 text-green-800' 
                                : connectionStatus.status === 'connecting'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                        }`}>
                            {connectionStatus.text}
                        </span>
                    </div>

                    {/* Customer Info */}
                    <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={customer?.zaloavt || customer?.avatar} />
                            <AvatarFallback className="text-xs">{customer?.name?.charAt(0) || customer?.zaloname?.charAt(0) || 'C'}</AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="font-medium text-xs">{customer?.name || customer?.zaloname || 'Không có tên'}</div>
                            <div className="text-xs text-gray-600">{maskPhoneNumber(customer?.phone || customer?.phonex) || 'Không có số điện thoại'}</div>
                            {customer?.area && (
                                <div className="text-xs text-gray-500">{customer.area}</div>
                            )}
                            <div className="text-xs text-blue-600 font-medium">📞 Thông tin này sẽ được lưu cùng ghi âm</div>
                        </div>
                    </div>


                    {/* Call Button */}
                    <div className="flex gap-2">
                        {callStage === 'idle' ? (
                            <Button
                                onClick={makeCall}
                                disabled={connectionStatus.status !== 'connected' || !customer?.phone || isCalling}
                                className="flex-1 h-7 text-xs"
                                size="sm"
                            >
                                <Phone className="mr-1 h-3 w-3" />
                                Gọi thực tế
                            </Button>
                        ) : (
                            <Button 
                                variant="destructive" 
                                onClick={endCall} 
                                className="flex-1 h-7 text-xs"
                                size="sm"
                                disabled={!isCalling}
                            >
                                <PhoneOff className="mr-1 h-3 w-3" />
                                Kết thúc cuộc gọi
                            </Button>
                        )}
                    </div>

                    {/* Call Status Display */}
                    {isCalling && (
                        <div className="text-center space-y-1 p-1.5 bg-blue-50 rounded">
                            <div className="font-medium text-blue-600 text-xs">{statusText}</div>
                            <div className="text-xs font-mono tracking-wider">{durationText}</div>
                            {isRecording && (
                                <div className="flex items-center justify-center gap-1 text-red-600 text-xs">
                                    <CircleDot className="h-3 w-3 animate-pulse" />
                                    <span>Đang ghi âm…</span>
                                </div>
                            )}
                        </div>
                    )}


                </CardContent>
            </Card>

            {/* Call History */}
            <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <CardHeader className="pb-1 flex-shrink-0">
                    <CardTitle className="flex items-center justify-between text-sm">
                        <span>Lịch sử cuộc gọi (giữa bạn và khách này)</span>
                        <Button
                            onClick={forceReloadHistory}
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1 text-xs h-5"
                        >
                            <Loader2 className="h-3 w-3" />
                            Tải lại
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                        </div>
                    ) : callHistory.length > 0 ? (
                        <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0 max-h-full">
                            {callHistory.map((call, index) => (
                                <div key={call._id} className="bg-gray-50 border border-gray-200 rounded p-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`px-1 py-0.5 rounded-full text-xs font-medium ${
                                            call.status === 'completed' ? 'bg-green-100 text-green-800' :
                                            call.status === 'failed' ? 'bg-red-100 text-red-800' :
                                            call.status === 'busy' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {getCallStatusText(call.status)}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            {new Date(call.createdAt).toLocaleString('vi-VN')}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-600 mb-1">
                                        NV: {call.userName || 'Admin'} • Trạng thái: {call.status} • Thời lượng: {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : '00:00'}
                                    </div>
                                    <RecordingPlayer 
                                        callId={call._id} 
                                        className="w-full"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
                            Chưa có lịch sử cuộc gọi
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {/* Hidden audio element for OMI Call SDK */}
            <audio ref={remoteAudioRef} playsInline style={{ display: 'none' }} />
        </div>
        </>
    );
}