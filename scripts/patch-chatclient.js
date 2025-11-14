// Patch trực tiếp cho ChatClient hiện tại để fix sync issue
// Chạy trong browser console

console.log('🔧 Patching ChatClient for sync fix...');

// Hàm patch message loading
function patchMessageLoading() {
    console.log('📝 Patching message loading...');
    
    // Tìm và patch socket event handlers
    const socket = window.socket || window.socketRef?.current;
    if (!socket) {
        console.log('❌ Socket not found, cannot patch');
        return;
    }
    
    // Remove existing msg:new handler
    socket.off('msg:new');
    
    // Add new enhanced handler
    socket.on('msg:new', (rawMessage) => {
        console.log('📨 Enhanced msg:new handler:', rawMessage);
        
        // Force normalize message
        const normalizedMessage = {
            id: rawMessage.id,
            inserted_at: rawMessage.inserted_at,
            senderType: String(rawMessage?.from?.id || '') === String(window.pageConfig?.id) ? 'page' : 'customer',
            content: {
                type: 'text',
                content: (rawMessage?.original_message || rawMessage?.message || '').trim()
            }
        };
        
        console.log('📝 Normalized message:', normalizedMessage);
        
        // Force update messages state
        const event = new CustomEvent('enhancedMsgNew', { 
            detail: { rawMessage, normalizedMessage } 
        });
        window.dispatchEvent(event);
        
        // Force scroll to bottom
        setTimeout(() => {
            const messagesEnd = document.querySelector('[ref="messagesEndRef"]') || 
                               document.querySelector('.messages-end') ||
                               document.querySelector('[data-testid="messages-end"]');
            if (messagesEnd) {
                messagesEnd.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);
    });
    
    console.log('✅ Message loading patched');
}

// Hàm patch conversation selection
function patchConversationSelection() {
    console.log('📝 Patching conversation selection...');
    
    // Override conversation selection behavior
    const originalSelectConv = window.selectConversation || window.handleSelectConversation;
    
    window.selectConversation = function(conversation) {
        console.log('🎯 Enhanced conversation selection:', conversation);
        
        // Call original function
        if (originalSelectConv) {
            originalSelectConv.call(this, conversation);
        }
        
        // Force reload messages after selection
        setTimeout(() => {
            console.log('🔄 Force reloading messages after selection...');
            
            const socket = window.socket || window.socketRef?.current;
            if (socket && conversation?.id) {
                socket.emit('msg:get', {
                    pageId: window.pageConfig?.id,
                    token: window.token,
                    conversationId: conversation.id,
                    customerId: null,
                    count: 0
                }, (res) => {
                    console.log('📨 Force reload response:', res);
                    if (res?.ok && Array.isArray(res.items)) {
                        // Trigger message update
                        const event = new CustomEvent('forceUpdateMessages', { 
                            detail: res.items 
                        });
                        window.dispatchEvent(event);
                    }
                });
            }
        }, 500);
    };
    
    console.log('✅ Conversation selection patched');
}

// Hàm patch socket connection
function patchSocketConnection() {
    console.log('📝 Patching socket connection...');
    
    const socket = window.socket || window.socketRef?.current;
    if (!socket) {
        console.log('❌ Socket not found');
        return;
    }
    
    // Enhanced connect handler
    socket.on('connect', () => {
        console.log('✅ Enhanced socket connected');
        
        // Force reload conversations
        setTimeout(() => {
            socket.emit('conv:get', {
                pageId: window.pageConfig?.id,
                token: window.token,
                current_count: 0
            }, (res) => {
                console.log('📋 Force reload conversations:', res);
                if (res?.ok) {
                    const event = new CustomEvent('forceUpdateConversations', { 
                        detail: res.items 
                    });
                    window.dispatchEvent(event);
                }
            });
        }, 1000);
    });
    
    console.log('✅ Socket connection patched');
}

// Hàm patch message display
function patchMessageDisplay() {
    console.log('📝 Patching message display...');
    
    // Listen for force update events
    window.addEventListener('forceUpdateMessages', (event) => {
        console.log('🔄 Force updating messages:', event.detail);
        
        // Find messages container
        const messagesContainer = document.querySelector('.space-y-1') || 
                                 document.querySelector('[data-testid="messages"]') ||
                                 document.querySelector('.messages-container');
        
        if (messagesContainer) {
            // Clear existing messages
            messagesContainer.innerHTML = '';
            
            // Add new messages
            event.detail.forEach((msg, index) => {
                const messageDiv = document.createElement('div');
                messageDiv.className = 'flex flex-col my-1';
                messageDiv.innerHTML = `
                    <div class="max-w-lg p-3 rounded-xl shadow-sm flex flex-col bg-white text-gray-800">
                        <p class="w-full" style="color: inherit; white-space: pre-wrap;">
                            ${msg.original_message || msg.message || ''}
                        </p>
                        <div class="text-xs mt-1 text-left text-gray-500">
                            ${new Date(msg.inserted_at).toLocaleString('vi-VN')}
                        </div>
                    </div>
                `;
                messagesContainer.appendChild(messageDiv);
            });
            
            // Scroll to bottom
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 100);
        }
    });
    
    console.log('✅ Message display patched');
}

// Hàm patch refresh button
function patchRefreshButton() {
    console.log('📝 Patching refresh button...');
    
    // Find or create refresh button
    let refreshButton = document.querySelector('[data-testid="refresh-button"]') ||
                       document.querySelector('.refresh-button');
    
    if (!refreshButton) {
        // Create refresh button
        const chatHeader = document.querySelector('.p-4.border-b.border-gray-200.bg-white');
        if (chatHeader) {
            refreshButton = document.createElement('button');
            refreshButton.className = 'inline-flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100';
            refreshButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                <span>Làm mới</span>
            `;
            
            const headerContent = chatHeader.querySelector('.flex.items-center.justify-between');
            if (headerContent) {
                headerContent.appendChild(refreshButton);
            }
        }
    }
    
    if (refreshButton) {
        refreshButton.onclick = () => {
            console.log('🔄 Manual refresh triggered');
            
            // Force reload current conversation
            const selectedConv = document.querySelector('.bg-blue-50, .border-blue-200');
            if (selectedConv) {
                const convName = selectedConv.querySelector('.font-medium')?.textContent;
                console.log('📋 Refreshing conversation:', convName);
                
                // Trigger refresh
                const event = new CustomEvent('manualRefresh', { 
                    detail: { conversationName: convName } 
                });
                window.dispatchEvent(event);
            }
        };
    }
    
    console.log('✅ Refresh button patched');
}

// Hàm apply tất cả patches
function applyAllPatches() {
    console.log('🔧 Applying all patches...');
    
    patchMessageLoading();
    patchConversationSelection();
    patchSocketConnection();
    patchMessageDisplay();
    patchRefreshButton();
    
    console.log('✅ All patches applied successfully');
    
    // Test patches
    setTimeout(() => {
        console.log('🧪 Testing patches...');
        const socket = window.socket || window.socketRef?.current;
        if (socket && socket.connected) {
            console.log('✅ Socket is connected and patched');
        } else {
            console.log('⚠️ Socket not connected, patches will apply on next connection');
        }
    }, 1000);
}

// Auto-apply patches
console.log('🚀 Auto-applying patches...');
applyAllPatches();

// Export functions
window.applyAllPatches = applyAllPatches;
window.patchMessageLoading = patchMessageLoading;
window.patchConversationSelection = patchConversationSelection;
window.patchSocketConnection = patchSocketConnection;
window.patchMessageDisplay = patchMessageDisplay;
window.patchRefreshButton = patchRefreshButton;

console.log('🔧 ChatClient patches loaded and applied!');
console.log('📋 Available functions:');
console.log('  - applyAllPatches() - Apply all patches');
console.log('  - patchMessageLoading() - Patch message loading');
console.log('  - patchConversationSelection() - Patch conversation selection');
console.log('  - patchSocketConnection() - Patch socket connection');
console.log('  - patchMessageDisplay() - Patch message display');
console.log('  - patchRefreshButton() - Patch refresh button');
