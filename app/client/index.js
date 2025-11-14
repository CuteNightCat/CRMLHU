'use client';
import styles from './index.module.css';
import { useState, Suspense, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import CustomerTable from './ui/table';
import FilterControls from "./ui/filter";
import SettingLabel from "./ui/label";
import SettingData from "./ui/data";
import SettingZalo from './ui/zalo';
import BulkActions from './ui/run';
import RunningActions from './ui/action';
import SettingVariant from './ui/variant';
import SettingZaloRoles from './ui/zalos';
import ActionHistory from './ui/hisotry';
import { reloadCustomers } from '@/data/customers/wraperdata.db';

function TableSkeleton() {
    return (
        <div style={{ height: '500px', background: '#f8f9fa', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Đang tải dữ liệu...
        </div>
    );
}

export default function CustomerView({ customer, c, running, initialResult, user, sources, labelData, formData, zaloData, users, variant, workflow, service }) {
    const router = useRouter();
    const intervalRef = useRef(null);

    const [selectedCustomers, setSelectedCustomers] = useState(new Map());
    const [viewMode, setViewMode] = useState('manage');

    const handleActionComplete = () => setSelectedCustomers(new Map());
    const toggleViewMode = () => setViewMode(prev => prev === 'manage' ? 'view' : 'manage');

    const normalizeRoles = (roles) => (Array.isArray(roles) ? roles : roles ? [roles] : []);
    const enrollmentUserRoles = ['Sale', 'Admin', 'Admin Sale', 'Telesale', 'Care'];
    const enrollmentStaffRoles = ['Sale', 'Admin Sale', 'Telesale', 'Care'];
    const allEnrollmentUsers = useMemo(
        () => users.filter(u => normalizeRoles(u.role).some(role => enrollmentUserRoles.includes(role))),
        [users]
    );
    const isEnrollmentStaff = useMemo(
        () => normalizeRoles(user[0]?.role).some(role => enrollmentStaffRoles.includes(role)),
        [user]
    );

    // Chia lịch thành 2 trường hợp là đang chạy và đã hoàn thành
    const { runningSchedules, historySchedules } = useMemo(() => {
        return running.reduce((acc, schedule) => {
            const stats = schedule.statistics;
            if ((stats.completed + stats.failed) < stats.total) {
                acc.runningSchedules.push(schedule);
            } else {
                acc.historySchedules.push(schedule);
            }
            return acc;
        }, { runningSchedules: [], historySchedules: [] });
    }, [running]);

    // ===== Auto refresh mỗi 5s với router.refresh() =====
    // useEffect(() => {
    //     // Chỉ refresh khi có job đang chạy; nếu muốn luôn refresh thì bỏ điều kiện này
    //     const shouldPoll = true; // hoặc: runningSchedules.length > 0

    //     const startPolling = () => {
    //         if (intervalRef.current || !shouldPoll) return;
    //         intervalRef.current = setInterval(() => {
    //             // Tránh refresh khi tab ẩn để tiết kiệm tài nguyên
    //             if (typeof document !== 'undefined' && document.hidden) return;
    //             router.refresh();
    //         }, 5000);
    //     };

    //     const stopPolling = () => {
    //         if (intervalRef.current) {
    //             clearInterval(intervalRef.current);
    //             intervalRef.current = null;
    //         }
    //     };

    //     // Bật/tắt theo visibility
    //     const onVisibilityChange = () => {
    //         if (document.hidden) {
    //             stopPolling();
    //         } else {
    //             router.refresh(); // refresh ngay khi quay lại tab
    //             startPolling();
    //         }
    //     };

    //     // Bật lần đầu
    //     startPolling();

    //     // Lắng nghe thay đổi visibility + focus
    //     document.addEventListener('visibilitychange', onVisibilityChange);
    //     window.addEventListener('focus', onVisibilityChange);

    //     // Dọn dẹp
    //     return () => {
    //         stopPolling();
    //         document.removeEventListener('visibilitychange', onVisibilityChange);
    //         window.removeEventListener('focus', onVisibilityChange);
    //     };
    // }, [router /* , runningSchedules.length */]);
    // =====================================================

    return (
        <div className={styles.container}>
            {viewMode === 'manage' && (
                <>
                    <div className={styles.filterSection}>
                        <div className={styles.filterHeader}>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <SettingZalo user={user[0]} zalo={zaloData} />
                                <RunningActions user={user} running={runningSchedules} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {!c.type && (
                                    <BulkActions
                                        selectedCustomers={selectedCustomers}
                                        onActionComplete={handleActionComplete}
                                        labels={labelData}
                                        variants={variant}
                                        users={allEnrollmentUsers}
                                        workflows={workflow}
                                        auth={user[0]}
                                    />
                                )}
                                <ActionHistory history={historySchedules} />
                                {!isEnrollmentStaff && (
                                    <>
                                        <SettingZaloRoles data={zaloData} allUsers={allEnrollmentUsers} />
                                        <SettingVariant data={variant} />
                                        <SettingLabel data={labelData} />
                                    </>
                                )}
                                <SettingData data={formData} service={service} customer={customer} />
                            </div>
                        </div>
                    </div>
                    <FilterControls
                        auth={user[0]}
                        zaloAccounts={zaloData}
                        users={allEnrollmentUsers}
                        labels={labelData}
                        sources={sources}
                        service={service}
                    />
                </>
            )}
            <Suspense fallback={<TableSkeleton />}>
                <CustomerTable
                    data={initialResult.data}
                    total={initialResult.total}
                    user={user}
                    selectedCustomers={selectedCustomers}
                    setSelectedCustomers={setSelectedCustomers}
                    viewMode={viewMode}
                    onToggleViewMode={toggleViewMode}
                    zalo={zaloData}
                    service={service}
                />
            </Suspense>
        </div>
    );
}
