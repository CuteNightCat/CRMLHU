'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, Title } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar, X, UserCheck, Percent, History, ChevronDown, Check as CheckIcon, RefreshCw } from 'lucide-react';

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
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-primary)' }}
                    />
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
                                    {selected && <CheckIcon className="w-4 h-4" />}
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
            <h5 className="text-xs text-muted-foreground">{description}</h5>
        </CardContent>
    </Card>
);

const AppointmentStatusChart = ({ chartData }) => {
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'bottom' },
            title: { display: true, text: 'Phân bổ Trạng thái Lịch hẹn', font: { size: 16 } },
        },
    };
    return <Doughnut data={chartData} options={options} />;
};

const AppointmentLogTable = ({ appointments }) => {
    const getStatusBadge = (status) => {
        switch (status) {
            case 'completed':
                return <Badge className="bg-green-500 hover:bg-green-600">Hoàn thành</Badge>;
            case 'confirmed':
                return <Badge className="bg-blue-500 hover:bg-blue-600">Đã xác nhận</Badge>;
            case 'pending':
                return <Badge className="bg-yellow-500 hover:bg-yellow-600">Chờ xử lý</Badge>;
            case 'cancelled':
                return <Badge variant="destructive">Đã hủy</Badge>;
            case 'postponed':
                return <Badge className="bg-orange-500 hover:bg-orange-600">Hoãn</Badge>;
            case 'missed':
                return <Badge className="bg-gray-500 hover:bg-gray-600">Không đến</Badge>;
            default:
                return <Badge variant="secondary">Không xác định</Badge>;
        }
    };

    return (
        <Card className="shadow-lg col-span-1 lg:col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center">
                    <History className="mr-2 h-5 w-5" />
                    Log Lịch hẹn Gần đây
                </CardTitle>
                <CardDescription>Danh sách lịch hẹn kèm Khách hàng và Nhân viên tạo.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-secondary">
                            <TableRow>
                                <TableHead>Lịch hẹn</TableHead>
                                <TableHead>Khách hàng</TableHead>
                                <TableHead>Nhân viên</TableHead>
                                <TableHead>Trạng thái</TableHead>
                                <TableHead className="text-right">Thời gian</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {appointments.map((appt) => (
                                <TableRow key={appt._id}>
                                    <TableCell className="font-medium">{appt.title}</TableCell>
                                    <TableCell>{appt.customer?.name ?? '—'}</TableCell>
                                    <TableCell>
                                        {typeof appt.createdBy === 'object'
                                            ? (appt.createdBy?.name ?? '—')
                                            : '—'}
                                    </TableCell>
                                    <TableCell>{getStatusBadge(appt.status)}</TableCell>
                                    <TableCell className="text-right text-xs">
                                        {new Date(appt.appointmentDate).toLocaleString('vi-VN')}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};

const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

/* ======================= Main Component ======================= */
export default function AppointmentStatsClient({ initialData = [], user = [] }) {
    // Filters
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - 7);
        return toYMD(d);
    }); // YYYY-MM-DD
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return toYMD(d);
    });
    const [groupFilter, setGroupFilter] = useState('all'); // all | telesale | care
    const [statusFilter, setStatusFilter] = useState('all'); // all | completed | confirmed | pending | cancelled | postponed | missed

    // Users map (for group lookup by createdBy)
    const userMap = useMemo(() => {
        const m = new Map();
        (user || []).forEach(u => m.set(String(u._id), u));
        return m;
    }, [user]);

    // Listbox options
    const groupOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả nhóm' },
        { value: 'telesale', label: 'Telesale' },
        { value: 'care', label: 'Care' },
    ]), []);

    const statusOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả trạng thái' },
        { value: 'completed', label: 'Hoàn thành' },
        { value: 'confirmed', label: 'Đã xác nhận' },
        { value: 'pending', label: 'Chờ xử lý' },
        { value: 'cancelled', label: 'Đã hủy' },
        { value: 'postponed', label: 'Hoãn' },
        { value: 'missed', label: 'Không đến' },
    ]), []);

    // Apply filters
    const filtered = useMemo(() => {
        const data = Array.isArray(initialData) ? initialData : [];
        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59.999') : null;

        return data.filter(a => {
            // Time by appointmentDate
            const at = new Date(a.appointmentDate);
            if (start && at < start) return false;
            if (end && at > end) return false;

            // Group by createdBy -> user.group
            if (groupFilter !== 'all') {
                const u = userMap.get(String(a.createdBy));
                const g = u?.group || 'unknown';
                const normalizedGroup = (g === 'telesale' || g === 'telesale_TuVan') ? 'telesale'
                    : (g === 'care' || g === 'CareService') ? 'care' : g;
                if (normalizedGroup !== groupFilter) return false;
            }

            // Status
            if (statusFilter !== 'all' && a.status !== statusFilter) return false;

            return true;
        });
    }, [initialData, startDate, endDate, groupFilter, statusFilter, userMap]);

    // Stats + Chart (thêm % hiển thị trong 4 ô)
    const { stats, chartData } = useMemo(() => {
        let confirmed = 0, completed = 0, cancelled = 0, postponed = 0, missed = 0, pending = 0;

        filtered.forEach(appt => {
            switch (appt.status) {
                case 'confirmed': confirmed++; break;
                case 'completed': completed++; break;
                case 'postponed': postponed++; break;
                case 'missed': missed++; break;
                case 'pending': pending++; break;
                case 'cancelled': cancelled++; break;
            }
        });

        const total = filtered.length;
        const denomForShowRate = completed + missed;
        const showRate = denomForShowRate > 0 ? (completed / denomForShowRate) * 100 : 0;

        const pctOfTotal = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

        return {
            stats: {
                total,
                totalPct: total > 0 ? 100 : 0,
                attended: completed,
                attendedPct: pctOfTotal(completed),
                canceledOrPostponed: cancelled + postponed,
                canceledOrPostponedPct: pctOfTotal(cancelled + postponed),
                showRate: Math.round(showRate),          // %
                showDenom: denomForShowRate,             // completed + missed
            },
            chartData: {
                labels: ['Hoàn thành', 'Đã xác nhận', 'Chờ xử lý', 'Hủy/Hoãn', 'Không đến'],
                datasets: [{
                    label: 'Số lượng',
                    data: [completed, confirmed, pending, cancelled + postponed, missed],
                    backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#6b7280'],
                }]
            }
        };
    }, [filtered]);

    return (
        <div className="flex-1 space-y-4 py-4 pt-6 min-h-screen">

            {/* Filters */}
            <Card className="shadow-md">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Lọc theo nhóm (người tạo lịch), trạng thái và thời gian (ngày hẹn).</CardTitle>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setStartDate(''); setEndDate(''); setGroupFilter('all'); setStatusFilter('all'); }}
                        className="inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                    >
                        <RefreshCw className="w-4 h-4" /> Đặt lại bộ lọc
                    </button>
                </CardHeader>

                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Listbox
                        label="Nhóm (group)"
                        options={groupOptions}
                        value={groupFilter}
                        onChange={setGroupFilter}
                    />
                    <Listbox
                        label="Trạng thái lịch hẹn"
                        options={statusOptions}
                        value={statusFilter}
                        onChange={setStatusFilter}
                    />
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

            {/* Stats (hiển thị “số (tỷ lệ%)”) */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Tổng số Lịch hẹn"
                    value={`${stats.total} (${stats.totalPct}%)`}
                    icon={Calendar}
                    description="Bao gồm tất cả trạng thái (sau lọc)"
                    color="#6366f1"
                />
                <StatCard
                    title="Khách đã đến"
                    value={`${stats.attended} (${stats.attendedPct}%)`}
                    icon={UserCheck}
                    description="Lịch hẹn đã hoàn thành"
                    color="#10b981"
                />
                <StatCard
                    title="Hủy / Hoãn"
                    value={`${stats.canceledOrPostponed} (${stats.canceledOrPostponedPct}%)`}
                    icon={X}
                    description="Lịch hẹn bị hủy hoặc dời lại"
                    color="#ef4444"
                />
                <StatCard
                    title="Tỷ lệ đến hẹn"
                    value={`${stats.attended} (${stats.showRate}%)`}
                    icon={Percent}
                    description="Hoàn thành / (Hoàn thành + Không đến)"
                    color="#f59e0b"
                />
            </div>

            {/* Chart + Table */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle>Phân bổ Trạng thái</CardTitle>
                        <CardDescription>Tỷ lệ các trạng thái của lịch hẹn (sau bộ lọc).</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px] relative">
                        <AppointmentStatusChart chartData={chartData} />
                    </CardContent>
                </Card>

                <AppointmentLogTable appointments={filtered} />
            </div>
        </div>
    );
}
