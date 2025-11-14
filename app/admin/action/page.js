import DashboardClient from "./dashboard-client";
import { Navbar } from "../nav";
import { history_data } from '@/data/actions/get';
export default async function AdminPage() {
    const historyResult = await history_data();
    const historyData = processHistoryData(historyResult.success ? historyResult : { data: [] });
    console.log(historyData);

    return (
        <>
            <Navbar />
            <DashboardClient initialData={historyData} />
        </>
    );
}

// Hỗ trợ
function processHistoryData(history) {
    if (!history || !history.data || history.data.length === 0) {
        return {
            byType: {},
            overall: {
                total: 0,
                success: 0,
                failed: 0,
                successRate: 0
            },
            recentActivities: [],
            zaloLimits: {
                hourly: 0,
                daily: 0,
                yearly: {
                    total: 200000,
                    used: 0,
                    remaining: 200000
                }
            }
        };
    }

    const stats = {
        byType: {
            sendMessage: {
                name: 'Gửi tin nhắn',
                total: 0,
                success: 0,
                failed: 0
            },
            addFriend: {
                name: 'Kết bạn',
                total: 0,
                success: 0,
                failed: 0
            },
            findUid: {
                name: 'Tìm UID',
                total: 0,
                success: 0,
                failed: 0
            },
            checkFriend: {
                name: 'Kiểm tra bạn bè',
                total: 0,
                success: 0,
                failed: 0
            },
            tag: {
                name: 'Gắn thẻ',
                total: 0,
                success: 0,
                failed: 0
            }
        },
        overall: {
            total: 0,
            success: 0,
            failed: 0
        },
        zaloLimits: {
            hourly: history.zaloLimits?.hourly || 0,
            daily: history.zaloLimits?.daily || 0,
            yearly: {
                total: 200000,
                used: 0,
                remaining: 200000
            }
        }
    };

    // Xử lý các loại sự kiện
    history.data.forEach((log) => {
        if (stats.byType[log.type]) {
            stats.byType[log.type].total++;
            stats.overall.total++;
            if (log.status?.status) {
                stats.byType[log.type].success++;
                stats.overall.success++;
            } else {
                stats.byType[log.type].failed++;
                stats.overall.failed++;
            }
        }
    });

    // Tính toán giới hạn theo năm
    const currentYear = new Date().getFullYear();

    // Lọc ra số tin nhắn gửi thành công trong năm hiện tại
    const yearlyMessagesSent = history.data.filter(log => {
        // Kiểm tra loại tin và trạng thái thành công
        if (log.type === 'sendMessage' && log.status?.status) {
            // Kiểm tra năm gửi
            const logDate = new Date(log.createdAt);
            return logDate.getFullYear() === currentYear;
        }
        return false;
    }).length;

    // Cập nhật giới hạn năm
    stats.zaloLimits.yearly.used = yearlyMessagesSent;
    stats.zaloLimits.yearly.remaining = Math.max(0, 200000 - yearlyMessagesSent);

    // Calculate success rates
    for (const type in stats.byType) {
        const typeStats = stats.byType[type];
        typeStats.successRate = typeStats.total > 0 ? ((typeStats.success / typeStats.total) * 100).toFixed(1) : '0.0';
    }
    stats.overall.successRate = stats.overall.total > 0 ? ((stats.overall.success / stats.overall.total) * 100).toFixed(1) : '0.0';

    return {
        ...stats,
        recentActivities: history.data.slice(0, 50) // Get latest 50 activities
    };
}
