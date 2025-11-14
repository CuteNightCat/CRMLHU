export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Chỉ chạy trên server-side
        console.log('[instrumentation] 🚀 Khởi tạo Agenda job scheduler...');
        
        try {
            const { default: initAgenda } = await import('./config/agenda.js');
            await initAgenda();
            console.log('[instrumentation] ✅ Agenda đã được khởi tạo thành công.');
        } catch (error) {
            console.error('[instrumentation] ❌ Lỗi khi khởi tạo Agenda:', error);
        }
    }
}

