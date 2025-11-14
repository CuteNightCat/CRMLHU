import { Suspense } from 'react';
import { appointment_data } from '@/data/appointment_db/wraperdata.db';
import checkAuthToken from "@/utils/checktoken";
import CalendarView from './ui/calendar';
import { user_data } from '@/data/actions/get';
import Loading from '@/components/(ui)/(loading)/loading';

function LoadingCalendar() {
    return (
        <div className="loadingOverlay">
            <Loading content={<h5 style={{ color: 'white' }}>Đang tải dữ liệu...</h5>} />
        </div>
    );
}

export default async function CalendarPage({ searchParams }) {
    searchParams = await searchParams
    const user = await checkAuthToken();
    if (!user) return null;

    // Fetch user data to get complete information
    const userDetails = await user_data({ _id: user.id });
    const userInfo = userDetails[0];

    // Determine if user has admin privileges
    const isAdmin = userInfo.role.includes('Admin') || userInfo.role.includes('Admin Sale');

    // Build filter object based on user permissions
    let filter = {};

    // If not admin, only show appointments created by the current user
    if (!isAdmin) {
        filter.createdBy = user.id;
    }

    // Add any additional filters from search params
    if (searchParams.status) {
        filter.status = searchParams.status;
    }

    if (searchParams.startDate && searchParams.endDate) {
        filter.dateRange = {
            start: new Date(searchParams.startDate),
            end: new Date(searchParams.endDate)
        };
    }

    if (searchParams.customerId) {
        filter.customerId = searchParams.customerId;
    }
    
    // Fetch appointments with filters
    const appointments = await appointment_data(filter);

    // Get all users for assignment dropdown
    const users = isAdmin ? await user_data({}) : [];

    return (
        <Suspense fallback={<LoadingCalendar />}>
            <CalendarView
                initialAppointments={appointments}
                currentUser={userInfo}
                isAdmin={isAdmin}
                users={users}
            />
        </Suspense>
    );
}