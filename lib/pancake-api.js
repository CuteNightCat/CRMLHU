import axios from 'axios';

// The access token for your main Pancake account
export const PANCAKE_USER_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiRGV2IFN1cHBvcnQiLCJleHAiOjE3NjcwNzc2NzUsImFwcGxpY2F0aW9uIjoxLCJ1aWQiOiIwNzUzNDE2YS01NzBlLTRmODItOWI0Ny05ZmUzNTVjOGYzMTgiLCJzZXNzaW9uX2lkIjoiNlRPRTdIcjhhQ0FLdjQzRm9rN2dDelJJRWRTQU1VM1ZmRmxKakxYcUFTZyIsImlhdCI6MTc1OTMwMTY3NSwiZmJfaWQiOiIxMjIxNDc0MjEzMzI2OTA1NjEiLCJsb2dpbl9zZXNzaW9uIjpudWxsLCJmYl9uYW1lIjoiRGV2IFN1cHBvcnQifQ.8SQAtPVKMw40uzbRceqC7-9GC121ajrzR0pKI1XDxcM';

/**
 * Fetches the list of pages from the Pancake API.
 * @returns {Promise<Array|null>} A promise that resolves to an array of pages or null if an error occurs.
 */
export async function getPagesFromAPI() {
    try {
        console.log('🔄 Attempting to fetch pages from Pancake API...');
        let response = await fetch(`https://pancake.vn/api/v1/pages?access_token=${PANCAKE_USER_ACCESS_TOKEN}`);
        response = await response.json();
        
        // console.log('✅ API response received:', response); //🚩
        
        if (response?.success && response?.categorized?.activated) {
            // Từ khóa cần loại trừ (không phân biệt hoa thường, có/không dấu)
            const EXCLUDED_KEYWORDS = ['BLING KIM', 'BÁC SĨ BLING KIM', 'BAC SI BLING KIM'];
            
            // Hàm helper để chuẩn hóa chuỗi (chữ hoa, loại bỏ dấu)
            const normalizeString = (str) => {
                return String(str || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toUpperCase();
            };
            
            // Hàm kiểm tra xem page có chứa từ khóa bị loại trừ không
            const shouldExcludePage = (pageName) => {
                if (!pageName) return false;
                const pageNameNormalized = normalizeString(pageName);
                return EXCLUDED_KEYWORDS.some(keyword => {
                    const keywordNormalized = normalizeString(keyword);
                    return pageNameNormalized.includes(keywordNormalized);
                });
            };
            
            const pages = response.categorized.activated
                .map((page, index) => ({
                    accessToken: PANCAKE_USER_ACCESS_TOKEN,
                    id: page.id,
                    name: page.name,
                    platform: page.platform,
                    avatar: `https://pancake.vn/api/v1/pages/${page.id}/avatar?access_token=${PANCAKE_USER_ACCESS_TOKEN}`, // URL ảnh avatar
                }))
                .filter(page => 
                    // Lọc theo platform
                    (page.platform == 'facebook' || 
                     page.platform == 'instagram_official' || 
                     page.platform == 'tiktok_business_messaging' || 
                     page.platform == 'personal_zalo')
                    &&
                    // Loại trừ các page có chứa từ khóa "BLING KIM" hoặc "BAC SI BLING KIM"
                    !shouldExcludePage(page.name)
                );
            
            // console.log('📄 Found pages:', pages.length); //🚩
            // console.log('📄 Pages data:', pages.map(p => ({ id: p.id, name: p.name, platform: p.platform, avatar: p.avatar })));
            return pages;
        }
        
        console.warn('⚠️ API response structure unexpected:', response);
        return null;
    } catch (error) {
        console.error("❌ Failed to fetch pages from Pancake API:", error.message);
        return null;
    }
}
