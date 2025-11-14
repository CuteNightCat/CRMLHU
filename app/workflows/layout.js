import checkAuthToken from "@/utils/checktoken"

export const dynamic = 'force-dynamic';

import Layout_Login from '@/app/(auth)/login';
import Nav from '@/components/(layout)/nav';
import '@/styles/all.css'
import '@/styles/font.css';
import air from '@/app/layout.module.css'

export const metadata = {
    title: "Quy trình",
    description: "Điều chỉnh quy trình hệ thống"
};

export default async function RootLayout({ children }) {
    let user = await checkAuthToken()
    if (!user) { return <Layout_Login /> }
    return (
        <div className={air.layout}>
            <div className={air.nav}>
                <Nav data={user} />
            </div>
            <div className={air.main}>
                {user.role.includes('Admin') ? <>{children}</> :
                    <div className="flex_center" style={{ height: '100%', width: '100%' }}>
                        <h4 style={{ fontStyle: 'italic' }}>Bạn không có quyền truy cập trang này</h4>
                    </div>
                }
            </div>
        </div>
    );
}
