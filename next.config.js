/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        instrumentationHook: true,
        serverActions: {
            bodySizeLimit: '25mb',
        },
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'drive.google.com',
                port: '',
                pathname: '/**',
            },
            {// khai báo thêm đường dẫn hình ảnh từ lhu
                protocol: 'https',
                hostname: 'sinhvientuonglai.lhu.edu.vn',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 's75-ava-talk.zadn.vn',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 's240-ava-talk.zadn.vn',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'placehold.co',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'pancake.vn',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'scontent.cdninstagram.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'content.pancake.vn',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'scontent.fdad5-1.fna.fbcdn.net',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'scontent.fdad5-1.fna.fbcdn.net',
                port: '',
                pathname: '/**',
            },
        ],
    },
    output: 'standalone',
}

export default nextConfig;