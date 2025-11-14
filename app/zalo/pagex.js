// app/zalo/page.jsx
import { listZaloAccounts } from '@/data/zalo/actions';
import LoginQRModalButton from './ui/LoginQRModal.client';

function StatusBadge({ status }) {
    const styles = {
        active: 'bg-green-100 text-green-700 ring-green-200',
        disconnected: 'bg-amber-100 text-amber-700 ring-amber-200',
        blocked: 'bg-red-100 text-red-700 ring-red-200',
    };
    const cls = styles[status] || 'bg-gray-100 text-gray-700 ring-gray-200';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-lg ring-1 ${cls}`}>
            {status}
        </span>
    );
}

export const revalidate = 30; // cache 30s cho trang tĩnh, đủ “êm” với polling nhỏ từ client

export default async function ZaloAccountsPage() {
    const accounts = await listZaloAccounts(); // đã ẩn cookies ở action

    return (
        <div className="mx-auto max-w-5xl p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold">Tài khoản Zalo</h1>
                    <p className="text-sm text-muted-foreground">Quản lý trạng thái đăng nhập & đăng nhập QR</p>
                </div>
                <LoginQRModalButton />
            </div>

            <div className="grid gap-4">
                {accounts.length === 0 ? (
                    <div className="rounded-xl border bg-card text-card-foreground p-6">
                        <p className="text-sm">Chưa có tài khoản nào. Hãy bấm “Đăng nhập QR”.</p>
                    </div>
                ) : (
                    accounts.map((acc) => (
                        <div key={acc._id} className="rounded-xl border bg-card text-card-foreground p-4 flex items-center gap-4">
                            <img
                                src={acc?.profile?.avatar || '/zalo-avatar-placeholder.png'}
                                alt={acc?.profile?.displayName || acc?.profile?.zaloId}
                                className="h-12 w-12 rounded-full object-cover ring-1 ring-black/5"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="font-medium truncate">
                                        {acc?.profile?.displayName || 'Chưa có tên'}
                                    </div>
                                    <StatusBadge status={acc?.status} />
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                    ID: {acc?.profile?.zaloId} · Thiết bị: {acc?.device?.deviceName || 'bot-web'}
                                </div>
                            </div>

                            {/* (Tùy chọn) nút “đăng nhập lại bằng cookie” nếu cần */}
                            {/* Bạn có thể gắn action attemptCookieLogin ở đây */}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
