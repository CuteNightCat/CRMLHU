// app/(wherever)/TelesalesReportClient.jsx
'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Phone, PhoneMissed, Percent, History, PhoneForwarded, ChevronDown, Check, RefreshCw } from 'lucide-react';
import RecordingPlayer from "@/components/call/RecordingPlayer";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ---------- helpers ----------
const fmtTime = (d) => new Date(d).toLocaleString('vi-VN');
const fmtDur = (s = 0) => {
    const n = Number(s) || 0;
    const mm = Math.floor(n / 60);
    const ss = n % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const statusToBadge = (st) => {
    switch (st) {
        case 'completed': return { label: 'Thành công', variant: 'default' };
        case 'no_answer': return { label: 'Không liên lạc', variant: 'destructive' };
        case 'missed': return { label: 'Bỏ lỡ', variant: 'destructive' };
        case 'rejected': return { label: 'Từ chối', variant: 'secondary' };
        case 'busy': return { label: 'Máy bận', variant: 'secondary' };
        case 'voicemail': return { label: 'Voicemail', variant: 'outline' };
        case 'ongoing': return { label: 'Đang diễn ra', variant: 'outline' };
        case 'failed':
        default: return { label: 'Lỗi kỹ thuật', variant: 'destructive' };
    }
};

/* ============== Listbox (Dropdown button, aria chuẩn) ============== */
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
                                    className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${isActive ? 'bg-muted' : 'bg-white'
                                        } ${selected ? 'font-medium' : ''}`}
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

/* ============== sub components ============== */
const StatCard = ({ title, value, icon: Icon, description, color }) => (
    <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300 border-l-4" style={{ borderLeftColor: color }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-5 w-5 text-muted-foreground" style={{ color }} />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
            <h5>{description}</h5>
        </CardContent>
    </Card>
);

const CallOutcomeChart = ({ chartData }) => {
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            title: { display: true, text: 'Phân bố trạng thái cuộc gọi', font: { size: 16 } },
        },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    };
    return <Bar options={options} data={chartData} />;
};

const CallLogTable = ({ rows }) => (
    <Card className="shadow-lg col-span-1 lg:col-span-2">
        <CardHeader>
            <CardTitle className="flex items-center">
                <History className="mr-2 h-5 w-5" />
                Nhật ký cuộc gọi gần đây
            </CardTitle>
            <CardDescription>Danh sách cuộc gọi mới nhất.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="max-h-[480px] overflow-y-auto">
                <Table>
                    <TableHeader className="sticky top-0 bg-secondary">
                        <TableRow>
                            <TableHead>Khách hàng</TableHead>
                            <TableHead>Trạng thái</TableHead>
                            <TableHead className="text-center">Thời lượng</TableHead>
                            <TableHead className="text-right">Thời điểm</TableHead>
                            <TableHead className="text-right">Ghi âm</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((r) => {
                            const badge = statusToBadge(r.status);
                            return (
                                <TableRow key={r._id}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <span>{r.customer?.name || 'Khách'}</span>
                                            <span className="text-xs text-muted-foreground">{r.customer?.zaloname || ''}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={badge.variant}>{badge.label}</Badge>
                                    </TableCell>
                                    <TableCell className="text-center font-mono text-xs">
                                        {fmtDur(r.duration)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs">{fmtTime(r.createdAt)}</TableCell>
                                    <TableCell className="text-right">
                                        {r.file ? (
                                            <div className="inline-flex w-72 max-w-full">
                                                <RecordingPlayer callId={r._id} />
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
    </Card>
);
const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
/* ============== main ============== */
export default function TelesalesReportClient({ initialData = [], user = [] }) {
    // filters
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - 7);
        return toYMD(d);
    });

    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return toYMD(d);
    });
    const [userFilter, setUserFilter] = useState('all');      // 'all' | userId
    const [groupFilter, setGroupFilter] = useState('all');      // 'all' | 'telesale' | 'care'

    // map users
    const userMap = useMemo(() => {
        const m = new Map();
        (user || []).forEach(u => m.set(String(u._id), u));
        return m;
    }, [user]);

    // listbox options
    const userOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả nhân viên' },
        ...(user || []).map(u => ({ value: String(u._id), label: u.name }))
    ]), [user]);

    const groupOptions = useMemo(() => ([
        { value: 'all', label: 'Tất cả nhóm' },
        { value: 'telesale', label: 'Telesale' },
        { value: 'care', label: 'Care' },
    ]), []);

    // filtered calls
    const filtered = useMemo(() => {
        const calls = Array.isArray(initialData) ? initialData : [];
        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59.999') : null;

        return calls.filter(c => {
            const ct = new Date(c.createdAt);
            if (start && ct < start) return false;
            if (end && ct > end) return false;

            // filter by user
            const uid = String(c.user?._id || '');
            if (userFilter !== 'all' && uid !== userFilter) return false;

            // filter by group (lookup from users list)
            if (groupFilter !== 'all') {
                const usr = userMap.get(uid);
                const g = usr?.group;
                const normalizedGroup = (g === 'noi_khoa' || g === 'telesale') ? 'telesale'
                    : (g === 'ngoai_khoa' || g === 'care') ? 'care' : g;
                if (normalizedGroup !== groupFilter) return false;
            }
            return true;
        });
    }, [initialData, startDate, endDate, userFilter, groupFilter, userMap]);

    // stats & chart & table rows (chart chỉ dùng failed + completed)
    // stats & chart & table rows (chart chỉ dùng failed + completed)
    const { stats, chartData, tableRows } = useMemo(() => {
        const calls = filtered;

        let completed = 0;
        let failed = 0;
        let noContact = 0; // KHÔNG liên lạc = mọi status KHÁC 'completed'

        let successDurTotal = 0;
        let successDurCount = 0;

        calls.forEach(c => {
            if (c.status === 'completed') {
                completed += 1;
                if (Number(c.duration) > 0) {
                    successDurTotal += Number(c.duration);
                    successDurCount += 1;
                }
            } else {
                noContact += 1;              // <- cập nhật ở đây
                if (c.status === 'failed') { // để phục vụ biểu đồ 2 cột
                    failed += 1;
                }
            }
        });

        const total = calls.length;
        const connectionRate = total ? (completed / total) * 100 : 0;
        const avgSuccessDur = successDurCount ? Math.round(successDurTotal / successDurCount) : 0;

        // Biểu đồ CHỈ 2 trạng thái: completed & failed
        const chart = {
            labels: ['Thành công', 'Lỗi kỹ thuật'],
            datasets: [{
                label: 'Số lượng',
                data: [completed, failed],
                backgroundColor: [
                    'rgba(59, 130, 246, 0.7)',   // completed
                    'rgba(244, 63, 94, 0.7)',    // failed
                ],
            }],
        };

        const rows = [...calls].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

        return {
            stats: {
                totalCalls: total,
                connectionRate: `${connectionRate.toFixed(1)}%`,
                avgSuccessDur: fmtDur(avgSuccessDur),
                noContactCount: noContact, // <- giờ sẽ ra đúng
            },
            chartData: chart,
            tableRows: rows,
        };
    }, [filtered]);


    return (
        <div className="flex-1 space-y-4 py-4 pt-6 min-h-screen">
            {/* Filters */}
            <Card className="shadow-md">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Bộ lọc</CardTitle>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setStartDate(''); setEndDate(''); setUserFilter('all'); setGroupFilter('all'); }}
                        className="inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
                    >
                        <RefreshCw className="w-4 h-4" /> Đặt lại bộ lọc
                    </button>
                </CardHeader>

                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Listbox
                        label="Nhân viên gọi"
                        options={userOptions}
                        value={userFilter}
                        onChange={setUserFilter}
                    />
                    <Listbox
                        label="Nhóm (group)"
                        options={groupOptions}
                        value={groupFilter}
                        onChange={setGroupFilter}
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

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Tổng cuộc gọi"
                    value={stats.totalCalls}
                    icon={Phone}
                    description="Tổng số cuộc gọi sau bộ lọc"
                    color="#3b82f6"
                />
                <StatCard
                    title="Tỷ lệ kết nối"
                    value={`${stats.totalCalls - stats.noContactCount} (${stats.connectionRate})`}
                    icon={Percent}
                    description="Thành công / Tổng cuộc gọi"
                    color="#10b981"
                />
                <StatCard
                    title="Thời lượng TB (thành công)"
                    value={stats.avgSuccessDur}
                    icon={PhoneForwarded}
                    description="Chỉ tính các cuộc gọi thành công"
                    color="#8b5cf6"
                />
                <StatCard
                    title="Không liên lạc được"
                    value={`${stats.noContactCount} (${Number(stats.noContactCount / stats.totalCalls * 100).toFixed(2)}%)`}
                    icon={PhoneMissed}
                    description="Cuộc gọi thất bại / không bắt máy"
                    color="#ef4444"
                />
            </div>

            {/* Chart + Table */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle>Biểu đồ trạng thái cuộc gọi</CardTitle>
                        <CardDescription>Chỉ hiển thị Thành công & Lỗi kỹ thuật.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px] relative">
                        <CallOutcomeChart chartData={chartData} />
                    </CardContent>
                </Card>

                <CallLogTable rows={tableRows} />
            </div>
        </div>
    );
}
