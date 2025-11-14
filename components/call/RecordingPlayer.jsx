"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

// format mm:ss
const fmt = (s) => {
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

/**
 * Props:
 *  - callId: string (Mongo _id của Call)
 *  - className?: string
 */
export default function RecordingPlayer({ callId, className }) {
    const audioRef = useRef(null);

    const [src, setSrc] = useState(null);      // ❗ KHÔNG để chuỗi rỗng
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [dur, setDur] = useState(0);
    const [cur, setCur] = useState(0);
    const [seeking, setSeeking] = useState(false);
    const [error, setError] = useState("");

    // Kiểm tra support webm/opus (Safari có thể không phát được)
    const webmSupported = useMemo(() => {
        if (typeof document === "undefined") return true;
        const a = document.createElement("audio");
        if (!a || !a.canPlayType) return true;
        return !!(a.canPlayType('audio/webm;codecs="opus"') || a.canPlayType("audio/webm"));
    }, []);

    useEffect(() => {
        // Build URL stream từ API của bạn
        if (!callId) {
            setSrc(null);
            setError("Không có ID cuộc gọi");
            return;
        }
        
        // Thêm timestamp để tránh cache
        const timestamp = Date.now();
        setSrc(`/api/calls/${encodeURIComponent(callId)}/audio?t=${timestamp}`);
        setError("");
        setReady(false);
        setDur(0);
        setCur(0);
        setPlaying(false);
    }, [callId]);

    const onLoaded = () => {
        if (!audioRef.current) return;
        const d = audioRef.current.duration;
        setDur(Number.isFinite(d) ? d : 0);
        setReady(true);
        setLoading(false);
        
        // Đảm bảo âm lượng tối đa
        audioRef.current.volume = 1.0;
        audioRef.current.muted = false;
        console.log('🎵 Audio loaded with volume:', audioRef.current.volume);
    };

    const onTimeUpdate = () => {
        if (seeking || !audioRef.current) return;
        setCur(audioRef.current.currentTime);
    };

    const onEnded = () => {
        setPlaying(false);
        setCur(0);
    };

    const onAudioError = (e) => {
        // Thường do 401/403/404 hoặc Safari không support webm
        setLoading(false);
        setReady(false);
        setPlaying(false);
        
        console.error('🎵 Audio error details:', {
            error: e,
            src,
            callId,
            webmSupported,
            timestamp: new Date().toISOString()
        });
        
        // Test API response directly
        if (src && src.includes('/api/calls/')) {
            const callIdFromSrc = src.split('/api/calls/')[1]?.split('/')[0];
            console.error('🎵 Failed to load audio for callId:', callIdFromSrc);
            
            // Test API response
            fetch(src)
                .then(response => {
                    console.error('🎵 API Response Status:', response.status);
                    console.error('🎵 API Response Headers:', Object.fromEntries(response.headers.entries()));
                    return response.text();
                })
                .then(text => {
                    console.error('🎵 API Response Body:', text);
                })
                .catch(fetchError => {
                    console.error('🎵 API Fetch Error:', fetchError);
                });
        }
        
        // Kiểm tra lỗi cụ thể
        let msg = "Không thể tải ghi âm.";
        
        if (!webmSupported) {
            msg = "Trình duyệt không hỗ trợ định dạng WebM/Opus. Vui lòng dùng Chrome/Edge.";
        } else if (src && src.includes('/api/calls/')) {
            // Extract callId from src for debugging
            const callIdFromSrc = src.split('/api/calls/')[1]?.split('/')[0];
            msg = `Ghi âm không thể tải (Call ID: ${callIdFromSrc}). Kiểm tra console để xem chi tiết lỗi.`;
        } else {
            msg = "Không thể tải ghi âm. Kiểm tra quyền hoặc file.";
        }
        
        setError(msg);
        toast.error(msg);
    };

    const reload = () => {
        if (!src) return;
        setLoading(true);
        setError("");
        // Force refresh bằng cache-buster nhẹ
        const url = new URL(src, window.location.origin);
        url.searchParams.set("_", Date.now().toString());
        setSrc(url.pathname + "?" + url.searchParams.toString());
    };

    const toggle = async () => {
        if (!audioRef.current || !ready) return;
        if (playing) {
            audioRef.current.pause();
            setPlaying(false);
        } else {
            try {
                // Đảm bảo âm lượng tối đa trước khi phát
                audioRef.current.volume = 1.0;
                audioRef.current.muted = false;
                console.log('🎵 Playing audio with volume:', audioRef.current.volume);
                
                await audioRef.current.play();
                setPlaying(true);
            } catch (e) {
                setPlaying(false);
                toast.error(e?.message || "Không phát được ghi âm");
            }
        }
    };

    const onSeek = (e) => {
        setSeeking(true);
        setCur(Number(e.target.value));
    };
    const onSeekEnd = () => {
        if (audioRef.current) audioRef.current.currentTime = cur;
        setSeeking(false);
    };

    return (
        <div className={`w-full ${className || ""}`}>
            {/* ❗ Không render audio khi chưa có src để tránh src="" */}
            {src && (
                <audio
                    key={src} // Force re-init mỗi lần đổi link (cache-buster)
                    ref={audioRef}
                    src={src ?? undefined}
                    preload="metadata"
                    onLoadedMetadata={onLoaded}
                    onTimeUpdate={onTimeUpdate}
                    onEnded={onEnded}
                    onError={onAudioError}
                    // Ẩn controls mặc định, không lộ nguồn
                    controls={false}
                    controlsList="nodownload noplaybackrate noremoteplayback"
                    // Cài đặt âm lượng cao
                    volume={1.0}
                    muted={false}
                    crossOrigin="anonymous"
                />
            )}

            {/* Enhanced UI Layout */}
            <div className="p-3">
                {/* Header with Play Button and Status */}
                <div className="flex items-center gap-3 mb-3">
                    <Button
                        type="button"
                        variant={playing ? "default" : "outline"}
                        size="icon"
                        onClick={toggle}
                        disabled={!src || !ready || loading}
                        title={!src ? "Chưa sẵn sàng" : ready ? "Phát / Tạm dừng" : "Đang nạp"}
                        className="h-10 w-10"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : playing ? (
                            <Pause className="h-4 w-4" />
                        ) : (
                            <Play className="h-4 w-4" />
                        )}
                    </Button>

                    <div className="flex-1">
                        <div className="text-sm font-medium text-gray-700">
                            {playing ? "Đang phát..." : ready ? "Sẵn sàng phát" : loading ? "Đang tải..." : "Chưa sẵn sàng"}
                        </div>
                        <div className="text-xs text-gray-500">
                            {error ? error : "Ghi âm cuộc gọi"}
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={reload}
                        disabled={!src || loading}
                        title="Tải lại"
                        className="h-8 w-8"
                    >
                        <RotateCw className="h-4 w-4" />
                    </Button>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className="tabular-nums">{fmt(cur)}</span>
                        <span className="tabular-nums">{dur ? fmt(dur) : "--:--"}</span>
                    </div>
                    
                    <div className="relative">
                        <input
                            type="range"
                            min={0}
                            max={Math.max(1, Math.floor(dur))}
                            value={Math.floor(cur)}
                            onChange={onSeek}
                            onMouseUp={onSeekEnd}
                            onTouchEnd={onSeekEnd}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            style={{
                                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(cur / Math.max(1, dur)) * 100}%, #e5e7eb ${(cur / Math.max(1, dur)) * 100}%, #e5e7eb 100%)`
                            }}
                            disabled={!ready || !src || loading}
                        />
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
