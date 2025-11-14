'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './index.module.css'
import Menu from '@/components/(ui)/(button)/menu';
import { Svg_Add } from '@/components/(icon)/svg';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import Image from 'next/image';

// CẬP NHẬT: Form thêm mới
function AddTeacherForm({ onSubmit, onClose, isLoading }) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        phone: '',
        address: '',
        role: ['Telesale'],
        group: 'telesale', // MỚI: Thêm trường group với giá trị mặc định
    });
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(formData);
    };
    return (
        <form onSubmit={handleSubmit} className={styles.addTeacherForm}>
            <div className={styles.formGroup}>
                <label>Họ và Tên<span>*</span></label>
                <input type="text" name="name" onChange={handleChange} value={formData.name} className='input' required />
            </div>
            <div className={styles.formGroup}>
                <label>Email<span>*</span></label>
                <input type="email" name="email" onChange={handleChange} value={formData.email} className='input' required />
            </div>
            <div className={styles.formGroup}>
                <label>Mật khẩu<span>*</span></label>
                <input type="password" name="password" onChange={handleChange} value={formData.password} className='input' required />
            </div>
            {/* MỚI: Thêm trường chọn Group */}
            <div className={styles.formGroup}>
                <label>Nhóm<span>*</span></label>
                <select name="group" value={formData.group} onChange={handleChange} className='input' required>
                    <option value="telesale">Telesale</option>
                    <option value="care">Care</option>
                </select>
            </div>
            <div className={styles.formGroup}>
                <label>Số điện thoại</label>
                <input type="tel" name="phone" onChange={handleChange} value={formData.phone} className='input' />
            </div>
            <div className={styles.formGroup}>
                <label>Địa chỉ</label>
                <input type="text" name="address" onChange={handleChange} value={formData.address} className='input' />
            </div>
            <div className={styles.formActions}>
                <button type="button" className='btn_s' onClick={onClose}><h5>Hủy</h5></button>
                <button type="submit" className='btn_s_b' disabled={isLoading}>
                    <h5 style={{ color: 'white' }}>{isLoading ? 'Đang xử lý...' : 'Thêm mới'}</h5>
                </button>
            </div>
        </form>
    );
}

// CẬP NHẬT: Form chỉnh sửa
function EditTeacherForm({ teacherData, onSubmit, onClose, isLoading }) {
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        address: '',
        role: 'Teacher',
        group: 'telesale', // MỚI
    });

    useEffect(() => {
        if (teacherData) {
            setFormData({
                name: teacherData.name || '',
                phone: teacherData.phone || '',
                address: teacherData.address || '',
                role: teacherData.role?.[0] || 'Telesale',
                group: teacherData.group || 'telesale', // MỚI
            });
        }
    }, [teacherData]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(teacherData._id, formData);
    };
    const ROLES = ["Telesale", "Care", "Admin Sale", "Admin", "Manager", "Marketing"];
    return (
        <form onSubmit={handleSubmit} className={styles.addTeacherForm}>
            <div className={styles.formGroup}>
                <label>Họ và Tên</label>
                <input type="text" name="name" onChange={handleChange} value={formData.name} className='input' />
            </div>
            <div className={styles.formGroup}>
                <label>Số điện thoại</label>
                <input type="tel" name="phone" onChange={handleChange} value={formData.phone} className='input' />
            </div>
            <div className={styles.formGroup}>
                <label>Địa chỉ</label>
                <input type="text" name="address" onChange={handleChange} value={formData.address} className='input' />
            </div>
            <div className={styles.formGroup}>
                <label>Quyền</label>
                <select name="role" value={formData.role} onChange={handleChange} className='input'>
                    {ROLES.map(role => (
                        <option key={role} value={role}>{role}</option>
                    ))}
                </select>
            </div>
            {/* MỚI: Thêm trường chọn Group để cập nhật */}
            <div className={styles.formGroup}>
                <label>Nhóm</label>
                <select name="group" value={formData.group} onChange={handleChange} className='input'>
                    <option value="telesale">Telesale</option>
                    <option value="care">Care</option>
                </select>
            </div>
            <div className={styles.formActions}>
                <button type="button" className='btn_s' onClick={onClose}><h5>Hủy</h5></button>
                <button type="submit" className='btn_s_b' disabled={isLoading}>
                    <h5 style={{ color: 'white' }}> {isLoading ? 'Đang lưu...' : 'Lưu thay đổi'}</h5>
                </button>
            </div>
        </form>
    );
}

const Main = ({ initialTeachers }) => {
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('all');
    const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
    const [isAddTeacherPopupOpen, setIsAddTeacherPopupOpen] = useState(false);
    const [isEditTeacherPopupOpen, setIsEditTeacherPopupOpen] = useState(false);
    const [editingTeacher, setEditingTeacher] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [notification, setNotification] = useState({ open: false, status: false, message: '' });

    const handleAddTeacher = async (formData) => {
        // CẬP NHẬT: Thêm điều kiện kiểm tra group
        if (!formData.name || !formData.email || !formData.password || !formData.group) {
            setNotification({ open: true, status: false, message: 'Tên, Email, Mật khẩu và Nhóm là bắt buộc.' });
            return;
        }
        setIsLoading(true);
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const result = await response.json();
            setNotification({
                open: true,
                status: response.ok,
                message: result.message || result.error,
            });
            if (response.ok) {
                setIsAddTeacherPopupOpen(false);
                router.refresh();
            }
        } catch (error) {
            setNotification({ open: true, status: false, message: 'Lỗi kết nối đến máy chủ.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateTeacher = async (teacherId, formData) => {
        setIsLoading(true);
        console.log('Hi🐳');
        try {
            const response = await fetch(`/api/roleuser/${teacherId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const result = await response.json();
            setNotification({
                open: true,
                status: response.ok,
                message: result.message || result.error,
            });
            if (response.ok) {
                setIsEditTeacherPopupOpen(false);
                router.refresh();
            }
        } catch (error) {
            setNotification({ open: true, status: false, message: 'Lỗi kết nối đến máy chủ.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCloseNoti = () => {
        setNotification(prev => ({ ...prev, open: false }));
    };

    const handleOpenEditPopup = (teacher) => {
        setEditingTeacher(teacher);
        setIsEditTeacherPopupOpen(true);
    };

    const filteredTeachers = useMemo(() => {
        return initialTeachers.filter((teacher) => {
            const nameMatch = teacher.name.toLowerCase().includes(searchTerm.toLowerCase())
            const phoneMatch = teacher.phone?.includes(searchTerm)
            const searchMatch = nameMatch || phoneMatch
            if (filterRole === 'all') {
                return searchMatch
            }
            const roleMatch = teacher.role && teacher.role.includes(filterRole)
            return searchMatch && roleMatch
        })
    }, [initialTeachers, searchTerm, filterRole]);

    const allRoles = useMemo(() => {
        const roles = new Set()
        initialTeachers.forEach(teacher => {
            if (teacher.role) {
                teacher.role.forEach(r => roles.add(r))
            }
        })
        return ['all', ...Array.from(roles)]
    }, [initialTeachers]);

    const roleMenuItems = (
        <div className={styles.list_menu}>
            {allRoles.map(role => {
                const displayName = role === 'all' ? 'Tất cả vai trò' : role.charAt(0).toUpperCase() + role.slice(1);
                return (
                    <p key={role} onClick={() => { setFilterRole(role); setIsRoleMenuOpen(false); }} className={`${styles.roleItem} text_6_400`}>
                        {displayName}
                    </p>
                )
            })}
        </div>
    );
    const roleMenuButton = (
        <div className='input' style={{ width: 120, cursor: 'pointer' }}>
            {filterRole === 'all' ? 'Tất cả vai trò' : filterRole.charAt(0).toUpperCase() + filterRole.slice(1)}
        </div>
    );
    return (
        <>
            <div className={styles.filterSection}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="text" placeholder="Tìm kiếm theo tên hoặc số điện thoại..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className='input' style={{ width: '400px' }} />
                    <div>
                        <Menu isOpen={isRoleMenuOpen} onOpenChange={setIsRoleMenuOpen} menuItems={roleMenuItems} menuPosition="bottom" customButton={roleMenuButton} />
                    </div>
                    <div className='btn_s' style={{ padding: 10.5 }} onClick={() => setIsAddTeacherPopupOpen(true)}>
                        <Svg_Add w={'var(--font-size-xs)'} h={'var(--font-size-xs)'} c={'var(--text-primary)'} />
                        <h5>Thêm nhân sự</h5>
                    </div>
                </div>
            </div>
            <div style={{ overflow: 'hidden', flex: 1, overflowY: 'auto', paddingTop: 16 }}>
                {filteredTeachers.length > 0 ? (
                    <div className={styles.teacherGrid}>
                        {filteredTeachers.map((teacher) => (
                            <div key={teacher._id} className={styles.teacherBox} onClick={() => handleOpenEditPopup(teacher)}>
                                <div className={styles.teacherInfo}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 12 }}>
                                        <Image
                                          src={teacher.avt || 'https://lh3.googleusercontent.com/d/1iq7y8VE0OyFIiHmpnV_ueunNsTeHK1bG'}
                                          alt={`Avatar của ${teacher.name}`}
                                          width={40}
                                          height={40}
                                          className="rounded-full"
                                          onError={(e) => { e.target.onerror = null; e.target.src = 'https://lh3.googleusercontent.com/d/1iq7y8VE0OyFIiHmpnV_ueunNsTeHK1bG'; }}
                                        />
                                        <div>
                                            <p className='text_4'>{teacher.name}</p>
                                            <p className='text_6_400'>Chức vụ:  {teacher.role?.join(', ')}</p>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <p className='text_6_400'><strong>Email:</strong> {teacher.email}</p>
                                        <p className='text_6_400'><strong>SĐT:</strong> {teacher.phone}</p>
                                        <p className='text_6_400'><strong>Địa chỉ:</strong> {teacher.address}</p>
                                        {/* MỚI: Hiển thị thông tin nhóm */}
                                        <p className='text_6_400'><strong>Nhóm:</strong> {
                                            (teacher.group === 'telesale' || teacher.group === 'noi_khoa') ? 'Telesale' :
                                                (teacher.group === 'care' || teacher.group === 'ngoai_khoa') ? 'Care' : 'Tất cả'
                                        }</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className={styles.noResults}>Không tìm thấy nhân sự nào.</p>
                )}
            </div>
            <FlexiblePopup
                open={isAddTeacherPopupOpen}
                onClose={() => setIsAddTeacherPopupOpen(false)}
                title="Thêm nhân sự mới"
                width={500}
                renderItemList={() => (
                    <AddTeacherForm
                        onSubmit={handleAddTeacher}
                        isLoading={isLoading}
                        onClose={() => setIsAddTeacherPopupOpen(false)}
                    />
                )}
            />
            <FlexiblePopup
                open={isEditTeacherPopupOpen}
                onClose={() => setIsEditTeacherPopupOpen(false)}
                title="Chỉnh sửa thông tin"
                width={500}
                renderItemList={() => (
                    <EditTeacherForm
                        teacherData={editingTeacher}
                        onSubmit={handleUpdateTeacher}
                        isLoading={isLoading}
                        onClose={() => setIsEditTeacherPopupOpen(false)}
                    />
                )}
            />
            {isLoading && (
                <div className='loadingOverlay' style={{ zIndex: 1100 }}>
                    <Loading content="Đang xử lý..." />
                </div>
            )}
            <Noti
                open={notification.open}
                onClose={handleCloseNoti}
                status={notification.status}
                mes={notification.message}
                button={<button onClick={handleCloseNoti} className="btn" style={{ width: '100%' }}>Đóng</button>}
            />
        </>
    )
}
export default Main;