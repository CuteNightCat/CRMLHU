'use client';

import { useEffect, useRef, useState } from 'react';
import { X, QrCode } from 'lucide-react';
import { useRouter } from 'next/navigation';
// ✅ import thẳng server actions
import { startQrLogin, pollQrLogin } from '@/data/zalo/actions';



export default function LoginQRModalButton() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState('idle'); // idle | generating | showing | success | failed
    const [qrImage, setQrImage] = useState(null);
    const [loginId, setLoginId] = useState(null);
    const pollRef = useRef(null);

    const close = () => {
        setOpen(false);
        setStep('idle');
        setQrImage(null);
        setLoginId(null);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const beginLogin = async () => {
        setStep('generating');
        try {
            const res = await startQrLogin();
            console.log(res);
            
            setLoginId(res.loginId);
            setQrImage(res.qrPublicUrl || null);
            setStep('showing');

            pollRef.current = setInterval(async () => {
                try {
                    const s = await pollQrLogin(res.loginId);
                    if (s.status === 'success') {
                        clearInterval(pollRef.current); pollRef.current = null;
                        setStep('success');
                        router.refresh();         // reload server component danh sách
                        setTimeout(() => close(), 800);
                    } else if (s.status === 'failed') {
                        clearInterval(pollRef.current); pollRef.current = null;
                        setStep('failed');
                    }
                } catch (_) { }
            }, 1500);
        } catch (_) {
            console.log('Login QR failed');
            
            setStep('failed');
        }
    };
    console.log(step);
    
    useEffect(() => {
        if (!open) return;
        beginLogin();
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow"
            >
                <QrCode className="h-4 w-4" />
                Đăng nhập QR
            </button>

            {open && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl ring-1 ring-black/10">
                        <div className="flex items-center gap-2 px-4 h-12 border-b">
                            <QrCode className="h-4 w-4 text-blue-600" />
                            <div className="font-medium">Quét mã QR để đăng nhập</div>
                            <button onClick={close} className="ml-auto p-2 hover:bg-black/5 rounded-lg">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="p-4">
                            {step === 'generating' && <div className="text-sm text-muted-foreground">Đang khởi tạo mã QR…</div>}

                            {step === 'showing' && qrImage && (
                                <div className="flex flex-col items-center gap-3">
                                    <img
                                        src={`${qrImage}`}
                                        alt="QR đăng nhập Zalo"
                                        className="h-64 w-64 rounded-xl ring-1 ring-black/10 object-contain bg-white"
                                    />
                                    <div className="text-xs text-muted-foreground text-center">
                                        Mở Zalo &gt; Quét mã QR. Cửa sổ sẽ tự đóng khi đăng nhập thành công.
                                    </div>
                                </div>
                            )}

                            {step === 'success' && <div className="text-sm text-green-700">Đăng nhập thành công! Đang cập nhật…</div>}
                            {step === 'failed' && <div className="text-sm text-red-600">Đăng nhập thất bại/hết hạn. Thử lại.</div>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
