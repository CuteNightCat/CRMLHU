/** @type {import('next').NextConfig} */
const nextConfig = {
    serverActions: {
        bodySizeLimit: '4mb', // Tăng giới hạn lên 4MB. Bạn có thể dùng '2mb', '10mb', etc.
    },
};

export default nextConfig;
