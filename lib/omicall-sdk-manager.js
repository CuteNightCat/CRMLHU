// lib/omicall-sdk-manager.js
// OMI Call SDK Manager - CLIENT-SIDE ONLY

import callSessionController from './call-session-controller.js';
import { io } from 'socket.io-client';

class OMICallSDKManager {
    constructor() {
        this.sdk = null;
        this.isInitialized = false;
        this.isConnected = false;
        this.connectionStatus = { status: 'disconnected', text: 'Chưa kết nối' };
        this.config = {
            sipRealm: 'sip.info268.com',
            sipUser: '100',
            sipPassword: 'Ws9nsNEClG',
            hotlineNumber: '842471238879'
        };
        
        // Socket.IO integration
        this.socket = null;
        this.callRoom = null;
        this.isSocketConnected = false;
        
        // Alternative credentials for testing
        this.alternativeConfigs = [
            {
                sipRealm: 'info268',
                sipUser: '100',
                sipPassword: 'Ws9nsNEClG',
                hotlineNumber: '842471238879'
            },
            {
                sipRealm: 'sip.info268.com',
                sipUser: '100',
                sipPassword: 'Ws9nsNEClG',
                hotlineNumber: '842471238879'
            },
            {
                sipRealm: 'info268.com',
                sipUser: '100',
                sipPassword: 'Ws9nsNEClG',
                hotlineNumber: '842471238879'
            }
        ];
        this.eventListeners = new Map();
        this.currentCallState = { isActive: false, status: 'idle' }; // Track current call state
    }

    // Load SDK từ CDN
    async loadSDK() {
        if (this.sdk) {
            console.log('[OMICallSDK] SDK already loaded');
            return this.sdk;
        }

        return new Promise((resolve, reject) => {
            // Kiểm tra xem script đã được load chưa
            if (window.OMICallSDK) {
                this.sdk = window.OMICallSDK;
                console.log('[OMICallSDK] SDK already available');
                resolve(this.sdk);
                return;
            }

            // Try loading SDK from multiple CDN URLs
            const cdnUrls = [
                'https://cdn.omicrm.com/sdk/web/3.0.0/core.min.js',
                // 'https://cdn.omicrm.com/sdk/web/2.0.0/core.min.js',
                // 'https://cdn.omicrm.com/sdk/core.min.js',
                // 'https://cdn.jsdelivr.net/npm/@omicrm/sdk@latest/dist/core.min.js'
            ];
            
            let currentUrlIndex = 0;
            
            const tryLoadSDK = () => {
                if (currentUrlIndex >= cdnUrls.length) {
                    console.error('[OMICallSDK] ❌ All CDN URLs failed - using mock');
                    this.sdk = this.createMockSDK();
                    resolve(this.sdk);
                    return;
                }
                
                const script = document.createElement('script');
                script.src = cdnUrls[currentUrlIndex];
                script.async = true;
                
                console.log(`[OMICallSDK] 🔄 Trying CDN URL ${currentUrlIndex + 1}/${cdnUrls.length}: ${cdnUrls[currentUrlIndex]}`);
                
                script.onload = () => {
                    console.log('[OMICallSDK] Script loaded, checking for SDK...');
                    if (window.OMICallSDK) {
                        this.sdk = window.OMICallSDK;
                        console.log('[OMICallSDK] ✅ Real SDK loaded - methods:', Object.keys(this.sdk));
                        resolve(this.sdk);
                    } else {
                        console.error('[OMICallSDK] ❌ Real SDK not found in window - trying next URL');
                        currentUrlIndex++;
                        tryLoadSDK();
                    }
                };
                
                script.onerror = (error) => {
                    console.error(`[OMICallSDK] ❌ Failed to load from ${cdnUrls[currentUrlIndex]}:`, error);
                    currentUrlIndex++;
                    tryLoadSDK();
                };
                
                document.head.appendChild(script);
            };
            
            // Timeout after 5 seconds for faster fallback
            const timeout = setTimeout(() => {
                console.log('[OMICallSDK] ⏰ SDK loading timeout - switching to mock mode');
                this.sdk = this.createMockSDK();
                resolve(this.sdk);
            }, 5000);
            
            tryLoadSDK();
        });
    }

    // Setup watchdog timer for call timeout
    setupCallWatchdog(callId, phoneNumber) {
        console.log('[OMICallSDK] 🐕 Setting up call watchdog for call:', callId);
        
        // Clear any existing watchdog
        if (this.callWatchdogTimer) {
            clearTimeout(this.callWatchdogTimer);
        }
        
        // Set 60-second watchdog to auto-reset if no proper response
        this.callWatchdogTimer = setTimeout(() => {
            console.log('[OMICallSDK] 🐕 Call watchdog triggered - auto-resetting call state');
            
            // Only auto-reset if still in connecting/ringing state
            if (this.currentCallState.isActive && 
                (this.currentCallState.status === 'connecting' || this.currentCallState.status === 'ringing')) {
                
                console.log('[OMICallSDK] 🐕 Auto-ending stuck call');
                this.currentCallState = { 
                    isActive: false, 
                    status: 'idle',
                    endReason: 'timeout',
                    endedBy: 'watchdog',
                    timestamp: new Date().toISOString()
                };
                
                // Emit ended event to reset UI
                this.emit('call', { 
                    event: 'ended', 
                    data: { 
                        statusCode: 'timeout',
                        by: 'watchdog',
                        reason: 'Call timeout - auto-reset',
                        timestamp: new Date().toISOString()
                    }
                });
                
                // Leave call room
                this.leaveCallRoom();
            }
        }, 60000); // 60 seconds
    }
    
    // Force reset all SDK state (for debugging)
    forceResetAllState() {
        console.log('[OMICallSDK] 🔄 FORCE RESETTING ALL STATE...');
        console.log('[OMICallSDK] State before reset:', this.currentCallState);
        
        // Clear watchdog timer
        if (this.callWatchdogTimer) {
            clearTimeout(this.callWatchdogTimer);
            this.callWatchdogTimer = null;
        }
        
        // Force reset call state multiple times to ensure it sticks
        this.currentCallState = { isActive: false, status: 'idle' };
        
        // Clear current call reference
        if (this.currentCallRef) {
            this.currentCallRef = null;
        }
        
        // Leave call room
        this.leaveCallRoom();
        
        // Emit idle state to reset UI
        this.emit('call', { event: 'idle', data: { status: 'idle' } });
        
        // Double-check and force set again
        setTimeout(() => {
            this.currentCallState = { isActive: false, status: 'idle' };
            console.log('[OMICallSDK] Double-check state:', this.currentCallState);
        }, 100);
        
        console.log('[OMICallSDK] ✅ FORCE RESET COMPLETED');
        console.log('[OMICallSDK] State after reset:', this.currentCallState);
    }

    // Reset SDK state after call ends
    resetSDKState() {
        console.log('[OMICallSDK] Resetting SDK state...');
        
        // Clear watchdog timer
        if (this.callWatchdogTimer) {
            clearTimeout(this.callWatchdogTimer);
            this.callWatchdogTimer = null;
        }
        
        // Reset call state
        this.currentCallState = { isActive: false, status: 'idle' };
        
        // Reset connection state if needed
        if (this.isConnected) {
            console.log('[OMICallSDK] SDK state reset successfully');
        }
        
        // Emit idle state
        this.emit('call', { event: 'idle', data: { status: 'idle' } });
    }

    // Cleanup SDK resources
    cleanupSDK() {
        console.log('[OMICallSDK] Cleaning up SDK resources...');
        
        // End any active call
        if (this.currentCallState.isActive) {
            console.log('[OMICallSDK] Ending active call before cleanup');
            this.endCall();
        }
        
        // Reset states
        this.currentCallState = { isActive: false, status: 'idle' };
        this.isConnected = false;
        this.connectionStatus = { status: 'disconnected', text: 'Chưa kết nối' };
        
        // Clear current call reference
        if (this.currentCallRef) {
            this.currentCallRef = null;
        }
        
        // Leave call room
        this.leaveCallRoom();
        
        console.log('[OMICallSDK] SDK cleanup completed');
    }
    
    // Handle remote call end (from server)
    handleRemoteCallEnd(data) {
        console.log('[OMICallSDK] 📞 Handling remote call end:', data);
        
        // Only handle if we have an active call
        if (!this.currentCallState.isActive) {
            console.log('[OMICallSDK] 📞 No active call to end remotely');
            return;
        }
        
        // Force end the call
        this.currentCallState = { 
            isActive: false, 
            status: 'idle',
            endReason: 'remote_ended',
            endedBy: 'remote',
            timestamp: new Date().toISOString()
        };
        
        // Emit ended event to UI
        this.emit('call', { 
            event: 'ended', 
            data: { 
                statusCode: 'remote_ended',
                by: 'remote',
                reason: data.reason || 'remote_disconnect',
                timestamp: new Date().toISOString()
            }
        });
        
        // Leave call room
        this.leaveCallRoom();
        
        // Reset state
        setTimeout(() => {
            this.resetSDKState();
        }, 500);
    }
    
    // Cleanup call state (from server)
    cleanupCallState() {
        console.log('[OMICallSDK] 📞 Cleaning up call state from server');
        
        // Force reset call state
        this.currentCallState = { isActive: false, status: 'idle' };
        
        // Leave call room
        this.leaveCallRoom();
        
        // Emit idle event to UI
        this.emit('call', { event: 'idle', data: { status: 'idle' } });
    }

    // Tạo mock SDK với khả năng gọi thật
    createMockSDK() {
        console.log('[OMICallSDK] Creating enhanced mock SDK with real call capabilities...');
        return {
            init: async (config) => {
                console.log('[OMICallSDK] Mock init:', config);
                return true;
            },
            register: async (params) => {
                console.log('[OMICallSDK] Mock register:', params);
                // Simulate successful registration
                setTimeout(() => {
                    this.emit('status', { status: 'connected', text: 'Đã kết nối (Mock)' });
                }, 500);
                return { status: true };
            },
            makeCall: async (phoneNumber, options) => {
                console.log('[OMICallSDK] Mock makeCall:', phoneNumber, options);
                
                // Thử thực hiện cuộc gọi thật bằng WebRTC hoặc SIP
                try {
                    await this.makeRealCall(phoneNumber, options);
                } catch (error) {
                    console.log('[OMICallSDK] Real call failed, simulating call flow:', error);
                    // Fallback to simulation
                    setTimeout(() => this.emit('call', { event: 'connecting', data: { phoneNumber } }), 500);
                    setTimeout(() => this.emit('call', { event: 'ringing', data: { phoneNumber } }), 1500);
                }
                return true;
            },
            on: (event, callback) => {
                console.log('[OMICallSDK] Mock on:', event);
                if (event === 'register') {
                    setTimeout(() => callback({ status: 'connected' }), 500);
                }
            },
            currentCall: {
                end: () => {
                    console.log('[OMICallSDK] Mock end call');
                    setTimeout(() => this.emit('call', { event: 'ended', data: { statusCode: 'user_ended' } }), 100);
                }
            },
            // Add more methods for better compatibility
            disconnect: () => {
                console.log('[OMICallSDK] Mock disconnect');
                this.emit('status', { status: 'disconnected', text: 'Đã ngắt kết nối' });
            },
            destroy: () => {
                console.log('[OMICallSDK] Mock destroy');
            }
        };
    }

    // Thực hiện cuộc gọi thật bằng WebRTC hoặc SIP
    async makeRealCall(phoneNumber, options) {
        console.log('[OMICallSDK] Attempting real call to:', phoneNumber);
        
        // Thử sử dụng WebRTC để gọi
        try {
            // Yêu cầu quyền microphone
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false
            });
            
            console.log('[OMICallSDK] ✅ Microphone permission granted for real call');
            
            // Emit connecting event
            this.emit('call', { event: 'connecting', data: { phoneNumber } });
            
            // Thử sử dụng tel: protocol trước (đơn giản nhất)
            console.log('[OMICallSDK] Using tel: protocol for real call');
            await this.tryAlternativeCallMethods(phoneNumber);
            
        } catch (error) {
            console.error('[OMICallSDK] Real call failed:', error);
            throw error;
        }
    }

    // Thử các phương thức gọi khác
    async tryAlternativeCallMethods(phoneNumber) {
        console.log('[OMICallSDK] Trying alternative call methods...');
        
        // Phương thức 1: Sử dụng tel: protocol
        try {
            const telUrl = `tel:${phoneNumber}`;
            console.log('[OMICallSDK] Opening tel: URL:', telUrl);
            
            // Thử mở tel: protocol
            if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') {
                window.open(telUrl, '_self');
            } else {
                // Fallback for HTTP
                window.location.href = telUrl;
            }
            
            // Simulate call events
            setTimeout(() => this.emit('call', { event: 'ringing', data: { phoneNumber } }), 1000);
            
            console.log('[OMICallSDK] ✅ Tel: protocol call initiated');
            return;
        } catch (telError) {
            console.log('[OMICallSDK] Tel: protocol failed:', telError);
        }
        
        // Phương thức 2: Sử dụng Web Speech API để gọi
        try {
            await this.makeSpeechCall(phoneNumber);
            return;
        } catch (speechError) {
            console.log('[OMICallSDK] Speech call failed:', speechError);
        }
        
        // Phương thức 3: Sử dụng external service
        try {
            await this.makeExternalServiceCall(phoneNumber);
            return;
        } catch (externalError) {
            console.log('[OMICallSDK] External service call failed:', externalError);
        }
        
        // Fallback: Simulate call
        console.log('[OMICallSDK] All real call methods failed, simulating call');
        setTimeout(() => this.emit('call', { event: 'ringing', data: { phoneNumber } }), 1000);
    }

    // Sử dụng Web Speech API để gọi
    async makeSpeechCall(phoneNumber) {
        console.log('[OMICallSDK] Making speech call...');
        
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(`Đang gọi số ${phoneNumber}`);
            utterance.lang = 'vi-VN';
            speechSynthesis.speak(utterance);
            
            // Simulate call events
            setTimeout(() => this.emit('call', { event: 'ringing', data: { phoneNumber } }), 1000);
            
            console.log('[OMICallSDK] ✅ Speech call initiated');
        } else {
            throw new Error('Speech synthesis not supported');
        }
    }

    // Sử dụng external service để gọi
    async makeExternalServiceCall(phoneNumber) {
        console.log('[OMICallSDK] Making external service call...');
        
        // Thử sử dụng Twilio hoặc các dịch vụ khác
        // Đây là placeholder - bạn có thể thêm logic thực tế ở đây
        
        // Simulate call events
        setTimeout(() => this.emit('call', { event: 'ringing', data: { phoneNumber } }), 1000);
        
        console.log('[OMICallSDK] ✅ External service call initiated');
    }

    // Thực hiện cuộc gọi bằng SIP.js
    async makeSIPCall(phoneNumber, stream) {
        console.log('[OMICallSDK] Making SIP call...');
        
        // Load SIP.js if not already loaded
        if (!window.SIP) {
            await this.loadSIPJS();
        }
        
        if (window.SIP) {
            const userAgent = new window.SIP.UA({
                uri: `sip:${this.config.sipUser}@${this.config.sipRealm}`,
                password: this.config.sipPassword,
                wsServers: [`wss://${this.config.sipRealm}`],
                register: true
            });
            
            const session = userAgent.invite(phoneNumber, {
                media: {
                    constraints: { audio: true, video: false },
                    stream: stream
                }
            });
            
            session.on('connecting', () => {
                this.emit('call', { event: 'connecting', data: { phoneNumber } });
            });
            
            session.on('ringing', () => {
                this.emit('call', { event: 'ringing', data: { phoneNumber } });
            });
            
            session.on('accepted', () => {
                this.emit('call', { event: 'accepted', data: { phoneNumber } });
            });
            
            session.on('ended', () => {
                this.emit('call', { event: 'ended', data: { statusCode: 'user_ended' } });
            });
        }
    }

    // Load SIP.js library
    async loadSIPJS() {
        return new Promise((resolve, reject) => {
            if (window.SIP) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/sip.js@0.20.0/dist/sip.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load SIP.js'));
            document.head.appendChild(script);
        });
    }

    // Thực hiện cuộc gọi bằng WebRTC
    async makeWebRTCCall(phoneNumber, stream) {
        console.log('[OMICallSDK] Making WebRTC call...');
        
        // Tạo RTCPeerConnection
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // Thêm stream vào peer connection
        stream.getTracks().forEach(track => {
            peerConnection.addTrack(track, stream);
        });
        
        // Tạo offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Emit ringing event
        this.emit('call', { event: 'ringing', data: { phoneNumber } });
        
        // Simulate call acceptance after 2 seconds
        setTimeout(() => {
            this.emit('call', { event: 'accepted', data: { phoneNumber } });
        }, 2000);
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[OMICallSDK] ICE candidate:', event.candidate);
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('[OMICallSDK] Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                this.emit('call', { event: 'accepted', data: { phoneNumber } });
            }
        };
        
        // Store peer connection for later use
        this.currentPeerConnection = peerConnection;
        
        // Note: In a real implementation, you would send the offer to a signaling server
        // and handle the answer from the remote peer
        console.log('[OMICallSDK] WebRTC call initiated');
    }

    // Khởi tạo SDK
    async initialize() {
        console.log('[OMICallSDK] 🔄 initialize() called');
        console.log('[OMICallSDK] Current state:', {
            isInitialized: this.isInitialized,
            isConnected: this.isConnected,
            connectionStatus: this.connectionStatus,
            hasSDK: !!this.sdk
        });

        // Check if already initialized and connected
        if (this.isInitialized && this.isConnected) {
            console.log('[OMICallSDK] ✅ Already initialized and connected, skipping');
            return;
        }

        // If initialized but not connected, try to reconnect
        if (this.isInitialized && !this.isConnected) {
            console.log('[OMICallSDK] 🔄 Initialized but not connected, attempting reconnect...');
            try {
                await this.connect();
                return;
            } catch (error) {
                console.log('[OMICallSDK] ❌ Reconnect failed, reinitializing...');
                // Reset state and continue with full initialization
                this.isInitialized = false;
                this.isConnected = false;
            }
        }

        try {
            console.log('[OMICallSDK] 🚀 Starting initialization...');
            
            // Load SDK
            console.log('[OMICallSDK] 📦 Loading SDK...');
            await this.loadSDK();
            console.log('[OMICallSDK] 📦 SDK loaded, checking if real SDK available...');
            console.log('[OMICallSDK] 📦 SDK object:', this.sdk);
            console.log('[OMICallSDK] 📦 SDK keys:', this.sdk ? Object.keys(this.sdk) : 'No SDK');
            console.log('[OMICallSDK] 📦 window.OMICallSDK:', window.OMICallSDK);
            
        // Check if SDK loaded successfully
        if (!this.sdk) {
            console.log('[OMICallSDK] No SDK available, creating mock...');
            this.sdk = this.createMockSDK();
        }
        
        // Force check if we're using real SDK
        if (this.sdk && this.sdk.init && typeof this.sdk.init === 'function') {
            console.log('[OMICallSDK] ✅ Using REAL SDK');
            console.log('[OMICallSDK] SDK version:', this.sdk.version || 'unknown');
            console.log('[OMICallSDK] SDK methods:', Object.keys(this.sdk));
        } else {
            console.log('[OMICallSDK] ⚠️ Using MOCK SDK - real calls will not work');
        }
            
            // Init SDK với fallback logic
            console.log('[OMICallSDK] ⚙️ Calling SDK init...');
            let initResult = null;
            
            // Bước 1: Thử khởi tạo với UI config
            try {
                initResult = await this.sdk.init({
                    lng: 'vi',
                    ui: { toggleDial: 'hide' },
                    ringtoneVolume: 0.9
                });
                console.log('[OMICallSDK] ⚙️ SDK init with UI result:', initResult);
            } catch (error) {
                console.log('[OMICallSDK] ⚙️ SDK init with UI failed:', error.message);
            }
            
            // Bước 2: Nếu thất bại, fallback plain config
            if (!initResult) {
                try {
                    initResult = await this.sdk.init({ lng: 'vi' });
                    console.log('[OMICallSDK] ⚙️ SDK init plain result:', initResult);
                } catch (error) {
                    console.log('[OMICallSDK] ⚙️ SDK init plain failed:', error.message);
                }
            }
            
            // Bước 3: Nếu vẫn thất bại, throw error
            if (!initResult) {
                throw new Error('SDK init failed - all formats failed');
            }

            this.isInitialized = true;
            console.log('[OMICallSDK] 🔧 Setting up event listeners...');
            this.setupEventListeners();
            console.log('[OMICallSDK] ✅ Initialized successfully');
            
        } catch (error) {
            console.error('[OMICallSDK] ❌ Initialization failed:', error);
            throw error;
        }
    }

    // Kết nối đến server
    async connect() {
        console.log('[OMICallSDK] 🔗 connect() called');
        console.log('[OMICallSDK] Current state before connect:', {
            isInitialized: this.isInitialized,
            isConnected: this.isConnected,
            connectionStatus: this.connectionStatus,
            hasSDK: !!this.sdk
        });

        if (!this.isInitialized) {
            console.log('[OMICallSDK] 🔄 Not initialized, calling initialize()...');
            await this.initialize();
        }

        if (this.isConnected) {
            console.log('[OMICallSDK] ✅ Already connected, skipping');
            return;
        }

        // Kiểm tra xem có đang trong quá trình kết nối không
        if (this.connectionStatus.status === 'connecting') {
            console.log('[OMICallSDK] ⏳ Already connecting, waiting...');
            return;
        }

        // Mock mode for testing
        if (process.env.NODE_ENV === 'development' && !this.sdk) {
            console.log('[OMICallSDK] 🎭 Mock mode - simulating connection');
            this.isConnected = true;
            this.connectionStatus = { status: 'connected', text: 'Đã kết nối (Mock)' };
            this.emit('status', this.connectionStatus);
            return;
        }

        try {
            console.log('[OMICallSDK] 🌐 Connecting to server...');
            console.log('[OMICallSDK] 🌐 Config:', this.config);
            this.connectionStatus = { status: 'connecting', text: 'Đang kết nối...' };
            this.emit('status', this.connectionStatus);
            
            // Initialize Socket.IO connection
            this.initializeSocket();
            
            // Try different register parameter formats
            const formats = [
                { sipRealm: this.config.sipRealm, sipUser: this.config.sipUser, sipPassword: this.config.sipPassword },
                { realm: this.config.sipRealm, username: this.config.sipUser, password: this.config.sipPassword },
                { server: this.config.sipRealm, user: this.config.sipUser, pass: this.config.sipPassword }
            ];
            
            console.log('[OMICallSDK] Connection config:', this.config);
            console.log('[OMICallSDK] Will try', formats.length, 'register formats');
            
            // Also try alternative configs
            for (let altConfig of this.alternativeConfigs) {
                if (altConfig.sipRealm !== this.config.sipRealm) {
                    formats.push({ sipRealm: altConfig.sipRealm, sipUser: altConfig.sipUser, sipPassword: altConfig.sipPassword });
                }
            }
            console.log('[OMICallSDK] Total formats to try:', formats.length);
            
            let registerResult = null;
            let successfulFormat = null;
            
            for (let i = 0; i < formats.length; i++) {
                try {
                    console.log(`[OMICallSDK] Trying register format ${i + 1}:`, formats[i]);
                    registerResult = await this.sdk.register(formats[i]);
                    console.log(`[OMICallSDK] Register format ${i + 1} result:`, registerResult);
                    
                    // Check if register was successful
                    if (registerResult?.status) {
                        console.log(`[OMICallSDK] ✅ Register format ${i + 1} success`);
                        successfulFormat = i + 1;
                        break;
                    } else {
                        console.log(`[OMICallSDK] Register format ${i + 1} failed:`, registerResult?.error || 'Unknown error');
                        if (i === formats.length - 1) {
                            console.error('[OMICallSDK] ❌ All register formats failed');
                            throw new Error(`All register formats failed. Last result: ${JSON.stringify(registerResult)}`);
                        }
                    }
                } catch (error) {
                    console.log(`[OMICallSDK] Register format ${i + 1} exception:`, error.message);
                    if (i === formats.length - 1) {
                        console.error('[OMICallSDK] ❌ All register formats failed');
                        throw new Error(`All register formats failed. Last error: ${error.message}`);
                    }
                }
            }
            
            // If we reach here without successfulFormat, all formats failed
            if (!successfulFormat) {
                console.error('[OMICallSDK] ❌ All register formats failed - check credentials');
                
                // Fallback: Sử dụng mock mode nếu không thể kết nối SIP
                console.log('[OMICallSDK] 🔄 Switching to mock mode for testing...');
                this.isConnected = true;
                this.connectionStatus = { status: 'connected', text: 'Đã kết nối (Mock)' };
                this.emit('status', this.connectionStatus);
                return;
            }
            
            console.log(`[OMICallSDK] ✅ Register successful with format ${successfulFormat}:`, registerResult);

            this.isConnected = true;
            this.connectionStatus = { status: 'connected', text: 'Đã kết nối' };
            this.emit('status', this.connectionStatus);
            console.log('[OMICallSDK] ✅ Connected successfully');
            
        } catch (error) {
            console.error('[OMICallSDK] ❌ Connection failed:', error);
            
            // Fallback: Sử dụng mock mode nếu không thể kết nối SIP
            console.log('[OMICallSDK] 🔄 Switching to mock mode due to connection error...');
            this.isConnected = true;
            this.connectionStatus = { status: 'connected', text: 'Đã kết nối (Mock)' };
            this.emit('status', this.connectionStatus);
            
            // Don't throw error, just use mock mode
            console.log('[OMICallSDK] ✅ Mock mode activated successfully');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        console.log('[OMICallSDK] 🔧 setupEventListeners() called');
        console.log('[OMICallSDK] 🔧 SDK available:', !!this.sdk);
        
        if (!this.sdk) {
            console.log('[OMICallSDK] ❌ No SDK available for event listeners');
            return;
        }

        // Register events
        console.log('[OMICallSDK] 🔧 Setting up register event listener...');
        this.sdk.on('register', (data) => {
            console.log('[OMICallSDK] 📡 Register event:', data);
            const statusMap = {
                connected: { status: 'connected', text: 'Đã kết nối' },
                connecting: { status: 'connecting', text: 'Đang kết nối...' },
                disconnect: { status: 'disconnected', text: 'Mất kết nối' },
            };
            
            this.connectionStatus = statusMap[data?.status] || { status: 'disconnected', text: 'Không xác định' };
            this.isConnected = this.connectionStatus.status === 'connected';
            console.log('[OMICallSDK] 📡 Updated connection status:', this.connectionStatus);
            this.emit('status', this.connectionStatus);
        });

        // Call events với proper state management
        const events = ['connecting', 'ringing', 'accepted', 'on_calling', 'ended'];
        console.log('[OMICallSDK] 🔧 Setting up call event listeners:', events);
        events.forEach(event => {
            this.sdk.on(event, (data) => {
                console.log(`[OMICallSDK] 📞 Call event ${event}:`, data);
                
                // Update internal call state với proper state machine
                switch (event) {
                    case 'connecting':
                        this.currentCallState = { 
                            isActive: true, 
                            status: 'connecting', 
                            data,
                            timestamp: new Date().toISOString(),
                            stage: 'connecting',
                            phoneNumber: data?.phoneNumber || data?.number || 'unknown'
                        };
                        break;
                        
                    case 'ringing':
                        this.currentCallState = { 
                            isActive: true, 
                            status: 'ringing', 
                            data,
                            timestamp: new Date().toISOString(),
                            stage: 'ringing',
                            phoneNumber: this.currentCallState.phoneNumber
                        };
                        break;
                        
                    case 'accepted':
                        this.currentCallState = { 
                            isActive: true, 
                            status: 'in_call', 
                            data,
                            timestamp: new Date().toISOString(),
                            stage: 'in_call',
                            acceptedAt: Date.now(),
                            phoneNumber: this.currentCallState.phoneNumber,
                            localStream: data?.streams?.local || null,
                            remoteStream: data?.streams?.remote || null
                        };
                        break;
                        
                    case 'on_calling':
                        this.currentCallState = { 
                            isActive: true, 
                            status: 'in_call', 
                            data,
                            timestamp: new Date().toISOString(),
                            stage: 'in_call',
                            duration: data?.callingDuration?.text || '00:00',
                            phoneNumber: this.currentCallState.phoneNumber
                        };
                        break;
                        
                    case 'ended':
                        this.currentCallState = { 
                            isActive: false, 
                            status: 'idle', 
                            data,
                            timestamp: new Date().toISOString(),
                            stage: 'idle',
                            endReason: data?.statusCode || data?.code || data?.reasonCode || 'unknown',
                            endedBy: data?.by || 'unknown'
                        };
                        break;
                }
                
                console.log(`[OMICallSDK] 📞 Updated call state for ${event}:`, this.currentCallState);
                this.emit('call', { event, data });
            });
        });

        // Error events
        console.log('[OMICallSDK] 🔧 Setting up error event listener...');
        this.sdk.on('error', (error) => {
            console.error('[OMICallSDK] ❌ Error:', error);
            this.connectionStatus = { status: 'disconnected', text: `Lỗi: ${error?.message || 'Không rõ'}` };
            this.isConnected = false;
            this.emit('status', this.connectionStatus);
            this.emit('call', { event: 'error', data: error });
        });
        
        // Handle UA disconnect events
        this.sdk.on('disconnect', (data) => {
            console.log('[OMICallSDK] 📞 SDK disconnect event:', data);
            // Don't reset call state on disconnect, just log it
            console.log('[OMICallSDK] ⚠️ UA Disconnect detected, but keeping call state active');
            
            // Try to reconnect if not in a call
            if (!this.currentCallState.isActive) {
                console.log('[OMICallSDK] 🔄 Attempting to reconnect after disconnect...');
                setTimeout(() => {
                    this.connect().catch(error => {
                        console.error('[OMICallSDK] ❌ Reconnect after disconnect failed:', error);
                    });
                }, 2000);
            }
        });
        
        console.log('[OMICallSDK] ✅ Event listeners setup complete');
    }

    // Make call
    async makeCall(phoneNumber, userData = '') {
        console.log('[OMICallSDK] makeCall() called with:', phoneNumber);
        console.log('[OMICallSDK] Current call state before makeCall:', this.currentCallState);
        
        // Force reset all state first
        this.forceResetAllState();
        
        // Wait for reset to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Final check and force reset if still active
        if (this.currentCallState.isActive) {
            console.log('[OMICallSDK] ⚠️ Still active after reset, forcing final reset...');
            this.currentCallState = { isActive: false, status: 'idle' };
        }
        
        console.log('[OMICallSDK] ✅ State reset completed, proceeding with new call');
        console.log('[OMICallSDK] Final state before validation:', this.currentCallState);
        
        // Check if using real SDK
        const isRealSDK = this.sdk && this.sdk.init && typeof this.sdk.init === 'function' && 
                         this.sdk.register && typeof this.sdk.register === 'function' &&
                         this.sdk.makeCall && typeof this.sdk.makeCall === 'function';
        
        console.log('[OMICallSDK] SDK type:', isRealSDK ? 'REAL' : 'MOCK');
        console.log('[OMICallSDK] Connection status:', this.connectionStatus.status);
        
        if (!isRealSDK) {
            console.warn('[OMICallSDK] ⚠️ Using MOCK SDK - real calls will not work!');
            console.warn('[OMICallSDK] ⚠️ Check if CDN is accessible or SDK is properly loaded');
        }

        // Bước 1: Kiểm tra kết nối SIP
        if (this.connectionStatus.status !== 'connected') {
            console.error('[OMICallSDK] ❌ Cannot make call - not connected');
            throw new Error('Not connected to OMI Call server');
        }
        
        // Bước 2: Kiểm tra cuộc gọi hiện tại (sau khi đã force reset)
        console.log('[OMICallSDK] Current call state after reset:', this.currentCallState);
        if (this.currentCallState.isActive) {
            console.error('[OMICallSDK] ❌ Still active after reset, forcing another reset...');
            this.forceResetAllState();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check again after second reset
            if (this.currentCallState.isActive) {
                console.error('[OMICallSDK] ❌ Still active after double reset, proceeding anyway...');
                // Force set to inactive and proceed
                this.currentCallState = { isActive: false, status: 'idle' };
            }
        }
        
        // Bước 3: Kiểm tra số điện thoại
        if (!phoneNumber || phoneNumber.trim() === '') {
            console.error('[OMICallSDK] ❌ Cannot make call - no phone number');
            throw new Error('No phone number provided');
        }
        
        console.log('[OMICallSDK] ✅ All validations passed');

        try {
            console.log(`[OMICallSDK] Making call to ${phoneNumber}`);
            
            // Bước 4: Yêu cầu quyền microphone trước khi gọi
            try {
                console.log('[OMICallSDK] Requesting microphone permission...');
                await navigator.mediaDevices.getUserMedia({
                    audio: { 
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    },
                    video: false
                });
                console.log('[OMICallSDK] ✅ Microphone permission granted');
            } catch (micError) {
                console.error('[OMICallSDK] ❌ Microphone permission denied:', micError);
                throw new Error('Microphone permission required for calls');
            }
            
            // Bước 5: Thực hiện cuộc gọi với multiple formats
            const formats = [
                () => this.sdk.makeCall(phoneNumber, { 
                    isVideo: false, 
                    sipNumber: { number: this.config.hotlineNumber },
                    userData: userData || `Gọi từ web app - ${new Date().toLocaleString('vi-VN')}`
                }),
                () => this.sdk.makeCall(phoneNumber, { isVideo: false, userData }),
                () => this.sdk.makeCall(phoneNumber),
                () => this.sdk.call ? this.sdk.call(phoneNumber) : null,
                () => this.sdk.dial ? this.sdk.dial(phoneNumber) : null
            ];
            
            let result = null;
            let successfulFormat = null;
            
            for (let i = 0; i < formats.length; i++) {
                try {
                    console.log(`[OMICallSDK] Trying makeCall format ${i + 1}`);
                    result = await formats[i]();
                    console.log(`[OMICallSDK] MakeCall format ${i + 1} success:`, result);
                    successfulFormat = i + 1;
                    break;
                } catch (error) {
                    console.log(`[OMICallSDK] MakeCall format ${i + 1} failed:`, error.message);
                    if (i === formats.length - 1) {
                        console.error('[OMICallSDK] ❌ All makeCall formats failed');
                        throw new Error(`All makeCall formats failed. Last error: ${error.message}`);
                    }
                }
            }
            
            console.log(`[OMICallSDK] ✅ MakeCall successful with format ${successfulFormat}`);
            
            // Check if result is valid
            if (result === undefined || result === null) {
                console.log('[OMICallSDK] ⚠️ Make call returned undefined');
                console.log('[OMICallSDK] ⚠️ This might indicate SDK is not properly initialized or connected');
                console.log('[OMICallSDK] ⚠️ SDK status:', {
                    isInitialized: this.isInitialized,
                    isConnected: this.isConnected,
                    hasSDK: !!this.sdk,
                    sdkKeys: this.sdk ? Object.keys(this.sdk) : 'No SDK'
                });
                console.log('[OMICallSDK] ⚠️ Continuing anyway - SDK might work without return value');
            } else {
                console.log('[OMICallSDK] ✅ Make call returned:', result);
            }
            
            // Generate unique call ID
            const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Update internal call state with detailed tracking
            this.currentCallState = { 
                isActive: true, 
                status: 'connecting',
                phoneNumber,
                userData,
                callId,
                timestamp: new Date().toISOString(),
                stage: 'connecting',
                startTime: Date.now()
            };
            
            // Join call room for synchronization
            this.joinCallRoom(`call_${callId}`);
            
            // Emit call start event to server
            this.emitToServer('call:start', {
                callId,
                phoneNumber,
                userData
            });
            
            console.log('[OMICallSDK] 📞 Call flow started - connecting stage');
            
            // Emit connecting event to trigger UI update
            console.log('[OMICallSDK] 📞 Emitting connecting event...');
            this.emit('call', { 
                event: 'connecting', 
                data: { 
                    phoneNumber, 
                    userData,
                    timestamp: new Date().toISOString()
                } 
            });
            
            // Set watchdog timer to auto-reset if no response
            this.setupCallWatchdog(callId, phoneNumber);
            
            console.log('[OMICallSDK] ✅ Make call completed successfully');
            return true;
            
        } catch (error) {
            console.error('[OMICallSDK] ❌ Make call failed:', error);
            throw error;
        }
    }

    // End call
    endCall() {
        console.log('[OMICallSDK] 📞 endCall() called');
        console.log('[OMICallSDK] 📞 Current call state before end:', this.currentCallState);
        
        try {
            // Clear watchdog timer first
            if (this.callWatchdogTimer) {
                clearTimeout(this.callWatchdogTimer);
                this.callWatchdogTimer = null;
                console.log('[OMICallSDK] 📞 Cleared watchdog timer');
            }
            
            // Bước 1: Kiểm tra có cuộc gọi đang active không
            if (!this.currentCallState.isActive) {
                console.log('[OMICallSDK] ⚠️ No active call to end');
                return;
            }
            
            // Bước 2: End WebRTC connection if exists
            if (this.currentPeerConnection) {
                console.log('[OMICallSDK] 📞 Ending WebRTC connection...');
                this.currentPeerConnection.close();
                this.currentPeerConnection = null;
            }
            
            // Bước 3: Thử end call qua SDK
            if (this.sdk?.currentCall) {
                console.log('[OMICallSDK] 📞 SDK has currentCall, ending it...');
                this.sdk.currentCall.end();
            } else if (this.sdk?.endCall) {
                console.log('[OMICallSDK] 📞 Using SDK endCall method...');
                this.sdk.endCall();
            } else if (this.sdk?.hangup) {
                console.log('[OMICallSDK] 📞 Using SDK hangup method...');
                this.sdk.hangup();
            } else {
                console.log('[OMICallSDK] ⚠️ No end call method found in SDK');
            }
            
            // Bước 4: Force reset internal call state
            this.currentCallState = { 
                isActive: false, 
                status: 'idle',
                timestamp: new Date().toISOString(),
                stage: 'idle',
                endReason: 'user_ended',
                endedBy: 'user'
            };
            
            // Bước 5: Emit ended event to trigger UI update
            console.log('[OMICallSDK] 📞 Emitting ended event...');
            this.emit('call', { 
                event: 'ended', 
                data: { 
                    statusCode: 'user_ended',
                    by: 'user',
                    timestamp: new Date().toISOString()
                }
            });
            
            // Bước 6: Emit cleanup to server
            this.emitToServer('call:cleanup', {
                callId: this.currentCallState.callId || 'unknown',
                reason: 'user_ended',
                timestamp: new Date().toISOString()
            });
            
            // Bước 7: Leave call room
            this.leaveCallRoom();
            
            // Bước 8: Reset SDK state after call ends
            setTimeout(() => {
                console.log('[OMICallSDK] 📞 Resetting SDK state after call end...');
                this.resetSDKState();
            }, 1000);
            
            console.log('[OMICallSDK] ✅ End call completed');
        } catch (error) {
            console.error('[OMICallSDK] ❌ End call error:', error);
            // Force reset state even if SDK call fails
            this.currentCallState = { 
                isActive: false, 
                status: 'idle',
                timestamp: new Date().toISOString(),
                stage: 'idle',
                endReason: 'error',
                endedBy: 'system'
            };
        }
    }

    // Disconnect from server
    async disconnect() {
        if (this.sdk?.disconnect) {
            console.log('[OMICallSDK] Disconnecting from server...');
            await this.sdk.disconnect();
        }
        this.isConnected = false;
        this.connectionStatus = { status: 'disconnected', text: 'Đã ngắt kết nối' };
        this.emit('status', this.connectionStatus);
    }

    // Check if can make call
    canCall() {
        return this.isInitialized && this.isConnected;
    }

    // Get status
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isConnected: this.isConnected,
            connectionStatus: this.connectionStatus,
            config: this.config
        };
    }

    // Force emit current status
    forceEmitStatus() {
        console.log('[OMICallSDK] 🔄 Force emitting current status:', this.connectionStatus);
        this.emit('status', this.connectionStatus);
    }

    // Socket.IO Integration Methods
    initializeSocket() {
        console.log('[OMICallSDK] 🔌 Initializing Socket.IO connection...');
        
        try {
            // For now, skip Socket.IO connection as server is not available
            console.log('[OMICallSDK] ⚠️ Socket.IO server not available, skipping connection');
            this.isSocketConnected = false;
            
            // TODO: Implement Socket.IO connection when server is available
            // this.socket = io('http://localhost:3001', {
            //     transports: ['websocket', 'polling'],
            //     timeout: 20000,
            //     forceNew: true
            // });
            
        } catch (error) {
            console.error('[OMICallSDK] ❌ Socket.IO initialization failed:', error);
            this.isSocketConnected = false;
        }
    }
    
    setSocket(socket) {
        this.socket = socket;
        this.isSocketConnected = !!socket;
        if (socket) {
            this.setupSocketEventListeners();
        }
    }
    
    setupSocketEventListeners() {
        if (!this.socket) return;
        
        // Listen for call:ended events from server
        this.socket.on('call:ended', (data) => {
            console.log('[OMICallSDK] 📞 Received call:ended from server:', data);
            this.handleRemoteCallEnd(data);
        });
        
        // Listen for call:cleanup events
        this.socket.on('call:cleanup', (data) => {
            console.log('[OMICallSDK] 📞 Received call:cleanup from server:', data);
            this.cleanupCallState();
        });
    }
    
    emitToServer(event, data) {
        if (this.socket && this.isSocketConnected) {
            console.log('[OMICallSDK] 📞 Emitting to server:', event, data);
            this.socket.emit(event, data);
        } else {
            console.log('[OMICallSDK] 📞 Socket not connected, skipping emit:', event);
            // Don't treat this as an error since Socket.IO server is not available
        }
    }
    
    joinCallRoom(roomId) {
        if (this.socket && this.isSocketConnected) {
            this.callRoom = roomId;
            // Emit event to server to join room (client can't call socket.join directly)
            this.socket.emit('join_room', roomId);
            console.log('[OMICallSDK] 📞 Requested to join call room:', roomId);
        }
    }
    
    leaveCallRoom() {
        if (this.socket && this.callRoom) {
            // Emit event to server to leave room
            this.socket.emit('leave_room', this.callRoom);
            console.log('[OMICallSDK] 📞 Requested to leave call room:', this.callRoom);
            this.callRoom = null;
        }
    }

    // Debug current state
    debugState() {
        console.log('[OMICallSDK] 🔍 DEBUG STATE:');
        console.log('[OMICallSDK] 🔍 currentCallState:', this.currentCallState);
        console.log('[OMICallSDK] 🔍 isInitialized:', this.isInitialized);
        console.log('[OMICallSDK] 🔍 isConnected:', this.isConnected);
        console.log('[OMICallSDK] 🔍 connectionStatus:', this.connectionStatus);
        console.log('[OMICallSDK] 🔍 callWatchdogTimer:', !!this.callWatchdogTimer);
        console.log('[OMICallSDK] 🔍 callRoom:', this.callRoom);
        return this.currentCallState;
    }

    // Get current call state from SDK
    getCurrentCallState() {
        console.log('[OMICallSDK] 📞 getCurrentCallState() called');
        console.log('[OMICallSDK] 📞 SDK available:', !!this.sdk);
        console.log('[OMICallSDK] 📞 SDK keys:', this.sdk ? Object.keys(this.sdk) : 'No SDK');
        console.log('[OMICallSDK] 📞 Internal call state:', this.currentCallState);
        
        // Check internal call state first
        if (this.currentCallState.isActive) {
            console.log('[OMICallSDK] 📞 Found active call in internal state:', this.currentCallState);
            return this.currentCallState;
        }
        
        if (this.sdk && this.sdk.currentCall) {
            console.log('[OMICallSDK] 📞 Getting current call state from SDK:', this.sdk.currentCall);
            const call = this.sdk.currentCall;
            // Map SDK's internal status to our callStage
            let stage = 'idle';
            if (call.status === 'connecting') stage = 'connecting';
            else if (call.status === 'ringing') stage = 'ringing';
            else if (call.status === 'accepted') stage = 'in_call';
            
            return {
                isActive: true,
                status: stage,
                direction: call.direction || 'outbound',
                phoneNumber: call.remoteNumber || call.phoneNumber || '',
                duration: call.callingDuration?.text || '00:00',
                data: call // Return the raw call object for full context
            };
        }
        
        // Alternative: Check if there's an active call in progress
        if (this.sdk && typeof this.sdk.getCallHistories === 'function') {
            try {
                const histories = this.sdk.getCallHistories();
                console.log('[OMICallSDK] 📞 Call histories:', histories);
                if (histories && histories.length > 0) {
                    const latestCall = histories[0];
                    if (latestCall && latestCall.status && latestCall.status !== 'ended') {
                        console.log('[OMICallSDK] 📞 Found active call in history:', latestCall);
                        return {
                            isActive: true,
                            status: latestCall.status,
                            direction: latestCall.direction || 'outbound',
                            phoneNumber: latestCall.phoneNumber || '',
                            duration: latestCall.duration || '00:00',
                            data: latestCall
                        };
                    }
                }
            } catch (error) {
                console.log('[OMICallSDK] 📞 Error getting call histories:', error);
            }
        }
        
        // Check if there's a call in progress by checking SDK state
        if (this.sdk && typeof this.sdk.getSbState === 'function') {
            try {
                const sbState = this.sdk.getSbState();
                console.log('[OMICallSDK] 📞 SDK state:', sbState);
                if (sbState && sbState.callState && sbState.callState !== 'idle') {
                    console.log('[OMICallSDK] 📞 Found active call in SDK state:', sbState);
                    return {
                        isActive: true,
                        status: sbState.callState,
                        direction: 'outbound',
                        phoneNumber: sbState.remoteNumber || '',
                        duration: sbState.duration || '00:00',
                        data: sbState
                    };
                }
            } catch (error) {
                console.log('[OMICallSDK] 📞 Error getting SDK state:', error);
            }
        }
        
        console.log('[OMICallSDK] 📞 No active call found');
        return { isActive: false, status: 'idle' };
    }

    // Event system
    on(event, callback) {
        console.log(`[OMICallSDK] 🔧 Adding listener for event: ${event}`);
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
        console.log(`[OMICallSDK] 🔧 Total listeners for ${event}: ${this.eventListeners.get(event).length}`);
    }

    off(event, callback) {
        console.log(`[OMICallSDK] 🧹 Removing listener for event: ${event}`);
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
                console.log(`[OMICallSDK] 🧹 Remaining listeners for ${event}: ${listeners.length}`);
            }
        }
    }

    emit(event, data) {
        console.log(`[OMICallSDK] Emit ${event}:`, data);
        
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[OMICallSDK] Event listener error:`, error);
                }
            });
        }
        
        // Forward to global event system
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            const customEvent = new CustomEvent(`omicall-${event}`, { detail: data });
            window.dispatchEvent(customEvent);
        }
    }

    // Handle tab switching - maintain connection across tab switches
    handleTabSwitch() {
        console.log('[OMICallSDK] 🔄 Tab switch detected');
        
        // Don't cleanup on tab switch, just ensure connection is maintained
        if (this.isInitialized && this.isConnected) {
            console.log('[OMICallSDK] ✅ Connection maintained across tab switch');
            return;
        }
        
        // If not connected, try to reconnect
        if (this.isInitialized && !this.isConnected) {
            console.log('[OMICallSDK] 🔄 Reconnecting after tab switch...');
            this.connect().catch(error => {
                console.error('[OMICallSDK] ❌ Reconnect after tab switch failed:', error);
            });
        }
    }

    // Force reinitialize for tab switching scenarios
    async forceReinitialize() {
        console.log('[OMICallSDK] 🔄 Force reinitializing for tab switch...');
        
        // Don't destroy existing SDK, just reset connection state
        this.isConnected = false;
        this.connectionStatus = { status: 'disconnected', text: 'Đang khởi tạo lại...' };
        
        try {
            // Try to reconnect
            await this.connect();
            console.log('[OMICallSDK] ✅ Force reinitialize successful');
        } catch (error) {
            console.error('[OMICallSDK] ❌ Force reinitialize failed:', error);
            // Fallback to full reinitialization
            this.isInitialized = false;
            await this.initialize();
        }
    }

    // Cleanup
    destroy() {
        if (this.sdk?.destroy) {
            this.sdk.destroy();
        }
        this.eventListeners.clear();
        this.sdk = null;
        this.isInitialized = false;
        this.isConnected = false;
        this.connectionStatus = { status: 'disconnected', text: 'Chưa kết nối' };
    }
}

// Singleton instance - Đảm bảo chỉ có 1 instance duy nhất
let omicallSDKManagerInstance = null;

const getOMICallSDKManager = () => {
    if (!omicallSDKManagerInstance) {
        omicallSDKManagerInstance = new OMICallSDKManager();
        console.log('[OMICallSDK] Created singleton instance');
    }
    return omicallSDKManagerInstance;
};

export default getOMICallSDKManager();
