import checkAuthToken from "@/utils/checktoken"

export const dynamic = 'force-dynamic';
import Layout_Login from '@/app/(auth)/login';
import Nav from '@/components/(layout)/nav';
import '@/styles/all.css'
import '@/styles/font.css';
import air from '@/app/layout.module.css'
import SettingsPage from "../components/nav";

export const metadata = {
    title: "CRM LHU Nhãn",
    description: "Quản lý nhãn ngành học"
};

export default async function RootLayout({ children }) {
    let user = await checkAuthToken()
    if (!user) {
        return <Layout_Login />
    }
    if (!user.role.includes('Admin') && !user.role.includes('Manager')) {
        return (
            <div className="flex_center" style={{ height: '100%', width: '100%' }}>
                <h4 style={{ fontStyle: 'italic' }}>Bạn không có quyền truy cập trang này</h4>
            </div>
        )
    }
    return (
        <div className={air.layout}>
            <div className={air.nav}>
                <Nav data={user} />
            </div>
            <div className={air.main}>
                <SettingsPage>
                    {children}
                </SettingsPage>
            </div>
        </div>
    );
}
