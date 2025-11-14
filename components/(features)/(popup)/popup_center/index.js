'use client';

import React, { useEffect, useState, useRef } from 'react';
import styles from './index.module.css';  

export default function CenterPopup({
    open,
    onClose,
    title = '',
    children,
    size = 'md',            
    globalZIndex = 1000
}) {
    const [mounted, setMounted] = useState(false);
    const [visible, setVisible] = useState(false);
    const popupRef = useRef(null);

    // 1) Khi open=true → mount lên DOM
    useEffect(() => {
        if (open) {
            setMounted(true);
        }
    }, [open]);

    // 2) Khi đã mounted → trong frame kế tiếp bật visible để chạy transition
    useEffect(() => {
        if (mounted) {
            const raf = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(raf);
        }
    }, [mounted]);

    // 3) Khi open chuyển về false → tắt visible, đợi transitionend rồi mới unmount
    useEffect(() => {
        if (!open && mounted) {
            setVisible(false);
            const el = popupRef.current;
            if (!el) return;

            const onEnd = (e) => {
                if (e.propertyName === 'transform') {
                    setMounted(false);
                    el.removeEventListener('transitionend', onEnd);
                }
            };

            el.addEventListener('transitionend', onEnd);
            // optional: guard in case unmount trước khi event fire
            return () => el.removeEventListener('transitionend', onEnd);
        }
    }, [open, mounted]);

    // nếu chưa mount thì không render gì
    if (!mounted) return null;

    return (
        <div
            className={`${styles.overlay} ${visible ? styles.show : ''}`}
            onMouseDown={onClose}
            style={{ zIndex: globalZIndex }}
        >
            <div
                ref={popupRef}
                className={`
          ${styles.popup}
          ${styles[size]}
          ${visible ? styles.open : ''}
        `}
                onMouseDown={e => e.stopPropagation()}
            >
                {title && (
                    <div className={styles.header}>
                        <h3 className={styles.title}>{title}</h3>
                        <button className={styles.closeBtn} onClick={onClose}>&times;</button>
                    </div>
                )}
                <div className={styles.content}>
                    {children}
                </div>
            </div>
        </div>
    );
}
