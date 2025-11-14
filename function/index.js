export function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    if (day == 'NaN' || month == 'NaN' || year == 'NaN') return 'Thiếu thông tin'
    return `${day}/${month}/${year}`;
}
export function countStudentsWithLesson(lessonId, data) {
    let count = 0;

    for (const student of data) {
        const hasLesson = student.Learn.some(entry => entry.Lesson === lessonId);
        if (hasLesson) {
            count++;
        }
    }

    return count;
}

export function calculatePastLessons(courseData) {
    let pastLessonsCount = 0;
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    courseData.Detail.forEach(lesson => {
        const lessonDate = new Date(lesson.Day);
        lessonDate.setHours(0, 0, 0, 0);

        if (lessonDate < currentDate) {
            pastLessonsCount++;
        }
    });

    return pastLessonsCount;
}

export function srcImage(id) {
    return `https://lh3.googleusercontent.com/d/${id}`
}

export function formatCurrencyVN(number) {
    if (typeof number !== 'number' || isNaN(number)) {
        return '0 VNĐ';
    }
    const formattedNumber = number.toLocaleString('vi-VN');
    return `${formattedNumber} VNĐ`;
}

export const truncateString = (str, start, end) => !str ? "" : str.length > start + end ? `${str.slice(0, start)}...${str.slice(-end)}` : str;
export const driveImage = (input) => {
    if (!input) return null;

    const normalizeString = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object') {
            // Một số API trả về { id, url } hoặc { driveId }
            if (value.url) return normalizeString(value.url);
            if (value.driveId) return normalizeString(value.driveId);
            if (value.id) return normalizeString(value.id);
        }
        return String(value).trim();
    };

    const raw = normalizeString(input);
    if (!raw) return null;

    // Nếu đã là link googleusercontent hợp lệ -> trả nguyên vẹn
    if (/^https?:\/\/lh\d*\.googleusercontent\.com\//i.test(raw)) {
        return raw;
    }

    // Nếu là link Google Drive phổ biến -> tách ID
    const driveIdMatch = raw.match(/(?:\/d\/|id=)([\w-]+)/);
    if (driveIdMatch && driveIdMatch[1]) {
        return `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`;
    }

    // Nếu là link http/https khác -> dùng trực tiếp
    if (/^https?:\/\//i.test(raw)) {
        return raw;
    }

    // Mặc định coi như chỉ có ID
    return `https://lh3.googleusercontent.com/d/${raw}`;
};


export function formatDelay(ms) {
    if (typeof ms !== 'number' || ms < 0) return 'Thời gian không hợp lệ';
    const min = ms / 60000;
    if (min === 0) return '0 phút';
    if (min >= 1440) return (min / 1440).toFixed(1) + ' ngày'; // .toFixed(1) cho đẹp hơn
    if (min >= 60) return (min / 60).toFixed(1) + ' giờ'; // .toFixed(1) cho đẹp hơn
    return min.toFixed(0) + ' phút';
}

// Chuyển status code thành text
const statusMap = {
    // ... (nội dung giống hệt ở trên) ...
    'new_unconfirmed_1': 'Data mới',
    'missing_info_1': 'Thiếu thông tin',
    'not_valid_1': 'Không hợp lệ',
    'duplicate_merged_1': 'Trùng lặp (đã gộp)',
    'rejected_immediate_1': 'Từ chối ngay',
    'valid_1': 'Hợp lệ (chờ xử lý)',
    'msg_success_2': 'Gửi tin nhắn thành công',
    'msg_error_2': 'Gửi tin nhắn thất bại',
    'noikhoa_3': 'Đã phân bổ: Telesale',
    'ngoaikhoa_3': 'Đã phân bổ: Care',
    'undetermined_3': 'Chưa phân bổ',
    'consulted_pending_4': 'Đã tư vấn, chờ quyết định',
    'scheduled_unconfirmed_4': 'Đã lên lịch, chưa xác nhận',
    'callback_4': 'Yêu cầu gọi lại',
    'not_interested_4': 'Không quan tâm',
    'no_contact_4': 'Không liên lạc được',
    'confirmed_5': 'Lịch hẹn đã xác nhận',
    'postponed_5': 'Lịch hẹn đã hoãn',
    'canceled_5': 'Lịch hẹn đã hủy',
    'serviced_completed_6': 'Đăng ký đã hoàn tất',
    'serviced_in_progress_6': 'Đăng ký đang xử lý',
    'rejected_after_consult_6': 'Từ chối sau tư vấn'
};

export function getStatusInVietnamese(statusKey, defaultValue = 'Trạng thái không xác định') {
    return statusMap[statusKey] || defaultValue;
}

export function maskPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string' || phone.length < 10) {
        // Trả về số điện thoại gốc nếu nó quá ngắn để che
        return phone || '';
    }
    const prefix = phone.slice(0, 2);
    const suffix = phone.slice(-2);
    const mask = 'xxxxxx';
    return `${prefix}${mask}${suffix}`;
}


export function getCurrentStageFromPipeline(customer) {
    const arr = Array.isArray(customer?.pipelineStatus)
        ? customer.pipelineStatus
        : (customer?.pipelineStatus ? [customer.pipelineStatus] : []);

    // arr[0] = code hiện tại, arr[1..6] = đã qua các bước 1..6
    let highestStep = 0; // 0 nghĩa là chưa vào bước nào (sẽ mặc định mở bước 1)
    for (let i = 1; i <= 6; i++) {
        if (typeof arr[i] !== 'undefined' && arr[i] !== null) {
            highestStep = i;         // có phần tử tại vị trí i => đã tới bước i
        } else {
            // Nếu dữ liệu đảm bảo đi theo thứ tự, có thể break để tối ưu:
            // break;
        }
    }
    const currentStageId = highestStep === 0 ? 1 : highestStep; // 1..6
    const currentStageIndex = currentStageId - 1;               // 0..5 (dùng cho Accordion)
    return { currentStageId, currentStageIndex };
}