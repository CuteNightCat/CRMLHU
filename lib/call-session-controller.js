// lib/call-session-controller.js
// Call Session Controller - Centralized call lifecycle management

class CallSessionController {
    constructor() {
        this.currentSession = null;
        this.isInitializing = false;
        this.isEnding = false;
        this.timeouts = new Map();
        this.callTimeout = 30000; // 30 seconds
        this.reconnectTimeout = 5000; // 5 seconds
    }

    // Initialize new call session
    async initCallSession(phoneNumber, userData) {
        if (this.isInitializing) {
            console.log('[CallController] Already initializing, waiting...');
            return false;
        }

        if (this.currentSession?.isActive) {
            console.log('[CallController] Active session exists, ending first...');
            await this.endCallSession('new_call_initiated');
        }

        this.isInitializing = true;
        
        try {
            const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const session = {
                callId,
                phoneNumber,
                userData,
                isActive: false,
                status: 'initializing',
                startTime: Date.now(),
                timeoutId: null,
                reconnectAttempts: 0,
                maxReconnectAttempts: 3
            };

            this.currentSession = session;
            console.log('[CallController] Call session initialized:', callId);
            
            // Set timeout for call initialization
            this.setCallTimeout(callId, this.callTimeout);
            
            return session;
        } finally {
            this.isInitializing = false;
        }
    }

    // Start call session
    async startCallSession(session) {
        if (!session || session.status !== 'initializing') {
            throw new Error('Invalid session state for starting call');
        }

        session.isActive = true;
        session.status = 'connecting';
        session.startTime = Date.now();
        
        console.log('[CallController] Call session started:', session.callId);
        
        // Clear initialization timeout
        this.clearTimeout(session.callId);
        
        // Set call timeout
        this.setCallTimeout(session.callId, this.callTimeout);
        
        return session;
    }

    // End call session with confirmation
    async endCallSession(reason = 'user_ended') {
        if (this.isEnding) {
            console.log('[CallController] Already ending session, waiting...');
            return false;
        }

        if (!this.currentSession) {
            console.log('[CallController] No active session to end');
            return true;
        }

        this.isEnding = true;
        
        try {
            const session = this.currentSession;
            console.log('[CallController] Ending call session:', session.callId, 'Reason:', reason);
            
            // Clear all timeouts
            this.clearTimeout(session.callId);
            
            // Update session state
            session.isActive = false;
            session.status = 'ending';
            session.endTime = Date.now();
            session.endReason = reason;
            
            // Wait for server confirmation before final cleanup
            const confirmed = await this.waitForServerConfirmation(session.callId);
            
            if (confirmed) {
                this.finalizeSessionEnd(session);
                return true;
            } else {
                console.warn('[CallController] Server confirmation timeout, forcing cleanup');
                this.finalizeSessionEnd(session);
                return true;
            }
        } finally {
            this.isEnding = false;
        }
    }

    // Wait for server confirmation
    async waitForServerConfirmation(callId, timeout = 5000) {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                console.warn('[CallController] Server confirmation timeout for call:', callId);
                resolve(false);
            }, timeout);

            // Listen for server confirmation
            const checkConfirmation = () => {
                if (this.currentSession?.callId === callId && this.currentSession?.status === 'ended') {
                    clearTimeout(timeoutId);
                    resolve(true);
                }
            };

            // Check every 100ms
            const interval = setInterval(checkConfirmation, 100);
            
            // Cleanup interval after timeout
            setTimeout(() => clearInterval(interval), timeout + 100);
        });
    }

    // Finalize session end
    finalizeSessionEnd(session) {
        console.log('[CallController] Finalizing session end:', session.callId);
        
        // Clear all timeouts
        this.clearTimeout(session.callId);
        
        // Reset session
        this.currentSession = null;
        this.isEnding = false;
        this.isInitializing = false;
    }

    // Set call timeout
    setCallTimeout(callId, timeout) {
        this.clearTimeout(callId);
        
        const timeoutId = setTimeout(() => {
            console.warn('[CallController] Call timeout for:', callId);
            this.handleCallTimeout(callId);
        }, timeout);
        
        this.timeouts.set(callId, timeoutId);
    }

    // Clear timeout
    clearTimeout(callId) {
        const timeoutId = this.timeouts.get(callId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.timeouts.delete(callId);
        }
    }

    // Handle call timeout
    async handleCallTimeout(callId) {
        if (this.currentSession?.callId === callId) {
            console.log('[CallController] Handling call timeout for:', callId);
            await this.endCallSession('timeout');
        }
    }

    // Get current session
    getCurrentSession() {
        return this.currentSession;
    }

    // Check if session is active
    isSessionActive() {
        return this.currentSession?.isActive === true;
    }

    // Force reset all states
    forceReset() {
        console.log('[CallController] Force resetting all states');
        
        // Clear all timeouts
        this.timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.timeouts.clear();
        
        // Reset session
        this.currentSession = null;
        this.isInitializing = false;
        this.isEnding = false;
    }

    // Validate session state
    validateSessionState() {
        if (this.currentSession) {
            const session = this.currentSession;
            const now = Date.now();
            const duration = now - session.startTime;
            
            // Check if session is stuck
            if (session.status === 'connecting' && duration > this.callTimeout) {
                console.warn('[CallController] Session stuck in connecting state');
                this.handleCallTimeout(session.callId);
                return false;
            }
            
            if (session.status === 'ringing' && duration > this.callTimeout) {
                console.warn('[CallController] Session stuck in ringing state');
                this.handleCallTimeout(session.callId);
                return false;
            }
        }
        
        return true;
    }
}

// Singleton instance
const callSessionController = new CallSessionController();

export default callSessionController;


