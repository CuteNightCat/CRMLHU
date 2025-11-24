// components/FilterControls/index.jsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, useMemo, useRef } from 'react';
import styles from './index.module.css';
import Menu from '@/components/(ui)/(button)/menu';

export default function FilterControls({
    sources = [],
    messageSources = [],
    users = [],
    // Bạn có thể truyền "services" (mới) hoặc "service" (cũ). Ưu tiên "services".
    services: servicesProp = [],
    service = [],
    auth = { role: [] },
}) {
    const services = servicesProp.length ? servicesProp : service;
    
    // Nguồn đặc biệt: "Trực tiếp"
    const specialSources = [
        { _id: 'Trực tiếp', name: 'Trực tiếp', isSpecialSource: true }
    ];

    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();
    const searchTimeout = useRef(null);

    // Local state cho bộ lọc ngày; chỉ áp dụng khi người dùng nhấn Enter
    const [startDateLocal, setStartDateLocal] = useState(searchParams.get('startDate') || '');
    const [endDateLocal, setEndDateLocal] = useState(searchParams.get('endDate') || new Date().toISOString().split('T')[0]);

    const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
    const [isPipelineStatusMenuOpen, setIsPipelineStatusMenuOpen] = useState(false);
    const [isTagsMenuOpen, setIsTagsMenuOpen] = useState(false);
    const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);

    const hasEnrollmentRole = useMemo(() => (
        Array.isArray(auth?.role) && auth.role.some(r => ['Sale', 'Admin Sale', 'Telesale', 'Care'].includes(r))
    ), [auth?.role]);

    const createURL = useCallback((paramsToUpdate) => {
        const params = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(paramsToUpdate)) {
            if (value || value === false || value === 0) {
                params.set(key, String(value));
            } else {
                params.delete(key);
            }
        }
        params.set('page', '1');
        replace(`${pathname}?${params.toString()}`);
    }, [searchParams, pathname, replace]);

    const handleSearch = useCallback((term) => {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            createURL({ query: term });
        }, 500);
    }, [createURL]);

    // Trạng thái cứng đầy đủ
    const staticOptions = useMemo(() => ({
        pipelineStatus: [
            { value: 'new_unconfirmed_1', name: 'Data mới' },
            { value: 'missing_info_1', name: 'Thiếu thông tin' },
            { value: 'not_valid_1', name: 'Không hợp lệ' },
            { value: 'duplicate_merged_1', name: 'Trùng lặp (đã gộp)' },
            { value: 'rejected_immediate_1', name: 'Từ chối ngay' },
            { value: 'valid_1', name: 'Hợp lệ (chờ xử lý)' },
            { value: 'msg_success_2', name: 'Gửi tin nhắn thành công' },
            { value: 'msg_error_2', name: 'Gửi tin nhắn thất bại' },
            { value: 'telesale_TuVan3', name: 'Đã phân bổ: Telesale' },
            { value: 'CareService3', name: 'Đã phân bổ: Care' },
            { value: 'undetermined_3', name: 'Chưa phân bổ' },
            { value: 'consulted_pending_4', name: 'Đã tư vấn, chờ quyết định' },
            { value: 'scheduled_unconfirmed_4', name: 'Đã lên lịch, chưa xác nhận' },
            { value: 'callback_4', name: 'Yêu cầu gọi lại' },
            { value: 'not_interested_4', name: 'Không quan tâm' },
            { value: 'no_contact_4', name: 'Không liên lạc được' },
            { value: 'confirmed_5', name: 'Lịch hẹn đã xác nhận' },
            { value: 'postponed_5', name: 'Lịch hẹn đã hoãn' },
            { value: 'canceled_5', name: 'Lịch hẹn đã hủy' },
            { value: 'serviced_completed_6', name: 'Đăng ký đã hoàn tất' },
            { value: 'serviced_in_progress_6', name: 'Đăng ký đang xử lý' },
            { value: 'rejected_after_consult_6', name: 'Từ chối sau tư vấn' },
        ],
        zaloPhase: [
            { value: 'welcome', name: 'Chào mừng' },
            { value: 'nurturing', name: 'Nuôi dưỡng' },
            { value: 'pre_surgery', name: 'Trước tuyển sinh' },
            { value: 'post_surgery', name: 'Sau tuyển sinh' },
            { value: 'longterm', name: 'Dài hạn' },
        ],
    }), []);

    const getSelectedName = useCallback((param, data, defaultText, keyField = '_id', nameField = 'name') => {
        const value = searchParams.get(param);
        if (!value) return defaultText;
        if (param === 'tags' && value === 'null') return 'Chưa xác định';
        
        // Kiểm tra nguồn đặc biệt trước (cho param 'source')
        if (param === 'source') {
            const specialSource = specialSources.find((item) => String(item[keyField]) === value);
            if (specialSource) return specialSource[nameField];
        }
        
        // Kiểm tra trong data được truyền vào
        let selected = data.find((item) => String(item[keyField]) === value);
        
        // Nếu không tìm thấy trong data và là param 'source', tìm trong messageSources
        if (!selected && param === 'source') {
            selected = messageSources.find((item) => String(item[keyField]) === value);
        }
        
        return selected ? selected[nameField] : defaultText;
    }, [searchParams, messageSources, specialSources]);

    return (
        <div className={styles.wrapper}>
            {/* Hàng 1 */}
            <div className={styles.filterRow}>
                <div style={{ flex: 1, display: 'flex' }}>
                    <input
                        type="text"
                        placeholder="Tìm theo tên, SĐT..."
                        className="input"
                        style={{ width: '100%' }}
                        defaultValue={searchParams.get('query') || ''}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                </div>

                {/* Trạng thái chăm sóc */}
                <div style={{ flex: 1 }}>
                    <Menu
                        isOpen={isPipelineStatusMenuOpen}
                        onOpenChange={setIsPipelineStatusMenuOpen}
                        customButton={
                            <div className="input text_6_400">
                                {getSelectedName('pipelineStatus', staticOptions.pipelineStatus, 'Trạng thái chăm sóc', 'value', 'name')}
                            </div>
                        }
                        menuItems={
                            <div className={`${styles.menulist} scroll`}>
                                <p className="text_6_400" onClick={() => { createURL({ pipelineStatus: '' }); setIsPipelineStatusMenuOpen(false); }}>
                                    Tất cả trạng thái
                                </p>
                                {staticOptions.pipelineStatus.map((s) => (
                                    <p key={s.value} className="text_6_400" onClick={() => { createURL({ pipelineStatus: s.value }); setIsPipelineStatusMenuOpen(false); }}>
                                        {s.name}
                                    </p>
                                ))}
                            </div>
                        }
                        menuPosition="bottom"
                    />
                </div>

                {/* Người phụ trách */}
                {!hasEnrollmentRole && (
                    <div style={{ flex: 1 }}>
                        <Menu
                            isOpen={isAssigneeMenuOpen}
                            onOpenChange={setIsAssigneeMenuOpen}
                            customButton={<div className="input text_6_400">{getSelectedName('assignee', users, 'Người phụ trách')}</div>}
                            menuItems={
                                <div className={styles.menulist}>
                                    <p className="text_6_400" onClick={() => { createURL({ assignee: '' }); setIsAssigneeMenuOpen(false); }}>
                                        Tất cả
                                    </p>
                                    {users.map((u) => (
                                        <p key={u._id} className="text_6_400" onClick={() => { createURL({ assignee: u._id }); setIsAssigneeMenuOpen(false); }}>
                                            {u.name}
                                        </p>
                                    ))}
                                </div>
                            }
                            menuPosition="bottom"
                        />
                    </div>
                )}
            </div>

            {/* Hàng 2 */}
            <div className={styles.filterRow}>
                {/* Nguồn */}
                <div style={{ flex: 1 }}>
                    <Menu
                        isOpen={isSourceMenuOpen}
                        onOpenChange={setIsSourceMenuOpen}
                        customButton={
                            <div className="input text_6_400">
                                {getSelectedName('source', [...sources, ...specialSources, ...messageSources], 'Tất cả nguồn')}
                            </div>
                        }
                        menuItems={
                            <div className={`${styles.menulist} scroll`}>
                                <p className="text_6_400" onClick={() => { createURL({ source: '' }); setIsSourceMenuOpen(false); }}>
                                    Tất cả nguồn
                                </p>
                                
                                {/* Danh sách nguồn Form */}
                                {sources.map((s) => (
                                    <p key={s._id} className="text_6_400" onClick={() => { createURL({ source: s._id }); setIsSourceMenuOpen(false); }}>
                                        {s.name}
                                    </p>
                                ))}
                                
                                {/* Nguồn đặc biệt */}
                                {specialSources.map((s) => (
                                    <p key={s._id} className="text_6_400" onClick={() => { createURL({ source: s._id }); setIsSourceMenuOpen(false); }}>
                                        {s.name}
                                    </p>
                                ))}
                                
                                {/* Danh sách nguồn Tin nhắn */}
                                {messageSources.map((s) => (
                                    <p key={s._id} className="text_6_400" onClick={() => { createURL({ source: s._id }); setIsSourceMenuOpen(false); }}>
                                        {s.name}
                                    </p>
                                ))}
                            </div>
                        }
                        menuPosition="bottom"
                    />
                </div>

                {/* Ngành học quan tâm (tags theo ObjectId) */}
                <div style={{ flex: 1 }}>
                    <Menu
                        isOpen={isTagsMenuOpen}
                        onOpenChange={setIsTagsMenuOpen}
                        customButton={<div className="input text_6_400">{getSelectedName('tags', services, 'Ngành học quan tâm', '_id', 'name')}</div>}
                        menuItems={
                            <div className={styles.menulist}>
                                <p className="text_6_400" onClick={() => { createURL({ tags: '' }); setIsTagsMenuOpen(false); }}>
                                    Tất cả ngành học
                                </p>
                                {services.map((t) => (
                                    <p key={t._id} className="text_6_400" onClick={() => { createURL({ tags: t._id }); setIsTagsMenuOpen(false); }}>
                                        {t.name}
                                    </p>
                                ))}
                                <p className="text_6_400" onClick={() => { createURL({ tags: 'null' }); setIsTagsMenuOpen(false); }}>
                                    Chưa xác định
                                </p>
                            </div>
                        }
                        menuPosition="bottom"
                    />
                </div>

                {/* Khoảng ngày */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <input
                        type="date"
                        className="input"
                        value={startDateLocal}
                        onChange={(e) => setStartDateLocal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createURL({ startDate: startDateLocal, endDate: endDateLocal }); }}
                        style={{ flex: 1 }}
                    />
                    <h5>đến</h5>
                    <input
                        type="date"
                        className="input"
                        value={endDateLocal}
                        onChange={(e) => setEndDateLocal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createURL({ startDate: startDateLocal, endDate: endDateLocal }); }}
                        style={{ flex: 1 }}
                    />
                </div>
            </div>
        </div>
    );
}
