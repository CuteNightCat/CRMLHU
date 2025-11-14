"use client"; // Thêm dòng này nếu bạn dùng Next.js App Router

import Link from "next/link";
import { usePathname } from 'next/navigation'; // Dùng cho App Router
// import { useRouter } from 'next/router'; // Dùng cho Pages Router

export default function SettingsLayout({ children }) {
    // Để xác định path hiện tại, chọn 1 trong 2 dòng dưới tùy vào cấu trúc dự án của bạn
    const pathname = usePathname(); // <-- Dành cho Next.js 13+ (App Router)
    // const { pathname } = useRouter(); // <-- Dành cho Next.js cũ (Pages Router)

    const tabs = [
        // Sử dụng các path bạn đã định nghĩa ở yêu cầu trước
        { id: 'services', label: 'Quản lý ngành học', href: '/service' },
        { id: 'cards', label: 'Quản lý thẻ', href: '/label' },
        { id: 'workflow', label: 'Quản lý Workflow', href: '/workflow' },
    ];

    return (
        <div className="bg-white p-4 h-full overflow-hidden rounded-md flex flex-col">
            <p className="font-bold">Cài đặt chung</p>
            <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {tabs.map(tab => {
                        // Kiểm tra xem tab có đang được active không
                        const isActive = pathname === tab.href;

                        return (
                            <Link
                                key={tab.id}
                                href={tab.href}
                                className={`
                                        whitespace-nowrap py-4 px-2 border-b-2 font-medium text-sm
                                        transition-all duration-200 ease-in-out
                                        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-t-md
                                        ${isActive
                                        ? 'border-blue-600 text-blue-600' // Style cho tab active
                                        : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300' // Style cho tab không active
                                    }
                                    `}
                            >
                                {tab.label}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            {/* Nội dung của từng trang sẽ được hiển thị ở đây */}
            <div className="mt-8 flex-1 scroll">
                {children}
            </div>
        </div>
    );
}