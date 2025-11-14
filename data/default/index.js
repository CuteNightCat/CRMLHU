export function ProfileDefault(name) {
    return {
        Avatar: "",
        ImgPJ: [],
        ImgSkill: "",
        Intro: `Xin chào! tên tôi là ${name}, tôi là học viên của trung tâm AI ROBOTIC. Tôi rất đam mê với công nghệ và đặc biệt là trí tuệ nhân tạo với robotic vì vậy tôi đã đăng ký khóa học này để thỏa mãn đam mê của mình.
        Theo tôi đây là một khóa học vô cùng thú vị bởi vì khóa học áp dụng phương pháp STEM có lý thuyết có thức hành và mỗi buổi tôi đều có thể tạo ra được một mô hình liên quan đến chủ đề học.
        Tôi thích từng bước của quá trình học tập AI ROBOTIC Từ lý thuyết đến lắp ráp robot rồi đến lập trình mô hình.`,
        Present: [],
        Skill: {
            "Sự tiến bộ và Phát triển": "100",
            "Kỹ năng giao tiếp": "100",
            "Diễn giải vấn đề": "100",
            "Tự tin năng động": "100",
            "Đổi mới sáng tạo": "100",
            "Giao lưu hợp tác": "100"
        }
    }
}

export function statusStudent({ type = 0, status = 0, courseId = null }) {
    if (type === 1) {
        // Hoàn thành khóa học
        return {
            status: status[0],
            act: status[1],
            date: new Date(),
            note: `Hoàn thành khóa học ${courseId ? courseId : 'Chữa xác định'}`
        }
    } else if (type === 2) {
        // Tham gia khóa học
        return {
            status: status[0],
            act: status[1],
            date: new Date(),
            note: `Tham gia khóa học ${courseId ? courseId : 'Chữa xác định'}`
        }
    } else if (type === 0) {
        // Tạo học sinh mới
        return {
            status: 1,
            act: 'chờ',
            date: new Date(),
            note: 'Tham gia AI ROBOTIC'
        }
    }

}