'use client';
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import styles from './index.module.css';
import { Svg_Waring } from '@/components/(icon)/svg';

const AlertIcon = memo(({ type }) => {
    const icons = { success: '✔', error: '✖', warning: <Svg_Waring h={24} c={'var(--yellow)'} w={24} />, info: 'ℹ' };
    return <span className={styles.icon}>{icons[type]}</span>;
});
AlertIcon.displayName = 'AlertIcon';

const AlertPopup = ({ open, onClose, title, content, type = 'info', actions, width = 600 }) => {
    const [mounted, setMounted] = useState(false);
    const [visible, setVisible] = useState(false);
    const popupRef = useRef(null);

    useEffect(() => {
        if (open) {
            setMounted(true);
        }
    }, [open]);

    useEffect(() => {
        if (mounted) {
            const rafId = requestAnimationFrame(() => {
                setVisible(true);
            });
            return () => cancelAnimationFrame(rafId);
        }
    }, [mounted]);

    useEffect(() => {
        if (!open && mounted) {
            setVisible(false);
            const node = popupRef.current;
            if (!node) return;

            const handleTransitionEnd = (event) => {
                if (event.target === node) {
                    setMounted(false);
                }
            };
            node.addEventListener('transitionend', handleTransitionEnd);
            return () => {
                node.removeEventListener('transitionend', handleTransitionEnd);
            };
        }
    }, [open, mounted]);

    const handleBackdropClick = useCallback(() => {
        onClose?.();
    }, [onClose]);

    const handlePopupClick = useCallback((e) => e.stopPropagation(), []);

    if (!mounted) {
        return null;
    }

    const popupTypeClass = styles[type] || styles.info;
    const visibilityClass = visible ? styles.open : '';

    return (
        <div className={`${styles.backdrop} ${visibilityClass}`} onClick={handleBackdropClick}>
            <div
                ref={popupRef}
                className={`${styles.popup} ${popupTypeClass} ${visibilityClass}`}
                style={{ width }}
                onClick={handlePopupClick}
            >
                <div className={styles.indicator} />
                <div className={styles.header}>
                    <AlertIcon type={type} />
                    <h4>{title || 'Thông báo'}</h4>
                </div>
                <div className={styles.content}>
                    {content}
                </div>
                {actions && (
                    <div className={styles.actions} >
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(AlertPopup);