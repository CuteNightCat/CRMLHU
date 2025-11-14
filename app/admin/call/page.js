import { call_data } from "@/data/call/wraperdata.db";
import DashboardClient from "./dashboard-client";
import { Navbar } from "../nav";

export default async function AdminPage() {
    const data = await call_data();
    console.log(data);
    
    return (
        <>
            <Navbar />
            <DashboardClient initialData={data} />
        </>
    );
}