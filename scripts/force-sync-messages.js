// Script để force sync tin nhắn ngay lập tức
// Chạy trong browser console

console.log('🚀 Force Sync Messages Script Loaded');

// Hàm force reload messages cho conversation hiện tại
function forceReloadMessages() {
    console.log('🔄 Force reloading messages...');
    
    // Tìm socket connection
    const socket = window.socket || window.socketRef?.current;
    if (!socket) {
        console.error('❌ Socket not found');
        return;
    }
    
    // Tìm conversation hiện tại
    const selectedConv = document.querySelector('.bg-blue-50, .border-blue-200');
    if (!selectedConv) {
        console.error('❌ No conversation selected');
        return;
    }
    
    // Lấy thông tin conversation
    const convName = selectedConv.querySelector('.font-medium')?.textContent;
    console.log('📋 Selected conversation:', convName);
    
    // Emit msg:get để reload messages
    socket.emit('msg:get', {
        pageId: window.pageConfig?.id,
        token: window.token,
        conversationId: window.selectedConversationId,
        customerId: null,
        count: 0
    }, (res) => {
        console.log('📨 Force reload response:', res);
        if (res?.ok) {
            console.log('✅ Messages reloaded successfully');
            
            // Trigger re-render
            const event = new CustomEvent('forceReloadMessages', { detail: res });
            window.dispatchEvent(event);
        } else {
            console.error('❌ Failed to reload messages:', res?.error);
        }
    });
}

// Hàm kiểm tra sync status
function checkSyncStatus() {
    console.log('🔍 Checking sync status...');
    
    // Lấy tin nhắn mới nhất từ sidebar
    const sidebarMessages = Array.from(document.querySelectorAll('.cursor-pointer')).map(item => {
        const name = item.querySelector('.font-medium')?.textContent;
        const snippet = item.querySelector('.text-sm')?.textContent;
        const time = item.querySelector('.text-xs')?.textContent;
        return { name, snippet, time, element: item };
    });
    
    // Lấy tin nhắn từ chat area
    const chatMessages = Array.from(document.querySelectorAll('.rounded-xl')).map(item => {
        const content = item.querySelector('p')?.textContent;
        const time = item.querySelector('.text-xs')?.textContent;
        return { content, time, element: item };
    });
    
    console.log('📋 Sidebar messages:', sidebarMessages.slice(0, 3));
    console.log('💬 Chat messages:', chatMessages.slice(-3));
    
    if (sidebarMessages.length > 0 && chatMessages.length > 0) {
        const latestSidebar = sidebarMessages[0];
        const latestChat = chatMessages[chatMessages.length - 1];
        
        console.log('🔍 Latest comparison:');
        console.log('  Sidebar:', latestSidebar.snippet, latestSidebar.time);
        console.log('  Chat:', latestChat.content, latestChat.time);
        
        if (latestSidebar.snippet === latestChat.content) {
            console.log('✅ SYNCED - Messages are in sync');
            return true;
        } else {
            console.log('❌ NOT SYNCED - Messages are out of sync');
            return false;
        }
    }
    
    return false;
}

// Hàm auto-sync mỗi 3 giây
function startAutoSync() {
    console.log('⏰ Starting auto-sync every 3 seconds...');
    
    const interval = setInterval(() => {
        const isSynced = checkSyncStatus();
        if (!isSynced) {
            console.log('🔄 Auto-syncing due to mismatch...');
            forceReloadMessages();
        }
    }, 3000);
    
    return interval;
}


// Hàm debug toàn bộ
function debugAll() {
    console.log('🐛 === DEBUG ALL ===');
    
    // 1. Check socket
    const socket = window.socket || window.socketRef?.current;
    console.log('1. Socket:', socket ? '✅ Found' : '❌ Not found');
    if (socket) {
        console.log('   Connected:', socket.connected ? '✅' : '❌');
        console.log('   ID:', socket.id);
    }
    
    // 2. Check sync status
    const isSynced = checkSyncStatus();
    console.log('2. Sync status:', isSynced ? '✅ Synced' : '❌ Not synced');
    
    // 3. Force reload
    console.log('3. Force reloading...');
    forceReloadMessages();
    
    // 4. Start auto-sync
    const interval = startAutoSync();
    console.log('4. Auto-sync started');
    
    console.log('🐛 Debug session started. Check logs for updates.');
    
    // Return cleanup function
    return () => {
        clearInterval(interval);
        console.log('🛑 Debug session ended');
    };
}

// Hàm fix ngay lập tức
function quickFix() {
    console.log('⚡ QUICK FIX - Force sync now...');
    
    // 1. Force reload messages
    forceReloadMessages();
    
    // 2. Check status
    setTimeout(() => {
        const isSynced = checkSyncStatus();
        if (!isSynced) {
            console.log('🔄 Still not synced, trying again...');
            forceReloadMessages();
        }
    }, 2000);
    
    console.log('⚡ Quick fix applied');
}

// Export functions
window.forceReloadMessages = forceReloadMessages;
window.checkSyncStatus = checkSyncStatus;
window.startAutoSync = startAutoSync;
window.testSendMessage = testSendMessage;
window.debugAll = debugAll;
window.quickFix = quickFix;

console.log('🔧 Force sync functions loaded:');
console.log('  - quickFix() - Fix ngay lập tức');
console.log('  - forceReloadMessages() - Reload messages');
console.log('  - checkSyncStatus() - Kiểm tra sync');
console.log('  - startAutoSync() - Auto sync');
console.log('  - debugAll() - Debug toàn bộ');

// Auto-run quick fix
console.log('⚡ Auto-running quick fix...');
setTimeout(quickFix, 1000);
