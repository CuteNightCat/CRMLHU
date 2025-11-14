import { form_data } from "@/data/form_database/wraperdata.db";
import Client from "./ui/main";
import { service_data } from "@/data/services/wraperdata.db";

export default async function FormPage({ searchParams }) {
    const { id } = await searchParams;
    const data = await form_data(id);
    const service = await service_data();

    return (
        <div style={{ background: '#ebffff', padding: '1rem' }}>
            <Client id={data} service={service} />
        </div>

    );
}   