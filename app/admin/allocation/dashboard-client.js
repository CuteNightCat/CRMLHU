'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, Title } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import Popup from '@/components/ui/popup.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    Users, UserCheck, History, RefreshCw, ChevronDown, Check,
    Phone, Mail, MapPin, User, Calendar
} from 'lucide-react';

ChartJS.register(ArcElement, Tooltip, Legend, Title);

/* ======================= Listbox (Dropdown) ======================= */
function Listbox({ label, options, value, onChange, placeholder = 'Chọn...', buttonClassName = '' }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const listRef = useRef(null);
    const [active, setActive] = useState(-1);

    const current = useMemo(
        () => options.find(o => o.value === value) || { label: placeholder, value: undefined },
        [options, value, placeholder]
    );

    useEffect(() => {
        function onClickOutside(e) {
            if (!open) return;
            if (btnRef.current?.contains(e.target)) return;
            if (listRef.current?.contains(e.target)) return;
            setOpen(false);
        }
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    const handleKeyDown = (e) => {
        if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setOpen(true);
            setActive(Math.max(0, options.findIndex(o => o.value === value)));
            return;
        }
        if (!open) return;

        if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(prev => (prev + 1) % options.length); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(prev => (prev - 1 + options.length) % options.length); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const opt = options[active] || options.find(o => o.value === value);
            if (opt) onChange(opt.value);
            setOpen(false);
        }
    };

    return (
        <div className="w-full">
            {label && <label className="block mb-2 text-sm text-muted-foreground">{label}</label>}
            <div className="relative" onKeyDown={handleKeyDown}>
                <button
                    ref={btnRef}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    onClick={() => setOpen(v => !v)}
                    className={`inline-flex w-full items-center justify-between gap-2 rounded-[6px] border px-3 py-2 text-sm ${buttonClassName}`}
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                >
                    <span className="truncate">{current.label}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                    <ul
                        ref={listRef}
                        role="listbox"
                        tabIndex={-1}
                        className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-[6px] border bg-white shadow-sm"
                        style={{ borderColor: 'var(--border)' }}
                    >
                        {options.map((opt, idx) => {
                            const selected = opt.value === value;
                            const isActive = idx === active;
                            return (
                                <li
                                    key={opt.value ?? `opt-${idx}`}
                                    role="option"
                                    aria-selected={selected}
                                    onMouseEnter={() => setActive(idx)}
                                    onClick={() => { onChange(opt.value); setOpen(false); }}
                                    className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${isActive ? 'bg-muted' : 'bg-white'} ${selected ? 'font-medium' : ''}`}
                                >
                                    <span className="truncate">{opt.label}</span>
                                    {selected && <Check className="w-4 h-4" />}
                                </li>
                            );
                        })}
                        {options.length === 0 && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">Không có lựa chọn</li>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
}

/* ======================= Sub Components ======================= */

const StatCard = ({ title, value, icon: Icon, description, color }) => (
    <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300 border-l-4" style={{ borderLeftColor: color }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-5 w-5 text-muted-foreground" style={{ color }} />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
    </Card>
);

const LeadsDistributionChart = ({ assigned, pending }) => {
    const data = {
        labels: ['Đã phân bổ', 'Chờ phân bổ'],
        datasets: [{
            label: 'Tình trạng Leads',
            data: [assigned, pending],
            backgroundColor: ['#10b981', '#f59e0b'],
            borderColor: ['#059669', '#d97706'],
            borderWidth: 1,
        }],
    };
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'bottom' },
            title: { display: true, text: 'Tỷ lệ phân bổ Leads', font: { size: 16 } },
        },
    };
    return <Doughnut data={data} options={options} />;
};

/* ======================= Helpers ======================= */

const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const badgeClass = (type) => {
    if (type === 'assigned') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    if (type === 'pending') return 'bg-amber-100 text-amber-700 border border-amber-200';
    if (type === 'telesale' || type === 'telesale_TuVan') return 'bg-indigo-100 text-indigo-700 border border-indigo-200';
    if (type === 'care' || type === 'CareService') return 'bg-violet-100 text-violet-700 border border-violet-200';
    return 'bg-slate-100 text-slate-700 border border-slate-200';
};

const currency = (v) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v || 0);

/* =========== Popup: small, compact =========== */

function Line({ icon: Icon, label, value, mono = false }) {
    return (
        <div className="flex items-start gap-2 py-1">
            <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground" />
            <div className="min-w-[92px] text-[11px] text-muted-foreground">{label}</div>
            <div className={`text-[12px] leading-5 ${mono ? 'font-medium' : ''}`}>{value || <span className="text-muted-foreground">—</span>}</div>
        </div>
    );
}

function LeadPopup({ open, onClose, lead, userMap }) {
    if (!lead) return null;

    const lastAssign = Array.isArray(lead.assignees) && lead.assignees.length
        ? lead.assignees[lead.assignees.length - 1]
        : null;

    const lastAssigneeName = lastAssign ? (userMap.get(String(lastAssign.user))?.name || 'N/A') : '—';
    const lastAssigneeGroup = lastAssign ? (userMap.get(String(lastAssign.user))?.group || lastAssign.group || '—') : '—';

    const header = (
        <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0" />
            <div className="min-w-0">
                <div className="truncate">{lead.name || 'Khách hàng'}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                    {lead.source?.name || '—'} • {new Date(lead.createAt).toLocaleString('vi-VN')}
                </div>
            </div>
        </div>
    );

    return (
        <Popup open={open} onClose={onClose} header={header} widthClass="max-w-md">
            {/* Chips */}
            <div className="flex flex-wrap gap-1.5">
                <span className={`px-2 py-0.5 rounded text-[10px] ${badgeClass(lastAssign ? 'assigned' : 'pending')}`}>
                    {lastAssign ? 'Đã phân bổ' : 'Chờ phân bổ'}
                </span>
                {lastAssign && (
                    <span className={`px-2 py-0.5 rounded text-[10px] ${badgeClass(lastAssigneeGroup)}`}>
                        {(lastAssigneeGroup === 'telesale' || lastAssigneeGroup === 'telesale_TuVan') ? 'Telesale'
                            : (lastAssigneeGroup === 'care' || lastAssigneeGroup === 'CareService') ? 'Care'
                                : lastAssigneeGroup}
                    </span>
                )}
                {lead.serviceDetails?.status && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-sky-100 text-sky-700 border border-sky-200">
                        Ngành học: {String(lead.serviceDetails.status).replaceAll('_', ' ')}
                    </span>
                )}
            </div>

            {/* Info */}
            <div className="grid grid-cols-1 rounded-md border p-2 bg-white mt-3" style={{ borderColor: 'var(--border)' }}>
                <Line icon={User} label="Tên KH" value={lead.name} />
                <Line icon={Phone} label="Số điện thoại" value={lead.phone} mono />
                <Line icon={Mail} label="Email" value={lead.email} mono />
                <Line icon={MapPin} label="Khu vực" value={lead.area} />
                <Line icon={Calendar} label="Tiếp nhận" value={new Date(lead.createAt).toLocaleString('vi-VN')} />
            </div>

            {/* Assign info */}
            <div className="rounded-md border p-2 bg-white mt-3" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[11px] text-muted-foreground mb-1">Phân bổ gần nhất</div>
                {lastAssign ? (
                    <div className="text-[12px]">
                        <div>Nhân viên: <span className="font-medium">{lastAssigneeName}</span></div>
                        <div>Nhóm: <span className="font-medium">
                            {(lastAssigneeGroup === 'telesale' || lastAssigneeGroup === 'telesale_TuVan') ? 'Telesale'
                                : (lastAssigneeGroup === 'care' || lastAssigneeGroup === 'CareService') ? 'Care'
                                    : lastAssigneeGroup}
                        </span></div>
                        <div>Thời gian: <span className="text-muted-foreground">{new Date(lastAssign.assignedAt).toLocaleString('vi-VN')}</span></div>
                    </div>
                ) : (
                    <div className="text-[12px] text-muted-foreground">Chưa có thông tin phân bổ.</div>
                )}
            </div>

            {/* Care logs (nếu có) */}
            <div className="rounded-md border p-2 bg-white mt-3" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[11px] text-muted-foreground mb-1">Hoạt động gần đây</div>
                {Array.isArray(lead.care) && lead.care.length ? (
                    <ul className="space-y-1">
                        {[...lead.care].slice(-3).reverse().map(c => (
                            <li key={c._id} className="text-[12px] leading-5">
                                <span className="text-[11px] text-muted-foreground">{new Date(c.createAt).toLocaleString('vi-VN')}</span>
                                <span className="mx-1.5 text-muted-foreground">•</span>
                                <span>{c.content}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-[12px] text-muted-foreground">Chưa có hoạt động.</div>
                )}
            </div>
        </Popup>
    );
}

/* ======================= Table (clickable rows -> popup) ======================= */

function AssignmentLogTable({ rows, visibleCount, onReachEnd, title = 'Lịch sử phân bổ gần đây', onRowClick }) {
    const containerRef = useRef(null);
    const visible = rows.slice(0, visibleCount);

    const handleScroll = (e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) onReachEnd?.();
    };

    return (
        <Card className="shadow-lg col-span-1 lg:col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center"><History className="mr-2 h-5 w-5" />{title}</CardTitle>
                <CardDescription>
                    {title.includes('chờ phân bổ') ? 'Các leads chưa được giao cho nhân viên.' : 'Danh sách các leads được phân bổ gần đây nhất.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div ref={containerRef} className="max-h-[400px] overflow-y-auto" onScroll={handleScroll}>
                    <Table>
                        <TableHeader className="sticky top-0 bg-secondary">
                            <TableRow>
                                <TableHead>Khách hàng</TableHead>
                                <TableHead>Nhân viên</TableHead>
                                <TableHead className="hidden md:table-cell">Nhóm</TableHead>
                                <TableHead className="text-right">Thời gian</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visible.length > 0 ? visible.map((log, index) => (
                                <TableRow
                                    key={`${log.id}-${index}`}
                                    className="cursor-pointer hover:bg-muted/60"
                                    onClick={() => onRowClick?.(log)}
                                >
                                    <TableCell>
                                        <div className="font-medium">{log.customerName}</div>
                                        <div className="text-xs text-muted-foreground">{log.zaloName || '—'}</div>
                                    </TableCell>
                                    <TableCell>{log.assignedToName || 'chưa phân bổ'}</TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <Badge variant="outline">{log.group || 'chưa phân bổ'}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right text-xs">{new Date(log.assignedAt).toLocaleString('vi-VN')}</TableCell>
                                </TableRow>
                            )) : (
                                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Chưa có dữ liệu.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                    {visible.length < rows.length && (
                        <div className="flex justify-center py-3">
                            <button
                                className="text-sm px-4 py-2 rounded-[6px] border"
                                style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                                onClick={() => onReachEnd?.()}
                            >
                                Tải thêm
                            </button>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

/* ======================= Main Component ======================= */

export default function DashboardClient({ initialData, user = [] }) {
    const [data, setData] = useState(initialData);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // ===== Filters =====
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 7);
        return toYMD(d);
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        return toYMD(d);
    });
    const [statusFilter, setStatusFilter] = useState('all'); // all | assigned | pending
    const [groupFilter, setGroupFilter] = useState('all');   // all | telesale | care
    const [employeeFilter, setEmployeeFilter] = useState('all'); // userId | 'all'

    // Infinite scroll for log
    const [visibleCount, setVisibleCount] = useState(10);
    const handleReachEnd = useCallback(() => setVisibleCount(c => c + 10), []);

    // Map userId -> user info
    const userMap = useMemo(() => {
        const m = new Map();
        (user || []).forEach(u => m.set(String(u._id), u));
        return m;
    }, [user]);

    // Listbox options
    const statusOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả tình trạng' },
        { value: 'assigned', label: 'Đã phân bổ' },
        { value: 'pending', label: 'Chờ phân bổ' },
    ]), []);

    const groupOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả nhóm' },
        { value: 'telesale', label: 'Telesale' },
        { value: 'care', label: 'Care' },
    ]), []);

    const employeeOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả nhân viên' },
        ...(user || []).map(u => ({ value: String(u._id), label: u.name }))
    ]), [user]);

    // ===== Apply filters =====
    const filteredLeads = useMemo(() => {
        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59.999') : null;

        return (data || []).filter(c => {
            const ct = new Date(c.createAt);
            if (start && ct < start) return false;
            if (end && ct > end) return false;

            const hasAssignees = Array.isArray(c.assignees) && c.assignees.length > 0;

            if (statusFilter === 'assigned' && !hasAssignees) return false;
            if (statusFilter === 'pending' && hasAssignees) return false;

            if (groupFilter !== 'all') {
                if (!hasAssignees) return false;
                const last = c.assignees[c.assignees.length - 1];
                const u = userMap.get(String(last.user));
                const g = u?.group || last.group || 'unknown';
                const normalizedGroup = (g === 'telesale_TuVan' || g === 'telesale') ? 'telesale'
                    : (g === 'CareService' || g === 'care') ? 'care' : g;
                if (normalizedGroup !== groupFilter) return false;
            }

            if (employeeFilter !== 'all') {
                if (!hasAssignees) return false;
                const matched = c.assignees.some(a => String(a.user) === employeeFilter);
                if (!matched) return false;
            }

            return true;
        });
    }, [data, startDate, endDate, statusFilter, groupFilter, employeeFilter, userMap]);

    // ===== Stats & Rows =====
    const { stats, assignmentRows, pendingRows } = useMemo(() => {
        const assigned = filteredLeads.filter(c => Array.isArray(c.assignees) && c.assignees.length > 0).length;
        const pending = filteredLeads.length - assigned;

        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59.999') : null;

        const assignmentRows = filteredLeads.flatMap(c => {
            if (!Array.isArray(c.assignees)) return [];
            return c.assignees.map(a => {
                const u = userMap.get(String(a.user));
                return {
                    id: `${c._id}-${a._id || a.assignedAt}`,
                    customerId: String(c._id),
                    status: 'assigned',
                    customerName: c.name,
                    zaloName: c.zaloname,
                    assignedToId: String(a.user),
                    assignedToName: u?.name || 'N/A',
                    group: u?.group || a.group || 'N/A',
                    assignedAt: a.assignedAt,
                };
            });
        })
            .filter(r => {
                const at = new Date(r.assignedAt);
                if (start && at < start) return false;
                if (end && at > end) return false;
                if (employeeFilter !== 'all' && r.assignedToId !== employeeFilter) return false;
                if (groupFilter !== 'all' && r.group !== groupFilter) return false;
                return true;
            })
            .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));

        const pendingRows = filteredLeads
            .filter(c => !Array.isArray(c.assignees) || c.assignees.length === 0)
            .map(c => ({
                id: String(c._id),
                customerId: String(c._id),
                status: 'pending',
                customerName: c.name,
                zaloName: c.zaloname,
                assignedToName: '—',
                group: '—',
                assignedAt: c.createAt,
            }))
            .filter(r => {
                const at = new Date(r.assignedAt);
                if (start && at < start) return false;
                if (end && at > end) return false;
                if (employeeFilter !== 'all') return false;
                if (groupFilter !== 'all') return false;
                return true;
            })
            .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));

        return { stats: { total: filteredLeads.length, assigned, pending }, assignmentRows, pendingRows };
    }, [filteredLeads, startDate, endDate, employeeFilter, groupFilter, userMap]);

    useEffect(() => { setVisibleCount(10); }, [startDate, endDate, statusFilter, groupFilter, employeeFilter]);

    // (Optional) fake refresh
    useEffect(() => {
        const interval = setInterval(async () => {
            setIsRefreshing(true);
            await new Promise(r => setTimeout(r, 400));
            setIsRefreshing(false);
        }, 30000);
        return () => clearInterval(interval);
    }, []);

    const rowsToShow = statusFilter === 'pending' ? pendingRows : assignmentRows;
    const tableTitle = statusFilter === 'pending' ? 'Danh sách chờ phân bổ' : 'Lịch sử phân bổ gần đây';

    // ====== Popup state & handler ======
    const [popupOpen, setPopupOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState(null);
    const onRowClick = (row) => {
        const found = (data || []).find(c => String(c._id) === String(row.customerId));
        setSelectedLead(found || null);
        setPopupOpen(true);
    };

    return (
        <div className="flex-1 space-y-4 py-4 pt-6 min-h-screen">

            {/* ===== Filters ===== */}
            <Card className="shadow-md">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Bộ lọc</CardTitle>
                        <CardDescription>Lọc theo nhân viên, nhóm, tình trạng và thời gian.</CardDescription>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setStartDate(''); setEndDate('');
                            setStatusFilter('all'); setGroupFilter('all'); setEmployeeFilter('all');
                        }}
                        className="inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Đặt lại bộ lọc
                    </button>
                </CardHeader>

                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                    <Listbox label="Tình trạng" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                    <Listbox label="Nhóm nhân viên" options={groupOptions} value={groupFilter} onChange={setGroupFilter} />
                    <Listbox label="Nhân viên" options={employeeOptions} value={employeeFilter} onChange={setEmployeeFilter} />
                    <div>
                        <label className="block mb-2 text-sm text-muted-foreground">Từ ngày</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full rounded-[6px] border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                        />
                    </div>
                    <div>
                        <label className="block mb-2 text-sm text-muted-foreground">Đến ngày</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full rounded-[6px] border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* ===== Stats ===== */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                <StatCard title="Tổng số Leads" value={stats.total} icon={Users} description="Tổng số leads sau bộ lọc" color="#3b82f6" />
                <StatCard title="Đã phân bổ" value={stats.assigned} icon={UserCheck} description="Leads đã được giao cho nhân viên" color="#10b981" />
                <StatCard title="Chờ phân bổ" value={stats.pending} icon={History} description="Leads mới đang chờ được xử lý" color="#f59e0b" />
            </div>

            {/* ===== Chart + Log ===== */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
                <Card className="shadow-lg lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Phân bổ Leads</CardTitle>
                        <CardDescription>Tỷ lệ leads đã phân bổ và đang chờ (sau bộ lọc).</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[360px] sm:h-[400px] relative">
                        <LeadsDistributionChart assigned={stats.assigned} pending={stats.pending} />
                    </CardContent>
                </Card>

                <AssignmentLogTable
                    rows={rowsToShow}
                    visibleCount={visibleCount}
                    onReachEnd={() => {
                        if (visibleCount < rowsToShow.length) handleReachEnd();
                    }}
                    title={tableTitle}
                    onRowClick={onRowClick}
                />
            </div>

            {/* ===== Popup ===== */}
            <LeadPopup open={popupOpen} onClose={() => setPopupOpen(false)} lead={selectedLead} userMap={userMap} />
        </div>
    );
}
