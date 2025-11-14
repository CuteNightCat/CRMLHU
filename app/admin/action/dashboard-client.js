'use client';

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, Title, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Send, Clock, History, Calendar, BarChart2, TrendingUp, TrendingDown } from 'lucide-react';

// Đăng ký các thành phần biểu đồ
ChartJS.register(ArcElement, Tooltip, Legend, Title, BarElement, CategoryScale, LinearScale);

// --- Sub Components ---

const LimitCard = ({ hourly, daily }) => (
    <Card className="shadow-lg">
        <CardHeader>
            <CardTitle className="flex items-center text-base font-semibold"><Clock className="mr-2 h-5 w-5 text-blue-500" />Giới hạn còn lại</CardTitle>
            <CardDescription>Số lượng hành động tối đa</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-center">
            <div><p className="text-2xl font-bold">{hourly}</p><p className="text-xs text-muted-foreground">Theo Giờ</p></div>
            <div><p className="text-2xl font-bold">{daily}</p><p className="text-xs text-muted-foreground">Theo Ngày</p></div>
        </CardContent>
    </Card>
);

const YearlyUsageCard = ({ yearlyData }) => {
    const usagePercentage = ((yearlyData.used / yearlyData.total) * 100).toFixed(2);
    return (
        <Card className="shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center text-base font-semibold"><Calendar className="mr-2 h-5 w-5 text-purple-500" />Sử dụng theo năm</CardTitle>
                <CardDescription>Tổng số hành động đã chạy</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="text-2xl font-bold">{yearlyData.used.toLocaleString('vi-VN')}</span>
                    <span className="text-sm text-muted-foreground">/ {yearlyData.total.toLocaleString('vi-VN')}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-purple-600 h-2.5 rounded-full" style={{ width: `${usagePercentage}%` }}></div></div>
                <p className="text-right text-xs text-muted-foreground mt-1">{usagePercentage}% đã dùng</p>
            </CardContent>
        </Card>
    );
};

const ActionStatCard = ({ title, icon: Icon, color, data }) => (
    <Card className="shadow-lg">
        <CardHeader><CardTitle className="flex items-center text-base font-semibold"><Icon className={`mr-2 h-5 w-5 ${color}`} />{title}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
            <div className="flex justify-between items-center border-b pb-1"><span className="text-sm text-muted-foreground">Tổng chạy</span><span className="font-bold text-lg">{data.total}</span></div>
            <div className="flex justify-between items-center border-b pb-1"><span className="text-sm text-green-600">Thành công</span><span className="font-bold text-green-600">{data.success}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-red-600">Thất bại</span><span className="font-bold text-red-600">{data.failed}</span></div>
        </CardContent>
    </Card>
);

const ActivityLogTable = ({ activities, actionNames }) => (
    <Card className="shadow-lg">
        <CardHeader>
            <CardTitle className="flex items-center"><History className="mr-2 h-5 w-5" />Log Hoạt động Gần đây</CardTitle>
            <CardDescription>Trạng thái các hành động automation.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="max-h-[400px] overflow-y-auto">
                <Table>
                    <TableHeader className="sticky top-0 bg-secondary"><TableRow><TableHead>Trạng thái</TableHead><TableHead>Hành động</TableHead>
                        <TableHead className="text-left">Khách hàng</TableHead>
                        <TableHead className="text-right">Thời gian</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                        {activities.map((log) => (
                            <TableRow key={log._id}>
                                <TableCell>{log.status.status ? <Badge variant="default" className="bg-green-500 hover:bg-green-600">Thành công</Badge> : <Badge variant="destructive">Thất bại</Badge>}</TableCell>
                                <TableCell className="font-medium">{actionNames[log.type] || log.type}</TableCell>
                                <TableCell className="hidden md:table-cell">{log.customer?.name || 'N/A'}</TableCell>
                                <TableCell className="text-right text-xs">{new Date(log.createdAt).toLocaleString('vi-VN')}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
    </Card>
);

// ** Biểu đồ mới **
const ActionPerformanceChart = ({ chartData }) => {
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top' },
            title: { display: true, text: 'Phân tích Hiệu suất Hành động' },
        },
        scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true },
        },
    };

    return (
        <Card className="shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center"><BarChart2 className="mr-2 h-5 w-5" />Hiệu suất Hành động</CardTitle>
                <CardDescription>So sánh số lượng thành công và thất bại.</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] relative">
                <Bar options={options} data={chartData} />
            </CardContent>
        </Card>
    );
};


// --- Main Client Component ---
export default function MessagingStatsClient({ initialData }) {

    const { otherActions, actionNames, performanceChartData } = useMemo(() => {
        const actionNamesMap = {};
        const chartLabels = [];
        const successData = [];
        const failedData = [];
        let otherTotal = 0, otherSuccess = 0, otherFailed = 0;

        for (const key in initialData.byType) {
            const action = initialData.byType[key];
            actionNamesMap[key] = action.name;

            // Chỉ thêm vào biểu đồ nếu có hành động
            if (action.total > 0) {
                chartLabels.push(action.name);
                successData.push(action.success);
                failedData.push(action.failed);
            }

            if (key !== 'sendMessage') {
                otherTotal += action.total;
                otherSuccess += action.success;
                otherFailed += action.failed;
            }
        }

        return {
            otherActions: { total: otherTotal, success: otherSuccess, failed: otherFailed },
            actionNames: actionNamesMap,
            performanceChartData: {
                labels: chartLabels,
                datasets: [
                    { label: 'Thành công', data: successData, backgroundColor: 'rgba(16, 185, 129, 0.7)' },
                    { label: 'Thất bại', data: failedData, backgroundColor: 'rgba(239, 68, 68, 0.7)' }
                ]
            }
        };
    }, [initialData]);

    return (
        <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-gray-50 min-h-screen">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <LimitCard hourly={initialData.zaloLimits.hourly} daily={initialData.zaloLimits.daily} />
                <YearlyUsageCard yearlyData={initialData.zaloLimits.yearly} />
                <ActionStatCard title="Tin nhắn" icon={Send} color="text-blue-500" data={initialData.byType.sendMessage} />
                <ActionStatCard title="Hành động khác" icon={BarChart2} color="text-gray-500" data={otherActions} />
            </div>

            <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    <ActivityLogTable activities={initialData.recentActivities} actionNames={actionNames} />
                </div>
                <div>
                    <ActionPerformanceChart chartData={performanceChartData} />
                </div>
            </div>
        </div>
    );
}
