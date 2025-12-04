'use client';

import { useState } from 'react';
import { 
    Phone, 
    Calendar, 
    MessageSquare, 
    Users, 
    Settings, 
    Workflow, 
    Tag,
    BarChart3,
    ChevronDown,
    ChevronRight,
    BookOpen,
    UserCircle
} from 'lucide-react';

const cn = (...classes) => classes.filter(Boolean).join(' ');

const Accordion = ({ title, icon: Icon, children, isOpen, onToggle }) => (
    <div className="border border-gray-200 rounded-lg mb-4 overflow-hidden">
        <button
            onClick={onToggle}
            className={cn(
                "w-full flex items-center justify-between p-4 text-left transition-colors",
                isOpen ? "bg-blue-50 border-b border-gray-200" : "bg-white hover:bg-gray-50"
            )}
        >
            <div className="flex items-center gap-3">
                {Icon && <Icon className="h-5 w-5 text-blue-600" />}
                <span className="font-semibold text-gray-900">{title}</span>
            </div>
            {isOpen ? (
                <ChevronDown className="h-5 w-5 text-gray-500" />
            ) : (
                <ChevronRight className="h-5 w-5 text-gray-500" />
            )}
        </button>
        {isOpen && (
            <div className="p-4 bg-white">
                {children}
            </div>
        )}
    </div>
);

export default function GuideContent() {
    const [openSections, setOpenSections] = useState({
        overview: true,
        customer: false,
        call: false,
        calendar: false,
        workflow: false,
        settings: false,
    });

    const toggleSection = (section) => {
        setOpenSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <BookOpen className="h-8 w-8 text-blue-600" />
                    <h1 className="text-3xl font-bold text-gray-900">Hướng dẫn sử dụng hệ thống</h1>
                </div>
                <p className="text-gray-600 mt-2">
                    Tài liệu hướng dẫn chi tiết về các chức năng và cách sử dụng hệ thống quản lý tuyển sinh CRM LHU
                </p>
            </div>

            {/* Tổng quan hệ thống */}
            <Accordion
                title="Tổng quan hệ thống"
                icon={BookOpen}
                isOpen={openSections.overview}
                onToggle={() => toggleSection('overview')}
            >
                <div className="space-y-4">
                    <p className="text-gray-700 leading-relaxed">
                        Hệ thống CRM LHU là một nền tảng quản lý tuyển sinh toàn diện, được thiết kế để hỗ trợ 
                        quản lý khách hàng, cuộc gọi, lịch hẹn, workflow tự động và nhiều tính năng khác.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div className="bg-blue-50 p-4 rounded-lg">
                            <h3 className="font-semibold text-blue-900 mb-2">📋 Các module chính:</h3>
                            <ul className="text-blue-800 space-y-1 text-sm">
                                <li>• Quản lý khách hàng (Tuyển sinh)</li>
                                <li>• Hệ thống cuộc gọi (OMICall)</li>
                                <li>• Quản lý lịch hẹn</li>
                                <li>• Nhắn tin Zalo</li>
                                <li>• Workflow tự động</li>
                                <li>• Thống kê & Báo cáo</li>
                            </ul>
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg">
                            <h3 className="font-semibold text-green-900 mb-2">🎯 Mục đích sử dụng:</h3>
                            <ul className="text-green-800 space-y-1 text-sm">
                                <li>• Quản lý toàn bộ quy trình tuyển sinh</li>
                                <li>• Tự động hóa các tác vụ lặp lại</li>
                                <li>• Theo dõi hiệu quả làm việc</li>
                                <li>• Tối ưu hóa trải nghiệm khách hàng</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </Accordion>

            {/* Quản lý khách hàng */}
            <Accordion
                title="Quản lý khách hàng (Tuyển sinh)"
                icon={UserCircle}
                isOpen={openSections.customer}
                onToggle={() => toggleSection('customer')}
            >
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900">Các chức năng chính:</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">1. Xem danh sách khách hàng</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Truy cập tab <strong>"Tuyển sinh"</strong> để xem toàn bộ danh sách khách hàng.
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Sử dụng bộ lọc để tìm kiếm khách hàng theo nhiều tiêu chí</li>
                            <li>Xem thông tin chi tiết: tên, số điện thoại, ngành học quan tâm, trạng thái</li>
                            <li>Theo dõi lịch sử tương tác và lịch sử cuộc gọi</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">2. Tạo khách hàng mới</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Khách hàng có thể được tạo tự động từ:
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li><strong>Form đăng ký:</strong> Khách hàng điền form trên website</li>
                            <li><strong>API tự động:</strong> Từ hệ thống bên ngoài</li>
                            <li><strong>Thủ công:</strong> Nhân viên tự tạo trong hệ thống</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">3. Các tab thông tin khách hàng</h4>
                        <ul className="text-sm text-gray-600 space-y-2">
                            <li><strong>Lịch trình:</strong> Xem các lịch hẹn và công việc đã lên lịch</li>
                            <li><strong>Lịch sử:</strong> Xem toàn bộ lịch sử tương tác với khách hàng</li>
                            <li><strong>Thông tin:</strong> Chi tiết thông tin cá nhân và ngành học quan tâm</li>
                            <li><strong>Lịch hẹn:</strong> Quản lý các cuộc hẹn với khách hàng</li>
                            <li><strong>Cuộc gọi:</strong> Xem lịch sử và thực hiện cuộc gọi</li>
                            <li><strong>Zalo:</strong> Quản lý tin nhắn Zalo với khách hàng</li>
                        </ul>
                    </div>

                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                        <p className="text-sm text-yellow-800">
                            <strong>💡 Lưu ý:</strong> Hệ thống tự động phân bổ khách hàng cho nhân viên 
                            dựa trên cấu hình. Khách hàng mới sẽ được gán cho nhân viên phù hợp tự động.
                        </p>
                    </div>
                </div>
            </Accordion>

            {/* Hệ thống cuộc gọi */}
            <Accordion
                title="Hệ thống cuộc gọi (OMICall)"
                icon={Phone}
                isOpen={openSections.call}
                onToggle={() => toggleSection('call')}
            >
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900">Cách sử dụng cuộc gọi:</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">1. Thực hiện cuộc gọi</h4>
                        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside ml-2">
                            <li>Mở popup khách hàng từ tab <strong>"Tuyển sinh"</strong></li>
                            <li>Chuyển sang tab <strong>"Cuộc gọi"</strong> ở sidebar bên phải</li>
                            <li>Kiểm tra trạng thái kết nối (phải là "Đã kết nối")</li>
                            <li>Nhấn nút <strong>"Gọi"</strong> để bắt đầu cuộc gọi</li>
                            <li>Hệ thống sẽ tự động ghi âm cuộc gọi khi khách hàng bắt máy</li>
                        </ol>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">2. Trạng thái cuộc gọi</h4>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li><strong>Đang kết nối:</strong> Hệ thống đang thiết lập cuộc gọi</li>
                            <li><strong>Đang đổ chuông:</strong> Đang chờ khách hàng bắt máy</li>
                            <li><strong>Đang trong cuộc gọi:</strong> Cuộc gọi đã được kết nối</li>
                            <li><strong>Sẵn sàng:</strong> Sẵn sàng để thực hiện cuộc gọi mới</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">3. Lịch sử cuộc gọi</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Xem lại các cuộc gọi đã thực hiện:
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Xem danh sách tất cả cuộc gọi với khách hàng</li>
                            <li>Nghe lại ghi âm cuộc gọi</li>
                            <li>Tải về file ghi âm nếu cần</li>
                            <li>Xem thời lượng và trạng thái cuộc gọi</li>
                        </ul>
                    </div>

                    <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded">
                        <p className="text-sm text-red-800">
                            <strong>⚠️ Lưu ý:</strong> Để sử dụng tính năng gọi, bạn cần:
                        </p>
                        <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside ml-2">
                            <li>Có quyền truy cập microphone trên trình duyệt</li>
                            <li>Kết nối internet ổn định</li>
                            <li>Trạng thái kết nối tổng đài phải là "Đã kết nối"</li>
                        </ul>
                    </div>
                </div>
            </Accordion>

            {/* Quản lý lịch hẹn */}
            <Accordion
                title="Quản lý lịch hẹn"
                icon={Calendar}
                isOpen={openSections.calendar}
                onToggle={() => toggleSection('calendar')}
            >
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900">Cách quản lý lịch hẹn:</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">1. Tạo lịch hẹn</h4>
                        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside ml-2">
                            <li>Từ popup khách hàng, chuyển sang tab <strong>"Lịch trình"</strong></li>
                            <li>Nhấn nút <strong>"Tạo lịch hẹn"</strong></li>
                            <li>Điền thông tin: ngày giờ, loại hẹn, ngành học, ghi chú</li>
                            <li>Xác nhận để tạo lịch hẹn</li>
                        </ol>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">2. Các loại lịch hẹn</h4>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li><strong>Phỏng vấn:</strong> Cuộc hẹn phỏng vấn với khách hàng</li>
                            <li><strong>Phẫu thuật:</strong> Lịch hẹn cho các dịch vụ phẫu thuật</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">3. Tính năng tự động</h4>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Hệ thống tự động gửi nhắc nhở trước lịch hẹn</li>
                            <li>Cập nhật trạng thái pipeline của khách hàng</li>
                            <li>Kích hoạt workflow tự động (nếu có cấu hình)</li>
                            <li>Ghi log vào lịch sử chăm sóc khách hàng</li>
                        </ul>
                    </div>
                </div>
            </Accordion>

            {/* Workflow */}
            <Accordion
                title="Quản lý Workflow"
                icon={Workflow}
                isOpen={openSections.workflow}
                onToggle={() => toggleSection('workflow')}
            >
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900">Workflow tự động:</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">1. Khái niệm Workflow</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Workflow là một chuỗi các bước tự động được thực hiện theo thứ tự để xử lý 
                            các tác vụ lặp lại trong quy trình tuyển sinh.
                        </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">2. Các loại Workflow chính</h4>
                        <ul className="text-sm text-gray-600 space-y-2">
                            <li>
                                <strong>Workflow tìm UID Zalo:</strong> Tự động tìm ID Zalo của khách hàng
                            </li>
                            <li>
                                <strong>Workflow gửi tin nhắn:</strong> Tự động gửi tin nhắn chào hỏi, 
                                giới thiệu ngành học
                            </li>
                            <li>
                                <strong>Workflow phân bổ:</strong> Tự động phân bổ khách hàng cho nhân viên
                            </li>
                            <li>
                                <strong>Workflow nhắc nhở:</strong> Gửi thông báo, nhắc nhở cho nhân viên
                            </li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">3. Workflow Chain (Chuỗi Workflow)</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Khi khách hàng mới được tạo, hệ thống sẽ tự động chạy chuỗi workflow:
                        </p>
                        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside ml-2">
                            <li>Tìm UID Zalo của khách hàng</li>
                            <li>Gửi tin nhắn chào hỏi tự động</li>
                            <li>Phân bổ khách hàng cho nhân viên phù hợp</li>
                            <li>Gửi thông báo cho nhân viên được phân bổ</li>
                        </ol>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">4. Quản lý Workflow</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Để quản lý workflow, truy cập tab <strong>"Cài đặt"</strong> → 
                            <strong>"Quản lý Workflow"</strong>:
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Tạo workflow mới với các bước tùy chỉnh</li>
                            <li>Chỉnh sửa workflow hiện có</li>
                            <li>Xem trạng thái và lịch sử chạy workflow</li>
                            <li>Cấu hình điều kiện kích hoạt workflow</li>
                        </ul>
                    </div>
                </div>
            </Accordion>

            {/* Cài đặt */}
            <Accordion
                title="Cài đặt hệ thống"
                icon={Settings}
                isOpen={openSections.settings}
                onToggle={() => toggleSection('settings')}
            >
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900">Các mục cài đặt:</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">1. Quản lý ngành học</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Quản lý danh sách các ngành học, chương trình đào tạo và chi phí:
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Thêm, sửa, xóa ngành học</li>
                            <li>Cấu hình chương trình và chi phí</li>
                            <li>Thiết lập tin nhắn tự động cho từng ngành</li>
                            <li>Phân loại ngành học (telesale/care)</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">2. Quản lý thẻ (Label)</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Tạo và quản lý các nhãn để phân loại khách hàng:
                        </p>
                        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside ml-2">
                            <li>Tạo nhãn mới với tên và màu sắc</li>
                            <li>Gán nhãn cho khách hàng</li>
                            <li>Lọc khách hàng theo nhãn</li>
                        </ul>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">3. Quản lý Workflow</h4>
                        <p className="text-sm text-gray-700 mb-2">
                            Xem phần <strong>"Quản lý Workflow"</strong> ở trên để biết chi tiết.
                        </p>
                    </div>

                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                        <p className="text-sm text-yellow-800">
                            <strong>🔒 Lưu ý:</strong> Chỉ người dùng có quyền <strong>Admin</strong> hoặc 
                            <strong>Manager</strong> mới có thể truy cập các trang cài đặt.
                        </p>
                    </div>
                </div>
            </Accordion>

            {/* Footer */}
            <div className="mt-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">📞 Hỗ trợ</h3>
                <p className="text-sm text-blue-800">
                    Nếu bạn gặp vấn đề hoặc cần hỗ trợ thêm, vui lòng liên hệ với đội ngũ kỹ thuật 
                    hoặc quản trị viên hệ thống.
                </p>
            </div>
        </div>
    );
}
