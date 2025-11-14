import { appointment_data_all } from "@/data/appointment_db/wraperdata.db";
import DashboardClient from "./dashboard-client";
import { Navbar } from "../nav";
import { user_data } from "@/data/actions/get";

export default async function AdminPage() {
    const data = await appointment_data_all();
    const user = await user_data({})
    console.log(data);
    return (
        <>
            <Navbar />
            <DashboardClient initialData={data} user={user} />
        </>
    );
}