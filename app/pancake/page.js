import Link from 'next/link';
import Image from 'next/image';
import { getPagesFromAPI } from '@/lib/pancake-api';

export default async function HomePage() {
    let pages = await getPagesFromAPI();
    let dataSource = 'Dữ liệu từ API';

    return (
        <div className="w-full h-full bg-gray-100 flex">
            <div className="w-full bg-white rounded-md border border-gray-200 flex-1 p-6">
                <div className="mb-6 pb-4 border-b border-gray-200">
                    <p className="text-sm text-gray-800">Kết nối các nền tảng xã hội để thực hiện tương khác khách hàng</p>
                </div>
                {pages.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {pages.map((page) => (
                            <Link href={`/pancake/${page.id}`} key={page.id} className="block h-full">
                                <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center space-x-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all duration-200 h-full">
                                    <Image
                                        src={page.avatar}            // URL avatar của page (Instagram/Facebook)
                                        alt={page.name}
                                        width={48}
                                        height={48}
                                        className="rounded-md object-cover"
                                        unoptimized
                                    />
                                    <div className="flex-1 overflow-hidden">
                                        <p className="text-md font-semibold text-gray-900 truncate" title={page.name}>
                                            {page.name}
                                        </p>
                                        <div className="flex items-center space-x-1.5 text-gray-500 mt-1">
                                            {page.platform === 'facebook' ? (
                                                <Image src='https://pancake.vn/static/images/facebook-logo.png' alt='Facebook' width={14} height={14} />
                                            ) : page.platform === 'instagram_official' ? (
                                                <Image src='https://pancake.vn/static/images/instagram-icon.png' alt='Instagram' width={14} height={14} />
                                            ) : page.platform === 'tiktok_business_messaging' ? (
                                                <Image src='https://pancake.vn/static/images/Logotiktok3.png' alt='TikTok' width={14} height={14} />
                                            ) : page.platform === 'personal_zalo' ? (
                                                <Image src='https://pancake.vn/static/images/zalo_logov3.png' alt='Zalo' width={14} height={14} />
                                            ) : null}
                                            <h5 className="text-xs truncate">
                                                {page.platform === 'facebook' ? 'Page Facebook' : page.platform === 'instagram_official' ? 'Instagram Official' : page.platform === 'tiktok_business_messaging' ? 'TikTok Business Messaging' : page.platform === 'personal_zalo' ? 'Zalo Personal' : null}
                                            </h5>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 text-gray-500">
                        Không có trang nào để hiển thị.
                    </div>
                )}
            </div>
        </div>
    );
}