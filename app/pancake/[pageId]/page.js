import { notFound } from 'next/navigation';
import ChatClient from './ChatClient';
import { getPagesFromAPI, PANCAKE_USER_ACCESS_TOKEN } from '@/lib/pancake-api';
import { getLabelData } from '@/app/(setting)/label/page';

export default async function ChatPage({ params }) {
    const { pageId } = await params;

    let pageConfig = await getPagesFromAPI();
    
    // Kiểm tra nếu API trả về null hoặc không phải array
    if (!pageConfig || !Array.isArray(pageConfig)) {
        console.error('Failed to load page config from API, using fallback');
        // Fallback: tạo pageConfig mặc định
        pageConfig = {
            id: pageId,
            name: 'Page Facebook',
            platform: 'facebook',
            avatar: '/default-avatar.png',
            accessToken: PANCAKE_USER_ACCESS_TOKEN
        };
    } else {
        pageConfig = pageConfig.find(p => p.id === pageId);
        if (!pageConfig) {
            console.error('Page not found in API response, using fallback');
            // Fallback: tạo pageConfig mặc định
            pageConfig = {
                id: pageId,
                name: 'Page Facebook',
                platform: 'facebook',
                avatar: '/default-avatar.png',
                accessToken: PANCAKE_USER_ACCESS_TOKEN
            };
        }
    }

    const label = await getLabelData();

    return (
        <ChatClient
            pageConfig={pageConfig}
            label={label}
            token={PANCAKE_USER_ACCESS_TOKEN}
        />
    );
}
