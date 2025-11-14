
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

// CheckProfileDone: Hàm kiểm tra xem học sinh đã hoàn thành hồ sơ điện tử hay chưa
export function CheckProfileDone(student) {
    const profile = student.Profile;
    if (!profile) {
        return false;
    }
    const hasBasicInfo = profile.Intro && profile.Avatar && profile.ImgSkill;
    if (!hasBasicInfo) return false;
    const hasEnoughProjects = profile.ImgPJ && profile.ImgPJ.length > 2;
    if (!hasEnoughProjects) return false;
    const requiredSkills = [
        "Sự tiến bộ và Phát triển", "Kỹ năng giao tiếp", "Diễn giải vấn đề",
        "Tự tin năng động", "Đổi mới sáng tạo", "Giao lưu hợp tác"
    ];
    const skillData = profile.Skill || {};
    const hasAllSkills = requiredSkills.every(
        key => skillData[key] && Number(skillData[key]) > 0
    );
    if (!hasAllSkills) return false;
    const completedCourses = student.Course.filter(c => c.status === 2);
    const presentations = profile.Present || [];
    if (presentations.length !== completedCourses.length) {
        return false;
    }
    const allPresentationsComplete = presentations.every(p =>
        p.course && p.bookId && p.bookName && p.Video && p.Img && p.Comment
    );
    if (!allPresentationsComplete) return false;
    return true;
}

// CheckSlide: Hàm kiểm tra đường dẫn Google Slides
export async function CheckSlide(url) {
    if (!url) return { isValid: true };

    const googleSlidesRegex = /^https:\/\/docs\.google\.com\/presentation\/d\/[a-zA-Z0-9_-]+/;
    if (!googleSlidesRegex.test(url)) {
        return { isValid: false, message: 'Link Slide không đúng định dạng của Google Slides.' };
    }

    try {
        const response = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (response.url.includes('accounts.google.com')) {
            return { isValid: false, message: 'Link Google Slides phải được chia sẻ công khai (public).' };
        }
        if (!response.ok) {
            return { isValid: false, message: `Link Slide không truy cập được, status code: ${response.status}.` };
        }
        return { isValid: true };
    } catch (error) {
        console.error("Lỗi khi kiểm tra URL Slide:", error);
        return { isValid: false, message: 'Không thể xác thực được URL của Slide do lỗi mạng.' };
    }
}

// CheckRole: Hàm kiểm tra token lấy role người dùng
export async function CheckRole() {
    const cookieStore = await cookies();
    const token = cookieStore.get(process.env.token)?.value;
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    return token ? decodedToken : null;
}