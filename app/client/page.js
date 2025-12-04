import { Suspense } from 'react';
import { user_data, label_data, zalo_data } from "@/data/actions/get";
import { form_data, getMessageSources } from '@/data/form_database/wraperdata.db'
import { getCombinedData } from "../actions/customer.actions";
import checkAuthToken from "@/utils/checktoken";
import CustomerView from './index';
import { variant_data } from '../actions/variant.actions';
import { getRunningSchedulesAction } from '../actions/schedule.actions';
import { workflow_data } from '@/data/workflow/wraperdata.db';
import { service_data } from '@/data/services/wraperdata.db';
import { maskPhoneNumber } from '@/function';
import { customer_data } from '@/data/customers/wraperdata.db';

function PageSkeleton() {
    return <div>Đang tải trang...</div>;
}

export default async function Page({ searchParams }) {
    let c = await searchParams
    const user = await checkAuthToken()
    if (!user) return null
    const [customer, initialResult, userAuth, sources, messageSources, label, zalo, users, variant, running, workflow, service] = await Promise.all([
        customer_data(),
        getCombinedData(c),
        user_data({ _id: user.id }),
        form_data(),
        getMessageSources(),
        label_data(),
        zalo_data(),
        user_data({}),
        variant_data(),
        getRunningSchedulesAction(),
        workflow_data(),
        service_data()
    ]);
    const reversedLabel = [...label].reverse();
    const userRoles = Array.isArray(userAuth[0].role) ? userAuth[0].role : [userAuth[0].role];
    const isEnrollmentStaff = userRoles.some(role => ['Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role));
    if (isEnrollmentStaff) {
        const filteredData = initialResult.data.filter(item => {
            if (Array.isArray(item.assignees) && item.assignees.length > 0) {
                return item.assignees.some(
                    assignee => assignee.user && assignee.user._id === userAuth[0]._id
                );
            }
            return false;
        }).map(item => {
            return {
                ...item,
                phonex: maskPhoneNumber(item.phone) // tạo field mới phonex
            };
        });
        initialResult.data = filteredData;
        initialResult.total = filteredData.length;
    }
    // console.log(initialResult);  //🚩
    
    return (
        <Suspense fallback={<PageSkeleton />}>
            <CustomerView
                initialResult={initialResult}
                user={userAuth}
                sources={sources}
                messageSources={messageSources}
                labelData={reversedLabel}
                formData={sources}
                zaloData={zalo}
                users={users}
                variant={variant}
                running={running.data}
                c={c}
                workflow={workflow}
                service={service}
                customer={customer}
            />
        </Suspense>
    );
}