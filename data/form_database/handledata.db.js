import Form from '@/models/formclient'
import Customer from '@/models/customer.model'
import '@/models/users'
import connectDB from '@/config/connectDB'
import { cacheData } from '@/lib/cache'
import { getPagesFromAPI } from '@/lib/pancake-api'

async function dataForm(id) {
    try {
        await connectDB()
        const aggregationPipeline = [
            { $sort: { createdAt: -1 } },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: 'source',
                    as: 'customers'
                }
            },
            {
                $addFields: {
                    customerCount: { $size: '$customers' },
                    customerTimes: {
                        $map: { input: '$customers', as: 'customer', in: '$$customer.createAt' }
                    }
                }
            },
            { $project: { customers: 0 } }
        ]
        let forms;
        if (id) {
            forms = await Form.findById(id).lean()
        } else {
            forms = await Form.aggregate(aggregationPipeline)
            await Form.populate(forms, { path: 'createdBy', select: 'name' })
        }
        return JSON.parse(JSON.stringify(forms))
    } catch (error) {
        console.error('Lỗi trong dataForm:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}

export async function getFormAll() {
    try {
        const cachedFunction = cacheData(() => dataForm(), ['forms'])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong getFormAll:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}

export async function getFormOne(id) {
    try {
        const cachedFunction = cacheData(() => dataForm(id), ['forms', id])
        return await cachedFunction()
    } catch (error) {
        console.error('Lỗi trong getFormOne:', error)
        throw new Error('Không thể lấy dữ liệu form.')
    }
}

/**
 * Format platform name theo mapping chuẩn
 */
function formatPlatformName(platform) {
    const platformMap = {
        'facebook': 'Facebook',
        'instagram_official': 'Instagram',
        'tiktok_business_messaging': 'TikTok',
        'personal_zalo': 'Zalo'
    };
    return platformMap[platform] || platform || 'Facebook';
}

/**
 * Format sourceDetails theo format: "Tin nhắn - {Platform} - {Page Name}"
 */
function formatSourceDetails(platform, pageName) {
    const platformName = formatPlatformName(platform);
    return `Tin nhắn - ${platformName} - ${pageName || 'Page'}`;
}

/**
 * Lấy danh sách nguồn Tin nhắn từ các page được quản lý trong tab "Nhắn tin"
 * Format: "Tin nhắn - {Platform} - {Page Name}"
 */
async function dataMessageSources() {
    try {
        // Lấy danh sách page từ Pancake API (từ tab "Nhắn tin")
        const pages = await getPagesFromAPI();
        
        if (!pages || !Array.isArray(pages) || pages.length === 0) {
            console.warn('⚠️ Không có page nào từ Pancake API hoặc API trả về lỗi. Trả về danh sách rỗng.');
            return [];
        }

        // Format mỗi page thành sourceDetails theo format chuẩn
        const messageSourceDetails = pages
            .filter(page => page && page.platform && page.name) // Lọc page hợp lệ
            .map(page => formatSourceDetails(page.platform, page.name))
            .sort(); // Sắp xếp theo thứ tự ABC

        console.log(`✅ [dataMessageSources] Đã lấy ${messageSourceDetails.length} nguồn tin nhắn từ ${pages.length} page(s)`);

        // Chuyển đổi thành format giống sources
        return messageSourceDetails.map(s => ({
            _id: s,  // Dùng sourceDetails làm _id để filter
            name: s,
            isMessageSource: true  // Flag để phân biệt
        }));
    } catch (error) {
        console.error('❌ Lỗi trong dataMessageSources:', error);
        // Trả về array rỗng thay vì throw error để không làm crash ứng dụng
        return [];
    }
}

/**
 * Lấy danh sách nguồn Tin nhắn (có cache)
 * Cache key bao gồm 'pages' để invalidate khi page thay đổi
 */
export async function getMessageSources() {
    try {
        // Cache với key 'pages' để invalidate khi page thay đổi
        const cachedFunction = cacheData(() => dataMessageSources(), ['messageSources', 'pages']);
        return await cachedFunction();
    } catch (error) {
        console.error('Lỗi trong getMessageSources:', error);
        throw new Error('Không thể lấy dữ liệu nguồn tin nhắn.');
    }
}
