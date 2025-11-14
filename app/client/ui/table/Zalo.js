'use client';

import React, { useState, useActionState, useRef } from 'react';
import { useRouter } from 'next/navigation';

// --- Icon Imports ---
import { MessageCircle, Send } from 'lucide-react';
// --- Shadcn UI Component Imports ---
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
// --- Server Actions ---
import { sendZaloMessageAction } from '@/app/actions/zalo-message.actions';

export default function ZaloButton({ customer, user, zalo }) {
    const [message, setMessage] = useState('');
    const [state, sendAction, isPending] = useActionState(sendZaloMessageAction, null);
    const formRef = useRef(null);
    const router = useRouter();

    // Handle success/error notifications
    React.useEffect(() => {
        console.log('🟢 [Client] State changed:', state);
        if (state) {
            if (state.success) {
                console.log('✅ [Client] Success!', state.message);
                toast.success(state.message || 'Đã gửi tin nhắn thành công!');
                setMessage(''); // Clear input on success
                // Refresh the page data to show updated UID and care history
                router.refresh();
            } else {
                console.log('❌ [Client] Failed!', state.message);
                toast.error(state.message || 'Gửi tin nhắn thất bại!');
            }
        }
    }, [state, router]);

    const handleSubmit = (e) => {
        console.log('🟡 [Client] Form submit triggered');
        if (!message.trim()) {
            e.preventDefault();
            console.log('⚠️ [Client] Empty message, preventing submit');
            toast.error('Vui lòng nhập nội dung tin nhắn');
            return;
        }
        console.log('✅ [Client] Message valid, allowing submit');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            formRef.current?.requestSubmit();
        }
    };

    // Get the Zalo account info
    const zaloAccount = customer.uid?.[0]?.zalo ? zalo.find(z => z._id === customer.uid[0].zalo) : null;
    const hasUid = !!customer.uid?.[0]?.uid;

    return (
        <div className="w-full p-4 flex flex-col gap-3">
            {/* Info Box */}
            {!hasUid && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <h6 className="text-yellow-800 font-semibold">Chưa có UID Zalo</h6>
                    <h6 className="text-yellow-700 text-sm mt-1">
                        Khách hàng này chưa có UID Zalo. Hệ thống sẽ tự động tìm UID khi gửi tin nhắn lần đầu.
                    </h6>
                </div>
            )}
            
            {hasUid && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <h6 className="text-green-800 font-semibold">Đã có UID Zalo</h6>
                    <h6 className="text-green-700 text-sm mt-1">
                        Có thể gửi tin nhắn trực tiếp đến khách hàng.
                    </h6>
                </div>
            )}

            {/* Message Input */}
            <form ref={formRef} action={sendAction} onSubmit={handleSubmit} className="flex flex-col gap-2">
                <input type="hidden" name="customerId" value={customer._id} />
                <Textarea
                    placeholder="Nhập tin nhắn..."
                    name="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isPending}
                    className="min-h-[100px] resize-none"
                />
                <Button
                    type="submit"
                    disabled={isPending || !message.trim()}
                    className="w-full"
                >
                    <Send className="h-4 w-4 mr-2" />
                    {isPending ? 'Đang gửi...' : 'Gửi tin nhắn'}
                </Button>
            </form>

            {/* Help Text */}
            <div className="text-xs text-muted-foreground text-center">
                <p>Nhấn Enter để gửi, Shift+Enter để xuống dòng</p>
            </div>
        </div>
    );
}
