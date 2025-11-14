'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

// Hàm tạo màu ngẫu nhiên dựa trên chuỗi (ví dụ: tên người dùng)
const generateColor = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
};

// Hàm lấy chữ cái đầu của tên
const getInitials = (name) => {
    if (!name) return '?';
    const words = name.split(' ');
    // Lấy chữ cái đầu của từ cuối cùng trong tên
    return words[words.length - 1].charAt(0).toUpperCase();
};

export default function FallbackAvatar({ src, alt, name, width, height, className }) {
    const [imgError, setImgError] = useState(false);

    // Reset trạng thái lỗi khi `src` thay đổi
    useEffect(() => {
        setImgError(false);
    }, [src]);

    if (imgError || !src) {
        const initials = getInitials(name || alt);
        const bgColor = generateColor(name || alt || 'default');

        return (
            <div
                className={`flex items-center justify-center font-bold text-white ${className}`}
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    backgroundColor: bgColor,
                    fontSize: `${width / 2}px` // Kích thước chữ bằng nửa kích thước avatar
                }}
            >
                {initials}
            </div>
        );
    }

    return (
        <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={className}
            onError={() => setImgError(true)} // Quan trọng: Bắt sự kiện lỗi
            unoptimized={true} // Tắt image optimization để tránh lỗi với external URLs
        />
    );
}