'use client';

import { useMemo, useState } from 'react';
import {
    Chart as ChartJS,
    CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import Popup from '@/components/ui/popup';
import {
    DollarSign, ShoppingCart, UserCheck, Percent, History, Check, X, UserCog, PiggyBank,
    Eye, LineChart
} from 'lucide-react';

import {
    approveServiceDealAction,
    rejectServiceDealAction
} from '@/data/customers/wraperdata.db';
import { driveImage } from '@/function';
import { useActionFeedback } from '@/hooks/useAction';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/* ================== Component ================== */
export default function DashboardClient({ initialData = [], users = [] }) {
    /* ===== Helpers đặt TRONG component như yêu cầu ===== */
    const { openDetails, setOpenDetails, detailsRow, setDetailsRow } = useDetailsState();
    const fmtVND = (n = 0) => (Number(n) || 0).toLocaleString('vi-VN') + ' đ';

    const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
    const startOfWeek = (d) => { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
    const endOfWeek = (d) => { const x = startOfWeek(d); x.setDate(x.getDate() + 6); return endOfDay(x); };
    const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = (d) => endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const getQuarter = (d) => Math.floor(d.getMonth() / 3) + 1;
    const startOfQuarter = (d) => new Date(d.getFullYear(), (getQuarter(d) - 1) * 3, 1);
    const endOfQuarter = (d) => endOfDay(new Date(d.getFullYear(), (getQuarter(d) - 1) * 3 + 3, 0));
    const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
    const endOfYear = (d) => endOfDay(new Date(d.getFullYear(), 11, 31));
    const toYMD = (d) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; };

    // Đọc pricing an toàn
    const readPricing = (detail = {}) => {
        const p = detail?.pricing || {};
        const discountType = ['none', 'amount', 'percent'].includes(p.discountType) ? p.discountType : 'none';
        return {
            listPrice: Number(p.listPrice) || 0,
            discountType,
            discountValue: Number(p.discountValue) || 0,
            finalPrice: Number(p.finalPrice) || 0,
        };
    };

    const discountLabel = ({ discountType, discountValue }) => {
        if (discountType === 'amount') return fmtVND(discountValue);
        if (discountType === 'percent') return `${discountValue}%`;
        return '0';
    };

    // Lấy “ngày đơn” để lọc/thống kê
    const resolveDetailDate = (row) => {
        const d = row?.detail || {};
        if (d.approvedAt) return new Date(d.approvedAt);
        if (d.closedAt) return new Date(d.closedAt);
        const logs = Array.isArray(row?.care) ? row.care : [];
        const step6 = logs
            .filter(n => n?.step === 6 || String(n?.content || '').includes('[Chốt đăng ký]'))
            .sort((a, b) => new Date(b.createAt) - new Date(a.createAt))[0];
        return step6?.createAt ? new Date(step6.createAt) : null;
    };

    const nameFromUserId = (id, userMap) => {
        if (!id) return '—';
        const found = userMap.get(String(id));
        return found?.name || (typeof id === 'string' ? `User (${id.slice(-6)})` : 'NV');
    };

    const namesFromAssignees = (assignees = [], userMap) => {
        if (!Array.isArray(assignees) || assignees.length === 0) return '—';
        return assignees.map(a => {
            const u = a?.user;
            if (!u) return 'NV';
            if (typeof u === 'object' && u?._id) return u?.name || nameFromUserId(u._id, userMap);
            return nameFromUserId(u, userMap);
        }).join(', ');
    };

    /* ---------- User map ---------- */
    const userMap = useMemo(() => {
        const m = new Map();
        for (const u of Array.isArray(users) ? users : []) m.set(String(u._id), u);
        return m;
    }, [users]);

    /* ---------- Filter Range ---------- */
    const [rangePreset, setRangePreset] = useState('last_30');
    const [startDate, setStartDate] = useState(() => toYMD(new Date(Date.now() - 7 * 86400000)));
    const [endDate, setEndDate] = useState(() => toYMD(new Date()));

    const { rangeStart, rangeEnd } = useMemo(() => {
        const now = new Date();
        switch (rangePreset) {
            case 'this_week': return { rangeStart: startOfWeek(now), rangeEnd: endOfWeek(now) };
            case 'last_7': { const e = endOfDay(now); const s = new Date(e); s.setDate(s.getDate() - 6); return { rangeStart: startOfDay(s), rangeEnd: e }; }
            case 'this_month': return { rangeStart: startOfMonth(now), rangeEnd: endOfMonth(now) };
            case 'last_30': { const e = endOfDay(now); const s = new Date(e); s.setDate(s.getDate() - 29); return { rangeStart: startOfDay(s), rangeEnd: e }; }
            case 'this_quarter': return { rangeStart: startOfQuarter(now), rangeEnd: endOfQuarter(now) };
            case 'this_year': return { rangeStart: startOfYear(now), rangeEnd: endOfYear(now) };
            case 'custom': {
                const s = startOfDay(new Date(startDate));
                const e = endOfDay(new Date(endDate));
                return { rangeStart: s, rangeEnd: e };
            }
            default: return { rangeStart: startOfMonth(now), rangeEnd: endOfMonth(now) };
        }
    }, [rangePreset, startDate, endDate]);

    /* ---------- Chuẩn hoá dữ liệu ---------- */
    const allRows = useMemo(() => {
        const list = Array.isArray(initialData) ? initialData : [];
        const rows = [];
        for (const c of list) {
            const details = Array.isArray(c.serviceDetails)
                ? c.serviceDetails
                : (c.serviceDetails ? [c.serviceDetails] : []);
            for (const d of details) {
                rows.push({
                    customerId: c._id,
                    name: c.name,
                    phone: c.phone,
                    assignees: c.assignees,
                    tags: c.tags,
                    care: c.care,
                    detail: d,
                });
            }
        }
        return rows;
    }, [initialData]);

    /* ---------- Pending & Approved ---------- */
    const pendingApprovals = useMemo(
        () => allRows.filter(r => r.detail?.approvalStatus === 'pending'),
        [allRows]
    );

    const approvedDeals = useMemo(() => {
        return allRows
            .filter(r => r.detail?.approvalStatus === 'approved')
            .map(r => ({ ...r, __dealDate: resolveDetailDate(r)?.toISOString() || null }))
            .filter(r => r.__dealDate && new Date(r.__dealDate) >= rangeStart && new Date(r.__dealDate) <= rangeEnd);
    }, [allRows, rangeStart, rangeEnd]);

    /* ---------- Stats ---------- */
    const stats = useMemo(() => {
        const totalDeals = approvedDeals.length;
        const totalRevenueNum = approvedDeals.reduce((s, r) => s + (Number(r?.detail?.revenue) || 0), 0);
        const avgRevenueNum = totalDeals ? totalRevenueNum / totalDeals : 0;
        return {
            totalDeals,
            totalRevenue: fmtVND(totalRevenueNum),
            avgRevenue: fmtVND(avgRevenueNum),
        };
    }, [approvedDeals]);

    /* ---------- Top Commissions (đã duyệt) ---------- */
    const topCommissions = useMemo(() => {
        const map = new Map(); // userId -> totalAmount
        const approvedAll = allRows.filter(r => r.detail?.approvalStatus === 'approved');
        for (const r of approvedAll) {
            const revBase = Number(r?.detail?.revenue || r?.detail?.pricing?.finalPrice || 0);
            const arr = Array.isArray(r?.detail?.commissions) ? r.detail.commissions : [];
            for (const it of arr) {
                if (!it?.user) continue;
                const amount = Number(it.amount) || ((Number(it.percent) || 0) / 100) * revBase;
                const key = String((typeof it.user === 'object' && it.user?._id) ? it.user._id : it.user);
                map.set(key, (map.get(key) || 0) + amount);
            }
        }
        const rows = Array.from(map.entries()).map(([user, total]) => ({ user, total }));
        rows.sort((a, b) => b.total - a.total);
        return rows.slice(0, 5);
    }, [allRows]);

    /* ---------- Yearly Revenue (chart) ---------- */
    const yearlyChartData = useMemo(() => {
        const approvedAll = allRows.filter(r => r.detail?.approvalStatus === 'approved');
        const byYear = new Map(); // year -> sum revenue
        for (const r of approvedAll) {
            const dt = resolveDetailDate(r);
            if (!dt) continue;
            const year = dt.getFullYear();
            const rev = Number(r?.detail?.revenue) || 0;
            byYear.set(year, (byYear.get(year) || 0) + rev);
        }
        let years = Array.from(byYear.keys()).sort((a, b) => a - b);
        let values = years.map(y => byYear.get(y));

        if (years.length === 0) {
            const y = new Date().getFullYear();
            years = [y];
            values = [0];
        }

        return {
            labels: years.map(String),
            datasets: [{
                label: 'Doanh thu',
                data: values,
                backgroundColor: 'rgba(22, 163, 74, 0.7)',
                borderColor: 'rgba(21, 128, 61, 1)',
                borderWidth: 1
            }]
        };
    }, [allRows]);

    /* ---------- Approve / Reject Popup ---------- */
    const [openApprove, setOpenApprove] = useState(false);
    const [selected, setSelected] = useState(null);
    const [form, setForm] = useState({
        listPrice: '',
        discountType: 'none',
        discountValue: '',
        revenue: '',
        commissions: [{ user: '', role: 'sale', mode: 'percent', percent: '', amount: '' }],
        notes: ''
    });

    const { run } = useActionFeedback();

    // ✅ NẠP GIÁ ĐÚNG TỪ pricing hiện có (không ép = revenue)
    const openApproveFor = (row) => {
        setSelected(row);
        const d = row?.detail || {};
        const p = readPricing(d);

        const preparedCommissions = (d?.commissions?.length
            ? d.commissions
            : [{ user: (row.assignees?.[0]?.user?._id || row.assignees?.[0]?.user || ''), role: 'sale', percent: '', amount: '' }]
        ).map(x => {
            const uid = String((typeof x.user === 'object' && x.user?._id) ? x.user._id : x.user || '');
            const amt = Number(x.amount) || 0;
            const pct = Number(x.percent) || 0;
            const mode = amt > 0 ? 'amount' : 'percent';
            return { user: uid, role: x.role || 'sale', mode, percent: mode === 'percent' ? pct : '', amount: mode === 'amount' ? amt : '' };
        });

        setForm({
            listPrice: p.listPrice || d.revenue || '',
            discountType: p.discountType || 'none',
            discountValue: p.discountValue || '',
            revenue: d.revenue ?? p.finalPrice ?? p.listPrice ?? '',
            commissions: preparedCommissions.length ? preparedCommissions : [{ user: '', role: 'sale', mode: 'percent', percent: '', amount: '' }],
            notes: d.notes || ''
        });

        setOpenApprove(true);
    };

    const calcFinalPrice = () => {
        const lp = Number(form.listPrice) || 0;
        const dv = Number(form.discountValue) || 0;
        if (form.discountType === 'percent') return Math.max(0, Math.round(lp * (1 - dv / 100)));
        if (form.discountType === 'amount') return Math.max(0, lp - dv);
        return lp;
    };

    const onAddCommission = () =>
        setForm(f => ({ ...f, commissions: [...f.commissions, { user: '', role: 'sale', mode: 'percent', percent: '', amount: '' }] }));
    const onRemoveCommission = (idx) =>
        setForm(f => ({ ...f, commissions: f.commissions.filter((_, i) => i !== idx) }));

    const validateCommissions = () => {
        for (const [i, c] of form.commissions.entries()) {
            const p = Number(c.percent) || 0;
            const a = Number(c.amount) || 0;
            if (c.mode === 'percent' && a > 0) return `Dòng hoa hồng #${i + 1}: Chọn theo % thì không được nhập tiền.`;
            if (c.mode === 'amount' && p > 0) return `Dòng hoa hồng #${i + 1}: Chọn theo tiền thì không được nhập %.`;
            if (!c.user) return `Dòng hoa hồng #${i + 1}: Chưa chọn nhân viên.`;
        }
        return '';
    };

    const submitApprove = async () => {
        if (!selected) return;

        const err = validateCommissions();
        if (err) {
            await run(async () => ({ success: false, error: err }), [], { toast: true, overlay: false, autoRefresh: false, silent: false });
            return;
        }

        const fd = new FormData();
        fd.append('customerId', selected.customerId);
        fd.append('serviceDetailId', selected.detail?._id);

        // ✅ GIỮ nguyên listPrice người duyệt thấy/chỉnh
        fd.append('listPrice', String(Number(form.listPrice) || 0));
        fd.append('discountType', form.discountType || 'none');
        fd.append('discountValue', String(Number(form.discountValue) || 0));
        fd.append('finalPrice', String(calcFinalPrice()));

        // Doanh thu ghi nhận (approved)
        const revenueNum = Number(form.revenue || 0) || 0;
        fd.append('revenue', String(revenueNum));

        const cleanCommissions = form.commissions.map(x => ({
            user: x.user,
            role: x.role,
            percent: x.mode === 'percent' ? Number(x.percent || 0) : 0,
            amount: x.mode === 'amount' ? Number(x.amount || 0) : 0,
        }));
        fd.append('commissions', JSON.stringify(cleanCommissions));
        fd.append('notes', form.notes || '');

        const res = await run(
            approveServiceDealAction,
            [null, fd],
            {
                successMessage: 'Duyệt đơn thành công.',
                errorMessage: (r) => r?.error || 'Không thể duyệt đơn.',
                autoRefresh: true,
                toast: true,
                overlay: true,
            }
        );
        if (res?.success) setOpenApprove(false);
    };

    const submitReject = async () => {
        if (!selected) return;
        const reason = prompt('Lý do từ chối? (không bắt buộc)') || '';

        const fd = new FormData();
        fd.append('customerId', selected.customerId);
        fd.append('serviceDetailId', selected.detail?._id);
        fd.append('reason', reason);

        const res = await run(
            rejectServiceDealAction,
            [null, fd],
            {
                successMessage: 'Đã từ chối đơn.',
                errorMessage: (r) => r?.error || 'Không thể từ chối đơn.',
                autoRefresh: true,
                toast: true,
                overlay: true,
            }
        );
        if (res?.success) setOpenApprove(false);
    };

    /* ---------- Sub components (dùng helpers ở trên) ---------- */
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

    const RecentDealsTable = ({ deals, userMap }) => (
        <Card className="shadow-lg col-span-1 lg:col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center"><History className="mr-2 h-5 w-5" />Đăng ký đã duyệt gần đây</CardTitle>
                <CardDescription>Chỉ hiển thị các ĐƠN CHI TIẾT đã duyệt.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-secondary">
                            <TableRow>
                                <TableHead>Khách hàng</TableHead>
                                <TableHead>Doanh thu</TableHead>
                                <TableHead className="hidden md:table-cell">Trạng thái</TableHead>
                                <TableHead className="hidden md:table-cell">Nhân sự</TableHead>
                                <TableHead className="text-right">Ngày chốt</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {deals.map(row => (
                                <TableRow key={row.detail?._id || `${row.customerId}-${row.__dealDate || ''}`}>
                                    <TableCell className="font-medium">{row.name}</TableCell>
                                    <TableCell className="font-semibold text-green-600">
                                        {fmtVND(row.detail?.revenue)}
                                        <div className="text-[11px] text-muted-foreground">
                                            (Final: {fmtVND(readPricing(row.detail).finalPrice)})
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        {row.detail?.status === 'completed'
                                            ? <Badge>Hoàn thành</Badge>
                                            : <Badge variant="secondary">Còn chương trình</Badge>}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-xs">
                                        {namesFromAssignees(row.assignees, userMap)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs">
                                        {row.__dealDate ? new Date(row.__dealDate).toLocaleDateString('vi-VN') : '—'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );

    const YearlyRevenueChart = ({ data }) => {
        const values = Array.isArray(data?.datasets?.[0]?.data) ? data.datasets[0].data : [];
        const maxVal = values.length ? Math.max(...values.map(v => Number(v) || 0)) : 0;
        const noData = !values.length || maxVal === 0;

        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Biểu đồ Doanh thu theo Năm', font: { size: 18 } },
                tooltip: { callbacks: { label: ctx => fmtVND(ctx.parsed.y) } }
            },
            scales: {
                y: {
                    suggestedMin: 0,
                    suggestedMax: noData ? 1_000_000 : undefined,
                    ticks: {
                        stepSize: noData ? 1_000_000 : undefined,
                        callback: (v) => (v / 1_000_000) + 'tr'
                    }
                }
            }
        };
        return <Bar data={data} options={options} />;
    };

    /* ---------- UI ---------- */
    return (
        <div className="flex-1 space-y-6 py-4 pt-6 min-h-screen">

            {/* ====== Filter Bar ====== */}
            <Card className="shadow-md">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Bộ lọc thời gian</CardTitle>
                        <CardDescription>Áp dụng cho thống kê & danh sách.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            className="w-40 border rounded px-3 py-2 text-sm"
                            value={rangePreset}
                            onChange={(e) => setRangePreset(e.target.value)}
                        >
                            <option value="last_30">30 ngày qua</option>
                            <option value="last_7">7 ngày qua</option>
                            <option value="this_week">Tuần này</option>
                            <option value="this_month">Tháng này</option>
                            <option value="this_quarter">Quý này</option>
                            <option value="this_year">Năm nay</option>
                            <option value="custom">Tùy chọn</option>
                        </select>
                        {rangePreset === 'custom' && (
                            <>
                                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
                                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0">
                    <div className="text-sm">
                        <span className="text-muted-foreground">Thời gian bắt đầu:&nbsp;</span>
                        <b>{rangeStart.toLocaleString('vi-VN')}</b>
                    </div>
                    <div className="text-sm">
                        <span className="text-muted-foreground">Thời gian kết thúc:&nbsp;</span>
                        <b>{rangeEnd.toLocaleString('vi-VN')}</b>
                    </div>
                </CardContent>
            </Card>

            {/* ====== Stats ====== */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Tổng đăng ký (đã duyệt)" value={stats.totalDeals} icon={ShoppingCart} description="Số đơn chi tiết đã duyệt trong khoảng lọc" color="#16a34a" />
                <StatCard title="Tổng Doanh thu (đã duyệt)" value={stats.totalRevenue} icon={DollarSign} description="Không tính đơn chờ duyệt" color="#16a34a" />
                <StatCard title="Doanh thu TB/DV" value={stats.avgRevenue} icon={UserCheck} description="Trung bình mỗi đơn đã duyệt" color="#16a34a" />
                <StatCard title="Top Hoa hồng" value={topCommissions.length} icon={Percent} description="Số nhân sự hiện diện trong top" color="#f97316" />
            </div>

            {/* ====== Large Yearly Chart ====== */}
            <Card className="shadow-lg">
                <CardHeader className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <LineChart className="w-5 h-5" />
                            Doanh thu theo năm
                        </CardTitle>
                        <CardDescription>Tổng hợp các đơn <b>đã duyệt</b>. Nếu chưa có dữ liệu, trục Y hiển thị bước 1&nbsp;triệu.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="h-[480px]">
                    <YearlyRevenueChart data={yearlyChartData} />
                </CardContent>
            </Card>

            {/* ====== Pending approvals ====== */}
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="flex items-center"><UserCog className="mr-2 h-5 w-5" />Danh sách cần duyệt</CardTitle>
                    <CardDescription>Đơn chốt đang ở trạng thái <b>chờ duyệt</b> — chưa tính vào doanh thu.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="max-h-[360px] overflow-y-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-secondary">
                                <TableRow>
                                    <TableHead>Khách hàng</TableHead>
                                    <TableHead>Giá & Doanh thu</TableHead>
                                    <TableHead>Ghi chú</TableHead>
                                    <TableHead className="text-right">Thao tác</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pendingApprovals.length === 0 && (
                                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Không có đơn cần duyệt</TableCell></TableRow>
                                )}
                                {pendingApprovals.map(row => {
                                    const p = readPricing(row.detail);
                                    return (
                                        <TableRow key={row.detail?._id || `${row.customerId}-${row.name}`}>
                                            <TableCell className="font-medium">
                                                {row.name}
                                                <div className="text-xs text-muted-foreground">{row.phone}</div>
                                            </TableCell>
                                            <TableCell className="font-semibold">
                                                <div className="leading-tight">
                                                    <div>Giá gốc: <b>{fmtVND(p.listPrice)}</b></div>
                                                    <div className="text-[12px] text-muted-foreground">
                                                        Giảm: {discountLabel(p)} → Final: <b>{fmtVND(p.finalPrice)}</b>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs">{row.detail?.notes || '—'}</TableCell>
                                            <TableCell className="text-right flex items-center justify-end gap-2">
                                                <Button size="sm" variant="outline" onClick={() => setOpenDetails(true) || setDetailsRow(row)}><Eye className="w-4 h-4 mr-1" />Xem</Button>
                                                <Button size="sm" onClick={() => openApproveFor(row)}><Check className="w-4 h-4 mr-1" />Duyệt</Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* ====== Top Commissions ====== */}
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="flex items-center"><PiggyBank className="mr-2 h-5 w-5" />Top nhân viên có hoa hồng cao</CardTitle>
                    <CardDescription>Tính từ các đơn chi tiết đã duyệt (dựa theo amount hoặc % * revenue).</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nhân viên</TableHead>
                                <TableHead className="text-right">Tổng hoa hồng</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {topCommissions.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">Chưa có dữ liệu</TableCell></TableRow>}
                            {topCommissions.map(row => (
                                <TableRow key={row.user}>
                                    <TableCell>{nameFromUserId(row.user, userMap)}</TableCell>
                                    <TableCell className="text-right font-semibold">{fmtVND(row.total)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ====== Recent Deals (approved) ====== */}
            <RecentDealsTable
                userMap={userMap}
                deals={[...approvedDeals].sort((a, b) => new Date(b.__dealDate) - new Date(a.__dealDate)).slice(0, 12)}
            />

            {/* ===== POPUP: DUYỆT ===== */}
            <Popup
                open={openApprove}
                onClose={() => setOpenApprove(false)}
                header={selected ? `Duyệt đơn: ${selected?.name} — ${selected?.phone}` : 'Duyệt đơn'}
                widthClass="max-w-4xl"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setOpenApprove(false)}><X className="w-4 h-4 mr-2" />Đóng</Button>
                        <Button variant="destructive" onClick={submitReject}><X className="w-4 h-4 mr-2" />Từ chối</Button>
                        <Button onClick={submitApprove}><Check className="w-4 h-4 mr-2" />Duyệt & Lưu</Button>
                    </>
                }
            >
                {/* Vùng thông tin KH */}
                {selected && (
                    <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-[8px] border bg-[var(--surface-2)]" style={{ borderColor: 'var(--border)' }}>
                        <div>
                            <div className="text-xs text-muted-foreground">Khách hàng</div>
                            <div className="font-semibold">{selected.name}</div>
                            <div className="text-xs text-muted-foreground">{selected.phone}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Nhân sự liên quan</div>
                            <div className="text-sm">{namesFromAssignees(selected.assignees, userMap)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Ghi chú</div>
                            <div className="text-sm truncate">{selected?.detail?.notes || '—'}</div>
                        </div>
                    </div>
                )}

                {/* 1) Giá & Giảm giá */}
                <section className="mb-5 p-4 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                    <h4 className="font-semibold mb-3">1) Giá & Giảm giá</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="md:col-span-1">
                            <label className="block mb-1 text-sm">Giá gốc (listPrice)</label>
                            <Input
                                type="number"
                                value={form.listPrice}
                                onChange={e => setForm(f => ({ ...f, listPrice: e.target.value }))}
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block mb-1 text-sm">Kiểu giảm</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={form.discountType}
                                onChange={(e) => setForm(f => ({ ...f, discountType: e.target.value }))}
                            >
                                <option value="none">Không</option>
                                <option value="amount">Theo tiền</option>
                                <option value="percent">Theo %</option>
                            </select>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block mb-1 text-sm">Giá trị giảm</label>
                            <Input type="number" value={form.discountValue} onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block mb-1 text-sm">Giá sau giảm (final)</label>
                            <Input value={fmtVND(calcFinalPrice()).replace(' đ', '')} readOnly />
                        </div>
                    </div>
                </section>

                {/* 2) Doanh thu */}
                <section className="mb-5 p-4 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                    <h4 className="font-semibold mb-3">2) Ghi chú</h4>
                    <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
                        <div>
                            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                    </div>
                </section>

                {/* 3) Hoa hồng */}
                <section className="mb-5 p-4 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">3) Hoa hồng</h4>
                        <Button type="button" size="sm" onClick={onAddCommission}>+ Thêm dòng</Button>
                    </div>
                    <div className="space-y-2">
                        {form.commissions.map((row, idx) => {
                            const handleChange = (patch) => setForm(f => {
                                const arr = [...f.commissions];
                                if (patch.mode && patch.mode !== arr[idx].mode) {
                                    if (patch.mode === 'percent') { arr[idx].amount = ''; }
                                    if (patch.mode === 'amount') { arr[idx].percent = ''; }
                                }
                                arr[idx] = { ...arr[idx], ...patch };
                                return { ...f, commissions: arr };
                            });

                            const base = Number(form.revenue) || calcFinalPrice() || 0;
                            const p = Number(row.percent) || 0;
                            const a = Number(row.amount) || 0;
                            const preview = row.mode === 'percent'
                                ? Math.round((p / 100) * base)
                                : a;
                            const computedNote = `≈ ${fmtVND(preview)} (${row.mode === 'percent' ? `${p}% * ${fmtVND(base)}` : 'số tiền cố định'})`;

                            return (
                                <div key={idx} className="grid grid-cols-12 gap-2">
                                    <div className="col-span-3">
                                        <label className="block mb-1 text-xs text-muted-foreground">Nhân viên</label>
                                        <select
                                            className="w-full border rounded px-3 py-2 text-sm"
                                            value={row.user}
                                            onChange={(e) => handleChange({ user: e.target.value })}
                                        >
                                            <option value="">— Chọn nhân viên —</option>
                                            {users.map(u => (
                                                <option key={u._id} value={String(u._id)}>
                                                    {u.name} {u.group ? `• ${u.group}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="text-[11px] mt-1 text-muted-foreground">
                                            {row.user ? nameFromUserId(row.user, userMap) : 'Chưa chọn'}
                                        </div>
                                    </div>

                                    <div className="col-span-2">
                                        <label className="block mb-1 text-xs text-muted-foreground">Vai trò</label>
                                        <Input placeholder="sale/doctor/..." value={row.role} onChange={e => handleChange({ role: e.target.value })} />
                                    </div>

                                    <div className="col-span-2">
                                        <label className="block mb-1 text-xs text-muted-foreground">Cách nhập</label>
                                        <select
                                            className="w-full border rounded px-3 py-2 text-sm"
                                            value={row.mode}
                                            onChange={(e) => handleChange({ mode: e.target.value })}
                                        >
                                            <option value="percent">% theo doanh thu</option>
                                            <option value="amount">Số tiền cố định</option>
                                        </select>
                                    </div>

                                    {row.mode === 'percent' ? (
                                        <>
                                            <div className="col-span-2">
                                                <label className="block mb-1 text-xs text-muted-foreground">Phần trăm (%)</label>
                                                <Input type="number" placeholder="%" value={row.percent} onChange={e => handleChange({ percent: e.target.value, amount: '' })} />
                                            </div>
                                            <div className="col-span-2 opacity-50 pointer-events-none">
                                                <label className="block mb-1 text-xs text-muted-foreground">Số tiền (bị khóa)</label>
                                                <Input disabled placeholder="VND" value="" />
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="col-span-2 opacity-50 pointer-events-none">
                                                <label className="block mb-1 text-xs text-muted-foreground">Phần trăm (bị khóa)</label>
                                                <Input disabled placeholder="%" value="" />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block mb-1 text-xs text-muted-foreground">Số tiền</label>
                                                <Input type="number" placeholder="VND" value={row.amount} onChange={e => handleChange({ amount: e.target.value, percent: '' })} />
                                            </div>
                                        </>
                                    )}

                                    <div className="col-span-1 flex items-end justify-end">
                                        <Button type="button" variant="ghost" onClick={() => onRemoveCommission(idx)}><X className="w-4 h-4" /></Button>
                                    </div>

                                    <div className="col-span-12 text-[11px] text-muted-foreground -mt-1">{computedNote}</div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* 4) Tóm tắt */}
                <section className="p-4 rounded-[8px] border bg-[var(--surface-2)]" style={{ borderColor: 'var(--border)' }}>
                    <h4 className="font-semibold mb-2">4) Tóm tắt</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>Giá gốc: <b>{fmtVND(form.listPrice)}</b></div>
                        <div>Giảm: <b>{form.discountType === 'percent' ? `${form.discountValue || 0}%` : (form.discountType === 'amount' ? fmtVND(form.discountValue) : '0')}</b></div>
                        <div>Giá sau giảm: <b>{fmtVND(calcFinalPrice())}</b></div>
                    </div>
                </section>
            </Popup>

            {/* ===== POPUP: XEM CHI TIẾT ===== */}
            <Popup
                open={openDetails}
                onClose={() => setOpenDetails(false)}
                header={detailsRow ? `Chi tiết hồ sơ: ${detailsRow?.name} — ${detailsRow?.phone}` : 'Chi tiết hồ sơ'}
                widthClass="max-w-3xl"
                footer={<Button variant="secondary" onClick={() => setOpenDetails(false)}><X className="w-4 h-4 mr-2" />Đóng</Button>}
            >
                {detailsRow && (
                    <div className="space-y-4">
                        {/* Info row */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                            <div>
                                <div className="text-xs text-muted-foreground">Khách hàng</div>
                                <div className="font-semibold">{detailsRow.name}</div>
                                <div className="text-xs text-muted-foreground">{detailsRow.phone}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Nhân sự liên quan</div>
                                <div className="text-sm">
                                    {namesFromAssignees(detailsRow.assignees, userMap)}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Trạng thái</div>
                                <div className="text-sm">{detailsRow?.detail?.status || '—'}</div>
                            </div>
                        </div>

                        {/* Notes & Revenue */}
                        <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
                            <div className="p-3 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                                <div className="text-xs text-muted-foreground mb-1">Ghi chú của nhân sự</div>
                                <div className="text-sm whitespace-pre-wrap">{detailsRow?.detail?.notes || '—'}</div>
                            </div>
                        </div>

                        {/* Image Preview — hiển thị mảng invoiceDriveIds */}
                        <div className="p-3 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-xs text-muted-foreground mb-2">Hình ảnh đính kèm</div>
                            {Array.isArray(detailsRow?.detail?.invoiceDriveIds) && detailsRow.detail.invoiceDriveIds.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                    {detailsRow.detail.invoiceDriveIds.map((id, i) => (
                                        <img
                                            key={id || i}
                                            src={driveImage(id)}
                                            alt={`Invoice ${i + 1}`}
                                            className="w-full max-h-[240px] object-cover rounded-md border"
                                            style={{ borderColor: 'var(--border)' }}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground">Chưa có hình ảnh</div>
                            )}
                        </div>

                        {/* Giá & Giảm giá (tóm tắt) */}
                        <div className="p-3 rounded-[8px] border" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-xs text-muted-foreground mb-2">Giá & Giảm giá</div>
                            {(() => {
                                const p = readPricing(detailsRow?.detail);
                                return (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                        <div>Giá gốc: <b>{fmtVND(p.listPrice)}</b></div>
                                        <div>Giảm: <b>{discountLabel(p)}</b></div>
                                        <div>Final: <b>{fmtVND(p.finalPrice)}</b></div>
                                        <div className="md:col-span-3">Doanh thu ghi nhận: <b className="text-green-600">{fmtVND(detailsRow?.detail?.revenue)}</b></div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}
            </Popup>
        </div>
    );
}

/* ===== local state dành cho popup “Xem” ===== */
function useDetailsState() {
    const [openDetails, setOpenDetails] = useState(false);
    const [detailsRow, setDetailsRow] = useState(null);
    return { openDetails, setOpenDetails, detailsRow, setDetailsRow };
}
// dùng: const {openDetails, setOpenDetails, detailsRow, setDetailsRow} = useDetailsState();
