import checkAuthToken from "@/utils/checktoken"

export const dynamic = 'force-dynamic';
import Layout_Login from '@/app/(auth)/login';
import Nav from '@/components/(layout)/nav';
import '@/styles/all.css'
import '@/styles/font.css';
import air from '@/app/layout.module.css'
import { NotificationProvider } from '@/contexts/page_pancake';
import RealtimeGate from '@/components/RealtimeGate'

export const metadata = {
    title: "CRM LHU Tin nhắn",
    description: "Quản lý tin nhắn"
};

export default async function RootLayout({ children }) {
    let user = await checkAuthToken()
    if (!user) {
        return <Layout_Login />
    }
    return (
        <NotificationProvider>
            <RealtimeGate />
            <div className={air.layout}>
                <div className={air.nav}>
                    <Nav data={user} />
                </div>
                <div className={air.main}>
                    {children}
                </div>
            </div>
        </NotificationProvider>
    );
}
