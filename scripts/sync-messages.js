// Script để kiểm tra và đồng bộ tin nhắn
// Chạy trong browser console hoặc Node.js

// Hàm kiểm tra sự đồng bộ giữa sidebar và chat area
function checkMessageSync() {
    console.log('🔍 Kiểm tra đồng bộ tin nhắn...');
    
    // Lấy thông tin từ sidebar
    const sidebarMessages = [];
    const conversationItems = document.querySelectorAll('[data-conversation-id]');
    
    conversationItems.forEach(item => {
        const convId = item.getAttribute('data-conversation-id');
        const name = item.querySelector('.conversation-name')?.textContent;
        const snippet = item.querySelector('.conversation-snippet')?.textContent;
        const time = item.querySelector('.conversation-time')?.textContent;
        
        sidebarMessages.push({
            id: convId,
            name,
            snippet,
            time,
            element: item
        });
    });
    
    console.log('📋 Sidebar messages:', sidebarMessages);
    
    // Lấy thông tin từ chat area
    const chatMessages = [];
    const messageItems = document.querySelectorAll('[data-message-id]');
    
    messageItems.forEach(item => {
        const msgId = item.getAttribute('data-message-id');
        const content = item.querySelector('.message-content')?.textContent;
        const time = item.querySelector('.message-time')?.textContent;
        const sender = item.querySelector('.message-sender')?.textContent;
        
        chatMessages.push({
            id: msgId,
            content,
            time,
            sender,
            element: item
        });
    });
    
    console.log('💬 Chat messages:', chatMessages);
    
    // So sánh tin nhắn mới nhất
    if (sidebarMessages.length > 0 && chatMessages.length > 0) {
        const latestSidebar = sidebarMessages[0]; // Tin nhắn mới nhất trong sidebar
        const latestChat = chatMessages[chatMessages.length - 1]; // Tin nhắn mới nhất trong chat
        
        console.log('🔍 So sánh:');
        console.log('  Sidebar latest:', latestSidebar.snippet, latestSidebar.time);
        console.log('  Chat latest:', latestChat.content, latestChat.time);
        
        if (latestSidebar.snippet !== latestChat.content) {
            console.log('❌ KHÔNG ĐỒNG BỘ! Tin nhắn mới nhất không khớp');
            return false;
        } else {
            console.log('✅ ĐỒNG BỘ! Tin nhắn mới nhất khớp nhau');
            return true;
        }
    }
    
    return false;
}

// Hàm force refresh tin nhắn
function forceRefreshMessages() {
    console.log('🔄 Force refresh tin nhắn...');
    
    // Trigger refresh event
    const refreshEvent = new CustomEvent('forceRefreshMessages');
    window.dispatchEvent(refreshEvent);
    
    // Hoặc gọi trực tiếp nếu có function
    if (window.refreshMessages) {
        window.refreshMessages();
    }
    
    console.log('✅ Refresh event dispatched');
}

// Hàm kiểm tra kết nối Socket.IO
function checkSocketConnection() {
    console.log('🔌 Kiểm tra kết nối Socket.IO...');
    
    // Kiểm tra trong window object
    if (window.socket) {
        console.log('Socket status:', window.socket.connected ? '✅ Connected' : '❌ Disconnected');
        console.log('Socket ID:', window.socket.id);
        return window.socket.connected;
    }
    
    // Kiểm tra trong component state (nếu có)
    const reactRoot = document.querySelector('#__next');
    if (reactRoot && reactRoot._reactInternalFiber) {
        // Có thể access React state nếu cần
        console.log('React root found, checking for socket...');
    }
    
    return false;
}

// Hàm test gửi tin nhắn
function testSendMessage(message = 'Test message from script') {
    console.log('📤 Test gửi tin nhắn:', message);
    
    // Tìm form input
    const messageInput = document.querySelector('input[name="message"]');
    const sendButton = document.querySelector('button[type="submit"]');
    
    if (messageInput && sendButton) {
        messageInput.value = message;
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        setTimeout(() => {
            sendButton.click();
            console.log('✅ Tin nhắn test đã được gửi');
        }, 100);
    } else {
        console.log('❌ Không tìm thấy input hoặc button gửi tin nhắn');
    }
}

// Hàm monitor tin nhắn realtime
function monitorRealtimeMessages() {
    console.log('👁️ Bắt đầu monitor tin nhắn realtime...');
    
    let messageCount = 0;
    
    // Monitor DOM changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                const addedNodes = Array.from(mutation.addedNodes);
                addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if it's a new message
                        if (node.classList && (
                            node.classList.contains('message') ||
                            node.classList.contains('chat-message')
                        )) {
                            messageCount++;
                            console.log(`📨 Tin nhắn mới #${messageCount}:`, node.textContent);
                        }
                    }
                });
            }
        });
    });
    
    // Start observing
    const chatArea = document.querySelector('.chat-messages') || 
                    document.querySelector('[data-testid="messages"]') ||
                    document.querySelector('.messages-container');
    
    if (chatArea) {
        observer.observe(chatArea, {
            childList: true,
            subtree: true
        });
        console.log('✅ Đã bắt đầu monitor chat area');
    } else {
        console.log('❌ Không tìm thấy chat area để monitor');
    }
    
    return observer;
}

// Hàm debug toàn bộ
function debugChatSync() {
    console.log('🐛 === DEBUG CHAT SYNC ===');
    
    // 1. Kiểm tra kết nối
    const isConnected = checkSocketConnection();
    console.log('1. Socket connection:', isConnected ? '✅' : '❌');
    
    // 2. Kiểm tra đồng bộ
    const isSynced = checkMessageSync();
    console.log('2. Message sync:', isSynced ? '✅' : '❌');
    
    // 3. Bắt đầu monitor
    const observer = monitorRealtimeMessages();
    console.log('3. Realtime monitor:', '✅ Started');
    
    // 4. Test gửi tin nhắn sau 5 giây
    setTimeout(() => {
        testSendMessage('Debug test message - ' + new Date().toLocaleTimeString());
    }, 5000);
    
    console.log('🐛 Debug session started. Check logs for updates.');
    
    // Return cleanup function
    return () => {
        observer.disconnect();
        console.log('🛑 Debug session ended');
    };
}

// Export functions to global scope
window.debugChatSync = debugChatSync;
window.checkMessageSync = checkMessageSync;
window.forceRefreshMessages = forceRefreshMessages;
window.checkSocketConnection = checkSocketConnection;
window.testSendMessage = testSendMessage;
window.monitorRealtimeMessages = monitorRealtimeMessages;

console.log('🔧 Chat sync debug tools loaded!');
console.log('📋 Available functions:');
console.log('  - debugChatSync() - Debug toàn bộ');
console.log('  - checkMessageSync() - Kiểm tra đồng bộ');
console.log('  - forceRefreshMessages() - Force refresh');
console.log('  - checkSocketConnection() - Kiểm tra socket');
console.log('  - testSendMessage() - Test gửi tin nhắn');
console.log('  - monitorRealtimeMessages() - Monitor realtime');

// Auto-run debug nếu trong development mode
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('🚀 Development mode detected. Auto-running debug...');
    setTimeout(debugChatSync, 2000);
}
