'use client';

// Import các hook cần thiết từ React để quản lý state, side effects, và tối ưu hóa
import { useState, useEffect, useMemo, startTransition, useRef } from 'react';
// Import các hook từ Next.js để điều hướng và lấy thông tin đường dẫn hiện tại
import { useRouter, usePathname } from 'next/navigation';

// Import file CSS Module để áp dụng style cục bộ cho component
import air from './index.module.css';
// Import các component SVG icon đã được định nghĩa sẵn
import { Svg_Dark, Svg_Left, Svg_Logout, Svg_Menu, Svg_Mode, Svg_Setting, Svg_Chart, Svg_Canlendar, Svg_Profile } from '../../(icon)/svg';
// Import các component UI tái sử dụng
import Menu from '../../(ui)/(button)/menu';
import Switch from "@/components/(ui)/(button)/swith";
import WrapIcon from '../../(ui)/(button)/hoveIcon';
import Loading from '@/components/(ui)/(loading)/loading';
// Import các component cơ bản của Next.js
import Link from 'next/link';
import Image from 'next/image';
// Import các component và hàm chức năng khác
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import { driveImage } from '@/function';
// Import icon từ thư viện react-icons
import { FaBusinessTime } from "react-icons/fa6";
import { IoChatbubbles } from "react-icons/io5";
import { IoIosSettings } from "react-icons/io";
import { IoSchoolOutline } from "react-icons/io5";
// Hằng số định nghĩa chiều cao của mỗi mục nav, dùng để tính toán hiệu ứng highlight
const ITEM_HEIGHT = 82;

// Mảng chứa TẤT CẢ các mục điều hướng có thể có trong ứng dụng.
// Việc định nghĩa trước giúp dễ quản lý và phân quyền.
const ALL_NAV_ITEMS = [
  { href: '/calendar', icon: <Svg_Canlendar h={20} w={20} c={'var(--text-secondary)'} />, content: 'Lịch hẹn' },
  { href: '/pancake', icon: <IoChatbubbles h={20} w={20} c={'var(--text-secondary)'} />, content: 'Nhắn tin' },

  {
    href: '/client',
    icon: (
      <div style={{ marginBottom: 1 }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" height={20} width={20} fill={'var(--text-secondary)'} >
          <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512l388.6 0c10 0 18.8-4.9 24.2-12.5l-99.2-99.2c-14.9-14.9-23.3-35.1-23.3-56.1l0-33c-15.9-4.7-32.8-7.2-50.3-7.2l-91.4 0zM384 224c-17.7 0-32 14.3-32 32l0 82.7c0 17 6.7 33.3 18.7 45.3L478.1 491.3c18.7 18.7 49.1 18.7 67.9 0l73.4-73.4c18.7-18.7 18.7-49.1 0-67.9L512 242.7c-12-12-28.3-18.7-45.3-18.7L384 224zm24 80a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z" />
        </svg>
      </div>
    ),
    content: 'Tuyển sinh'
  },
  { href: '/admin', icon: <Svg_Chart h={20} w={20} c={'var(--text-secondary)'} />, content: 'Thống kê' },
  { href: '/user', icon: <Svg_Profile h={20} w={20} c={'var(--text-secondary)'} />, content: 'Nhân sự' },
  { href: '/service', icon: <IoIosSettings style={{ width: 24, height: 24 }} />, content: 'Cài đặt' },
  { href: '/guide', icon: <IoSchoolOutline style={{ width: 20, height: 20, color: 'var(--text-secondary)' }} />, content: 'Hướng dẫn' },
];

// Định nghĩa component Nav, nhận prop `data` chứa thông tin người dùng (bao gồm cả `role`)
export default function Nav({ data }) {
  // Hooks để lấy thông tin đường dẫn và router để điều hướng
  const pathname = usePathname();
  const router = useRouter();
  // Ref để tham chiếu đến DOM element của container chứa các mục nav
  const navContainerRef = useRef(null);

  // --- LOGIC PHÂN QUYỀN ---
  // Lấy quyền đầu tiên từ mảng `role` của người dùng.
  const userRole = data?.role?.[0];
  // `useMemo` được dùng để tính toán danh sách nav items chỉ khi `userRole` thay đổi, tránh re-render không cần thiết.
  const navItemsForRole = useMemo(() => {
    // Định nghĩa các quyền và danh sách `href` tương ứng
    const rolePermissions = {
      'Sale': ['/client', '/pancake', '/calendar', '/guide'],
      'Telesale': ['/client', '/pancake', '/calendar', '/guide'],
      'Care': ['/client', '/pancake', '/calendar', '/guide'],
      'Docter': ['/guide'],
      'Admin Sale': ['/user', '/client', '/pancake', '/admin', '/calendar', '/guide'],
    };
    // Nếu là Manager hoặc Admin thì trả về tất cả các mục
    if (userRole === 'Manager' || userRole === 'Admin') {
      return ALL_NAV_ITEMS;
    }
    // Lấy danh sách href được phép dựa trên quyền, nếu không có thì trả về mảng rỗng
    const allowedHrefs = rolePermissions[userRole] || [];
    // Lọc danh sách nav tổng để chỉ giữ lại những mục được phép
    return ALL_NAV_ITEMS.filter(item => allowedHrefs.includes(item.href));
  }, [userRole]); // Dependency array: chỉ chạy lại khi `userRole` thay đổi

  // State để lưu trữ danh sách các mục nav sau khi đã sắp xếp (nếu có từ localStorage)
  const [orderedItems, setOrderedItems] = useState(navItemsForRole);

  // --- LOGIC CHO RESPONSIVE MOBILE ---
  // State để quản lý trạng thái đóng/mở của menu trên mobile
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);

  // `useEffect` này sẽ tự động đóng menu mobile khi người dùng điều hướng sang trang khác
  useEffect(() => {
    if (isMobileNavOpen) {
      setMobileNavOpen(false);
    }
  }, [pathname]); // Dependency array: chỉ chạy lại khi `pathname` thay đổi

  // --- LOGIC CHO POPUP TÌM KIẾM ---
  const [isSearchPopupOpen, setIsSearchPopupOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- LOGIC SẮP XẾP VÀ LOCALSTORAGE ---
  // `useEffect` này đọc thứ tự các mục nav đã lưu trong localStorage và áp dụng nó.
  useEffect(() => {
    const savedOrder = localStorage.getItem('navItemOrder');
    if (savedOrder) {
      try {
        const orderedHrefs = JSON.parse(savedOrder);
        // Sắp xếp lại danh sách `navItemsForRole` dựa trên thứ tự đã lưu
        const newOrderedItems = orderedHrefs
          .map(href => navItemsForRole.find(item => item.href === href))
          .filter(Boolean); // Lọc bỏ các mục `null` hoặc `undefined`
        // Đảm bảo các mục mới (nếu có) được thêm vào cuối danh sách
        navItemsForRole.forEach(item => {
          if (!newOrderedItems.find(i => i.href === item.href)) {
            newOrderedItems.push(item);
          }
        });
        setOrderedItems(newOrderedItems);
      } catch (e) {
        console.error("Failed to parse nav item order from localStorage", e);
        setOrderedItems(navItemsForRole); // Nếu lỗi, dùng thứ tự mặc định
      }
    } else {
      // Nếu không có dữ liệu trong localStorage, dùng thứ tự mặc định
      setOrderedItems(navItemsForRole);
    }
  }, [navItemsForRole]); // Dependency array: chạy lại khi danh sách nav theo quyền thay đổi

  useEffect(() => {
    if (!isSearchPopupOpen) {
      setSearchTerm('');
      setSearchResults([]);
    }
  }, [isSearchPopupOpen]);

  // Biến `itemsToDisplay` sẽ là danh sách cuối cùng được render ra giao diện
  const itemsToDisplay = orderedItems;

  // --- LOGIC THANH HIGHLIGHT ---
  // `useMemo` để tính toán index của mục đang active, chỉ chạy lại khi `pathname` hoặc `itemsToDisplay` thay đổi
  const activeIndex = useMemo(() => {
    const activeItem = itemsToDisplay.find(item => pathname.startsWith(item.href) && item.href !== '/') ||
      (pathname === '/' && itemsToDisplay.find(item => item.href === '/'));
    return activeItem ? itemsToDisplay.findIndex(i => i.href === activeItem.href) : -1;
  }, [pathname, itemsToDisplay]);

  // Tính toán vị trí Y của thanh highlight
  const targetOffset = activeIndex * ITEM_HEIGHT;
  // State để quản lý vị trí hiện tại của thanh highlight (để tạo hiệu ứng chuyển động)
  const [barOffset, setBarOffset] = useState(targetOffset);

  useEffect(() => {
    setBarOffset(targetOffset);
  }, [targetOffset]);

  // --- LOGIC CHO MENU "THÊM" VÀ DARK MODE ---
  const [activeMenu, setActiveMenu] = useState(1); // 1: menu chính, 2: menu đổi giao diện
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // `useEffect` chạy một lần khi component mount để đọc theme từ localStorage
  useEffect(() => {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Hàm để chuyển đổi giữa theme sáng và tối
  const toggleTheme = () => {
    setIsDark((prev) => {
      const newTheme = !prev;
      if (newTheme) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      return newTheme;
    });
  };

  // --- LOGIC ĐĂNG XUẤT ---
  const [load, setload] = useState(false);
  const logout = async () => {
    setload(true);
    try {
      await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setload(false);
      window.location.reload(); // Tải lại trang sau khi đăng xuất
    }
  };

  // Hàm xử lý sự kiện click vào một mục nav
  const handleNavItemClick = (href) => {
    if (href === '/search') { // Giả sử có một mục nav để mở popup tìm kiếm
      setIsSearchPopupOpen(true);
    } else {
      // `startTransition` giúp cập nhật UI mà không block các tương tác khác
      startTransition(() => router.push(href));
    }
  };

  // Hàm render nội dung cho popup tìm kiếm
  const renderSearchContent = () => (
    <div className={air.searchContainer}>
      <input
        type="text"
        placeholder="Tìm kiếm theo tên..."
        className='input'
        value={searchTerm}
        style={{ width: 'calc(100% - 24px)', marginBottom: 8 }}
        onChange={(e) => setSearchTerm(e.target.value)}
        autoFocus
      />
      <div className={air.resultsContainer}>
        {isSearching ? (
          <div className={air.searchLoading}>
            <Loading content={<p className='text_6_400'>Đang tìm kiếm...</p>} />
          </div>
        ) : (
          searchResults.map((result) => (
            <Link href={`/${result._id}`} className={air.ItemWrap} key={result._id} onClick={() => setIsSearchPopupOpen(false)}>
              <div style={{ width: 36, height: 36, marginRight: 8, borderRadius: 3, overflow: 'hidden' }}>
                <Image width={36} height={36} src={driveImage(result.Avt) || 'https://lh3.googleusercontent.com/d/1iq7y8VE0OyFIiHmpnV_ueunNsTeHK1bG'} alt={result.Name || ''} style={{ objectFit: 'cover' }} />
              </div>
              <div className={air.searchResultItem}>
                <p className={air.resultName}>{result.Name || result.name}</p>
                <p className={air.resultSubtitle}>{result.type}</p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );

  // JSX cho menu chính
  const menuItems = (
    <div style={{ listStyle: 'none', width: 180, borderRadius: 12, background: 'var(--bg-secondary)', boxShadow: 'var(--boxshaw2)', marginBottom: 8 }}>
      <div style={{ padding: 8, gap: 3 }} className='flex_col'>
        <Link href={'/setting'} className={`${air.menu_li} text_5_400`}>
          <Svg_Setting w={16} h={16} c={'var(--text-secondary)'} />Cài đặt
        </Link>
        <p className={`${air.menu_li} text_5_400`} onClick={() => setActiveMenu(2)}>
          <Svg_Mode w={16} h={16} c={'var(--text-secondary)'} />Giao diện
        </p>
      </div>
      <div style={{ padding: 8, borderTop: 'thin solid var(--border-color)' }} onClick={logout}>
        <p className={`${air.menu_li} ${air.logout} text_5_400`}>
          <Svg_Logout w={16} h={16} c={'white'} />Đăng xuất
        </p>
      </div>
    </div>
  );

  // JSX cho menu chọn giao diện
  const menuMode = (
    <div style={{ listStyle: 'none', width: 210, borderRadius: 12, background: 'var(--bg-secondary)', boxShadow: 'var(--boxshaw2)', marginBottom: 8 }}>
      <div style={{ padding: 8, borderBottom: 'thin solid var(--border-color)', justifyContent: 'start', gap: 8 }} className='flex_center'>
        <div onClick={() => setActiveMenu(1)}>
          <WrapIcon icon={<Svg_Left w={12} h={12} c={'var(--text-secondary)'} />} w={'32px'} />
        </div>
        <h5>Chế độ giao diện</h5>
        <Svg_Mode w={16} h={16} c={'var(--text-secondary)'} />
      </div>
      <div style={{ padding: 8 }}>
        <div className={`${air.menu_li} text_5_400`} onClick={toggleTheme}>
          <div className='flex_center'>
            <Svg_Dark w={18} h={18} c={'var(--text-secondary)'} />
            <h6 style={{ flex: 1, marginLeft: 8 }}>Giao diện Tối</h6>
          </div>
          <Switch checked={isDark} size="small" />
        </div>
      </div>
    </div>
  );

  // Tạo chuỗi className một cách linh động.
  // Dựa vào state `isMobileNavOpen` để thêm class `mobileNavOpen`
  const navClassName = `${air.nav} ${isMobileNavOpen ? air.mobileNavOpen : ''}`;

  return (
    <>
      {/* Phần header và overlay này giờ nằm BÊN NGOÀI thanh nav chính */}
      <div className={air.mobileHeader}>
        <button className={air.mobileMenuButton} onClick={() => setMobileNavOpen(true)}>
          <Svg_Menu w={24} h={24} c={'var(--text-primary)'} />
        </button>
        <h3 className='text_w_600' style={{ color: 'var(--main_d)' }}>LHU</h3>
      </div>

      {isMobileNavOpen && (
        <div className={air.overlay} onClick={() => setMobileNavOpen(false)}></div>
      )}

      {/* Đây là thanh nav chính, sẽ được trượt ra/vào */}
      <div className={navClassName}>
        <div className='flex_col' style={{ justifyContent: 'space-between', height: '100%', alignItems: 'center' }}>
          <div className={`flex_center ${air.desktopLogo}`} style={{ height: 100, width: 100, minHeight: 100 }}>
            <h3 className='text_w_600' style={{ color: 'var(--main_d)' }}>LHU</h3>
          </div>
          <div className={air.container} ref={navContainerRef}>
            {activeIndex !== -1 && (
              <div
                className={air.highlight}
                style={{ transform: `translateY(${barOffset}px)` }}
              />
            )}
            {itemsToDisplay.map(({ href, icon, content }) => (
              <div
                key={href}
                className={air.navItem}
                onClick={() => handleNavItemClick(href)}
              >
                {icon}
                <p className={air.navText}>{content}</p>
              </div>
            ))}
          </div>

          <FlexiblePopup
            open={isSearchPopupOpen}
            onClose={() => setIsSearchPopupOpen(false)}
            renderItemList={renderSearchContent}
            title="Tìm kiếm"
            width={'400px'}
          />

          <div>
            <Menu
              isOpen={isMenuOpen}
              menuItems={activeMenu === 1 ? menuItems : menuMode}
              menuPosition="top"
              customButton={
                <div className={air.navItem} style={{ marginBottom: 8 }}>
                  <Svg_Menu w={22} h={22} c={'var(--text-primary)'} />
                  <p className={air.navText} style={{ marginTop: 2 }}>Thêm</p>
                </div>
              }
              onOpenChange={(isOpen) => {
                setIsMenuOpen(isOpen);
                if (!isOpen) setActiveMenu(1);
              }}
            />
          </div>
        </div>
        {load && (
          <div className={air.loading}>
            <Loading content={<p className='text_6_400' style={{ color: 'white' }}>Đang đăng xuất...</p>} />
          </div>
        )}
      </div>
    </>
  );
}