'use client'; // Cần 'use client' để sử dụng hook usePathname cho active link

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, BarChart3, GitBranch, Share2, Users, CalendarClock, DollarSign } from 'lucide-react';

// Danh sách các tab trên navbar
const navLinks = [
    { name: 'Nguồn data', href: '/admin/data-reception', icon: Share2 },
    { name: 'Hành dộng', href: '/admin/action', icon: BarChart3 },
    { name: 'Phân bổ', href: '/admin/allocation', icon: GitBranch },
    { name: 'Chăm sóc', href: '/admin/call', icon: Users },
    { name: 'Thống kê Lịch hẹn', href: '/admin/appointment-stats', icon: CalendarClock },
    { name: 'Doanh thu', href: '/admin/revenue', icon: DollarSign },
];

export function Navbar() {
    const pathname = usePathname();
    return (
        <nav className="bg-white shadow-md sticky top-0 z-50 rounded-sm">
            <div className="container mx-auto px-4">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center">
                        <span className="font-bold text-xl text-gray-800">CRM Dashboard</span>
                    </div>
                    {/* Thanh điều hướng cho màn hình lớn */}
                    <div className="hidden md:block">
                        <div className="ml-10 flex items-baseline space-x-4">
                            {navLinks.map((link) => {
                                const isActive = pathname === link.href;
                                return (
                                    <Link key={link.name} href={link.href}>
                                        <div className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${isActive
                                            ? 'bg-blue-600 text-white'
                                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                            }`}>
                                            <link.icon className="mr-2 h-4 w-4" />
                                            {link.name}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                    {/* Bạn có thể thêm nút menu cho mobile tại đây nếu cần */}
                </div>
            </div>
            {/* Thanh điều hướng cho màn hình nhỏ - Dạng scroll ngang */}
            <div className="md:hidden bg-gray-50 border-t border-b overflow-x-auto">
                <div className="px-2 py-2 flex space-x-2">
                    {navLinks.map((link) => {
                        const isActive = pathname === link.href;
                        return (
                            <Link key={link.name} href={link.href}>
                                <div className={`flex-shrink-0 flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${isActive
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                                    }`}>
                                    <link.icon className="mr-2 h-4 w-4" />
                                    {link.name}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
