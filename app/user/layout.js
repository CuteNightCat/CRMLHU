import checkAuthToken from "@/utils/checktoken"

export const dynamic = 'force-dynamic';

import Layout_Login from '@/app/(auth)/login';
import Nav from '@/components/(layout)/nav';
import '@/styles/all.css'
import '@/styles/font.css';
import air from '@/app/layout.module.css'

export const metadata = {
    title: "Nhân sự",
    description: "Quản lý nhân sự tuyển sinh"
};

export default async function RootLayout({ children }) {
    let user = await checkAuthToken()
    if (!user) { return <Layout_Login /> }
    const nav = <Nav data={user} />
    return (
        <div className={air.layout}>
            {user.role.includes('Admin') || user.role.includes('Manager') || user.role.includes('Admin Sale') ?
                <>
                    {nav}
                    <div className={air.main}>
                        {children}
                    </div></> :

                <>
                    {nav}
                    <div className="flex_center" style={{ height: '100%', width: '100%' }}>
                        <h4 style={{ fontStyle: 'italic' }}>Bạn không có quyền truy cập trang này</h4>
                    </div>
                </>
            }

        </div>
    );
}
