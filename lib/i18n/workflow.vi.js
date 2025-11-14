// lib/i18n/workflow.vi.js
export function toVNActionType(type) {
    const map = {
        sendMessage: 'Gửi tin nhắn',
        sendNotification: 'Gửi thông báo',
        addFriend: 'Gửi kết bạn',
        delay: 'Trì hoãn',
        webhook: 'Gọi webhook',
    };
    return map[type] || type;
}

export function toVNTriggerType(type) {
    const map = {
        immediate: 'Chạy ngay',
        delay: 'Sau một khoảng thời gian',
        datetime: 'Vào thời điểm cụ thể',
        cron: 'Theo lịch lặp (cron)',
        event: 'Khi xảy ra sự kiện',
        condition: 'Khi điều kiện đúng',
        manual: 'Thủ công',
    };
    return map[type] || type;
}

export function toVNInstanceStatus(s) {
    const map = {
        pending: 'Chờ chạy',
        running: 'Đang chạy',
        paused: 'Tạm dừng',
        completed: 'Hoàn tất',
        failed: 'Lỗi',
        canceled: 'Đã hủy',
    };
    return map[s] || s;
}

export function toVNStepStatus(s) {
    const map = {
        queued: 'Đã xếp hàng',
        running: 'Đang chạy',
        success: 'Thành công',
        skipped: 'Bỏ qua',
        failed: 'Lỗi',
        canceled: 'Đã hủy',
    };
    return map[s] || s;
}

export function formatDate(dt) {
    if (!dt) return '';
    try {
        return new Intl.DateTimeFormat('vi-VN', {
            dateStyle: 'short', timeStyle: 'short'
        }).format(new Date(dt));
    } catch {
        return String(dt);
    }
}

export function formatDelay({ ms, amount, unit } = {}) {
    if (typeof ms === 'number') {
        if (ms < 1000) return `${ms} ms`;
        if (ms < 60_000) return `${Math.round(ms / 1000)} giây`;
        if (ms < 3_600_000) return `${Math.round(ms / 60_000)} phút`;
        return `${Math.round(ms / 3_600_000)} giờ`;
    }
    if (amount && unit) {
        const map = { second: 'giây', minute: 'phút', hour: 'giờ', day: 'ngày' };
        return `${amount} ${map[unit] || unit}`;
    }
    return '';
}

export function presentNodeLabel(node) {
    const base = toVNActionType(node?.type);
    return node?.label ? `${base}: ${node.label}` : base;
}

export function presentEdgeLabel(edge) {
    const t = edge?.trigger;
    if (!t) return edge?.label || '';
    const base = toVNTriggerType(t.type);
    if (t.type === 'delay') return `${base} (${formatDelay(t.delay)})`;
    if (t.type === 'datetime') return `${base} (${formatDate(t.datetime)})`;
    if (t.type === 'event') return t.event?.key
        ? `${base} (${t.event.key})`
        : base;
    if (edge?.label) return `${base} – ${edge.label}`;
    return base;
}
