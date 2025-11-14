import { customer_data } from "@/data/customers/wraperdata.db";
import DashboardClient from "./dashboard-client";
import { Navbar } from "../nav";
import { service_data } from "@/data/services/wraperdata.db";

export default async function AdminPage() {
    const data = await customer_data();
    const service = await service_data();

    return (
        <>
            <Navbar />
            <DashboardClient initialData={data} service={service} />
        </>
    );
}