import checkAuthToken from "@/utils/checktoken"

export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import Layout_Login from '@/app/(auth)/login';
import Nav from '@/components/(layout)/nav';
import '@/styles/all.css'
import '@/styles/font.css';
import air from '@/app/layout.module.css'

export const metadata = {
    title: "Tuyển sinh",
    description: "Quản lý tuyển sinh"
};

export default async function RootLayout({ children }) {
    let user = await checkAuthToken()
    if (!user) {
        return <Layout_Login />
    }
    return (
        <div className={air.layout}>
            <div className={air.nav}>
                <Nav data={user} />
            </div>
            <div className={air.main}>
                {children}
            </div>
        </div>
    );
}
