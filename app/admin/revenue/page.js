import { customer_data } from "@/data/customers/wraperdata.db";
import DashboardClient from "./dashboard-client";
import { Navbar } from "../nav";
import { user_data } from "@/data/actions/get";

export default async function AdminPage() {
    const data = await customer_data();
    const users = await user_data({});
    console.log(users);
    
    return (
        <>
            <Navbar />
            <DashboardClient initialData={data} users={users} />
        </>
    );
}