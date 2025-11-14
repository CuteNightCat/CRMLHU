'use client';
import { useState, useEffect, useMemo, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import styles from './index.module.css';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import AlertPopup from '@/components/(features)/(noti)/alert';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import { cancelScheduleAction } from '@/app/actions/schedule.actions';
import { revalidateData } from '@/app/actions/customer.actions';
import { reloadRunningSchedules } from '@/data/actions/reload';

// --- Sub-Components & Helpers (Không thay đổi nhiều) ---
function formatRemainingTime(ms) {
    if (ms <= 0) return 'Đã hoàn thành';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    let result = 'Còn lại ';
    if (hours > 0) result += `${hours} giờ `;
    if (minutes > 0) result += `${minutes} phút`;
    if (hours === 0 && minutes === 0 && totalSeconds > 0) result += `${totalSeconds} giây`;
    if (result.trim() === 'Còn lại') return 'Sắp xong...';
    return result.trim();
}

const getActionTypeName = (type) => {
    switch (type) {
        case 'findUid': return 'Tìm UID';
        case 'sendMessage': return 'Gửi Tin';
        case 'addFriend': return 'Kết bạn';
        default: return 'Hành động';
    }
}

function SubmitButton({ text = 'Thực hiện' }) {
    const { pending } = useFormStatus();
    return (
        <button type="submit" disabled={pending} className='btn_s_b' >
            <h5>{text}</h5>
        </button>
    );
}
// Component nút trượt mới
function ModeToggleSwitch({ mode, onModeChange }) {
    return (
        <div className={styles.toggleContainer}>
            <button
                className={`${styles.toggleOption} ${mode === 'current' ? styles.toggleActive : ''}`}
                onClick={() => onModeChange('current')}>
                Zalo hiện tại
            </button>
            <button
                className={`${styles.toggleOption} ${mode === 'all' ? styles.toggleActive : ''}`}
                onClick={() => onModeChange('all')}>
                Tất cả
            </button>
        </div>
    );
}
function ActionDetailItem({ job, onShowDetails, onCancel }) {
    const [remainingTime, setRemainingTime] = useState(() => formatRemainingTime(new Date(job.tasks[job.tasks.length - 1].scheduledFor).getTime() - Date.now()));
    const { total, completed, failed } = job.statistics;
    const successPercent = total > 0 ? (completed / total) * 100 : 0;
    const failedPercent = total > 0 ? (failed / total) * 100 : 0;
    useEffect(() => {
        const completionDate = new Date(job.tasks[job.tasks.length - 1].scheduledFor);
        const intervalId = setInterval(() => {
            const msLeft = completionDate.getTime() - new Date().getTime();
            setRemainingTime(formatRemainingTime(msLeft));
        }, 1000);
        return () => clearInterval(intervalId);
    }, [job.estimatedCompletionTime, job.tasks]);


    return (
        <div className={styles.detailItem}>
            <div className={styles.detailHeader}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <h5>{job.jobName}</h5> <h6> Người tạo: {job.createdBy?.name || 'Không rõ'}</h6>
                </div>
                <h6>{job.zaloAccount?.name || 'Không rõ'} - {getActionTypeName(job.actionType)}</h6>
            </div>
            <div className={styles.progressInfo}><h6>Tiến độ: {completed}/{total}</h6><h6 className={styles.timer}>{remainingTime}</h6></div>
            <div className={styles.progressBar}><div className={styles.success} style={{ width: `${successPercent}%` }}></div><div className={styles.failed} style={{ width: `${failedPercent}%`, left: `${successPercent}%` }}></div></div>
            {job.actionType === 'sendMessage' && job.config.messageTemplate && (<div className={styles.messageContent}><h5>Nội dung tin nhắn:</h5><blockquote style={{ marginTop: 5 }}>{job.config.messageTemplate}</blockquote></div>)}
            <div className={styles.detailActions}>
                <button className='btn_s' onClick={() => onShowDetails(job)}><h6 style={{ color: 'var(--text-primary)' }}>Chi tiết danh sách</h6></button>
                <button className='btn_s_b' style={{ background: 'var(--red)' }} onClick={() => onCancel(job)}><h6 style={{ color: 'white' }}>Hủy bỏ lịch</h6></button>
            </div>
        </div>
    );
}
function TaskItem({ task }) {
    const getStatus = () => {
        if (task.status === false) {
            return { key: 'pending', text: 'Đang chờ' };
        }
        // Nếu status là true, kiểm tra history
        if (task.history?.status?.status === true) {
            return { key: 'success', text: 'Thành công' };
        }
        // Mặc định là thất bại nếu status là true nhưng không có history thành công
        return { key: 'failed', text: 'Thất bại' };
    };

    const status = getStatus();
    // Lấy thông báo lỗi từ history
    const errorMessage = task.history?.status?.message;

    return (
        <div className={styles.taskItem}>
            <div className={styles.taskInfo}>
                <h5>{task.person.name}</h5>
                <h6>{task.person.phone}</h6>
                {status.key === 'failed' && (
                    <h6 className={styles.errorMessage}>
                        Lỗi: {errorMessage || 'Không có chi tiết lỗi'}
                    </h6>
                )}
            </div>
            <div className={styles.taskStatusContainer}>
                <div className={`${styles.statusIndicator} ${styles[status.key]}`}></div>
                <h6>{status.text}</h6>
                <h6>{new Date(task.scheduledFor).toLocaleTimeString('vi-VN')}</h6>
            </div>
        </div>
    );
}

export default function RunningActions({ user, running = [] }) {
    useEffect(() => {
        let intervalId = null;
        if (running.length > 0) {
            intervalId = setInterval(() => {
                revalidateData();
                reloadRunningSchedules();
            }, 10000);
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };

    }, [running]);

    const router = useRouter();
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [viewingDetailsFor, setViewingDetailsFor] = useState(null);
    const [activeFilter, setActiveFilter] = useState('all');
    const [jobToCancel, setJobToCancel] = useState(null);
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });
    const [cancelState, cancelAction, isCancelPending] = useActionState(cancelScheduleAction, { success: null, message: null, error: null });

    // State cho các bộ lọc mới
    const [displayMode, setDisplayMode] = useState('current');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDate, setSelectedDate] = useState('');

    const currentZaloId = user?.[0]?.zalo?._id;
    const currentZaloJobs = useMemo(() => {
        if (!currentZaloId) return [];
        return running.filter(job => job.zaloAccount?._id === currentZaloId);
    }, [running, currentZaloId]);

    // Logic lọc và hiển thị
    const jobsToDisplay = useMemo(() => {
        let list = displayMode === 'current' ? currentZaloJobs : running;
        if (searchTerm) {
            const lowercasedFilter = searchTerm.toLowerCase();
            list = list.filter(job =>
                job.jobName.toLowerCase().includes(lowercasedFilter) ||
                job.zaloAccount?.name.toLowerCase().includes(lowercasedFilter)
            );
        }
        if (selectedDate) {
            list = list.filter(job => {
                const jobDate = new Date(job.createdAt).toISOString().split('T')[0];
                return jobDate === selectedDate;
            });
        }
        return list;
    }, [displayMode, currentZaloJobs, running, searchTerm, selectedDate]);

    const categorizedTasks = useMemo(() => {
        if (!viewingDetailsFor) return { pending: [], success: [], failed: [], all: [] };

        const pending = [];
        const success = [];
        const failed = [];

        viewingDetailsFor.tasks.forEach(task => {
            // Logic 1: Nếu status là false, task đang chờ xử lý
            if (task.status === false) {
                pending.push(task);
            } else { // Logic 2: Nếu status là true, task đã được xử lý
                // Logic 2a: Kiểm tra history.status.status để xem thành công hay thất bại
                if (task.history?.status?.status === true) {
                    success.push(task);
                } else {
                    failed.push(task);
                }
            }
        });

        return { pending, success, failed, all: [...pending, ...success, ...failed] };
    }, [viewingDetailsFor]);
    const filteredTasks = useMemo(() => categorizedTasks[activeFilter] || [], [activeFilter, categorizedTasks]);

    useEffect(() => {
        const result = cancelState.message || cancelState.error;
        if (result) {
            setNotification({ open: true, status: cancelState.success, mes: result });
            if (cancelState.success) {
                setJobToCancel(null);
                setIsPopupOpen(false);
                setViewingDetailsFor(null);
            }
        }
    }, [cancelState]);
    if (!running || running.length === 0) return null;
    const handleOpenPopup = () => {
        setDisplayMode('current');
        setSearchTerm('');
        setSelectedDate('');
        setIsPopupOpen(true);
    };
    const handleShowDetails = (job) => { setActiveFilter('all'); setViewingDetailsFor(job); };
    const handleCloseDetails = () => setViewingDetailsFor(null);
    const handleOpenCancelConfirm = (job) => setJobToCancel(job);
    const handleCloseCancelConfirm = () => setJobToCancel(null);
    const handleCloseNoti = () => setNotification(prev => ({ ...prev, open: false }));
    console.log(running);

    return (
        <>
            <button className='btn_s' onClick={handleOpenPopup}>
                <h5>Hiện tại: {currentZaloJobs.length}</h5>
                <div className={styles.separator}></div>
                <h5>Tổng: {running.length}</h5>
            </button>
            <FlexiblePopup
                open={isPopupOpen}
                onClose={() => setIsPopupOpen(false)}
                title={`Hành động đang chạy`}
                width={'600px'}
                renderItemList={() => (
                    <div>
                        <div className={styles.popupControls}>
                            <ModeToggleSwitch mode={displayMode} onModeChange={setDisplayMode} />
                            <input type="text" placeholder="Tìm theo tên lịch, tên zalo..." value={searchTerm} style={{ flex: 1 }} onChange={(e) => setSearchTerm(e.target.value)} className={`input ${styles.searchInput}`} />
                        </div>
                        <div className={`${styles.popupList} scroll`}>
                            {jobsToDisplay.length > 0 ? jobsToDisplay.map(job => (
                                <ActionDetailItem key={job._id} job={job} onShowDetails={handleShowDetails} onCancel={handleOpenCancelConfirm} />
                            )) : (
                                <div className={styles.noJobsText}><h6>Không có hành động nào phù hợp.</h6></div>
                            )}
                        </div>
                    </div>
                )}
                secondaryOpen={!!viewingDetailsFor}
                onCloseSecondary={handleCloseDetails}
                secondaryTitle={`Chi tiết danh sách (${viewingDetailsFor?.tasks?.length || 0})`}
                dataSecondary={viewingDetailsFor}
                width2={'550px'}
                renderSecondaryList={() => (
                    <div className={`${styles.popupList} scroll`}>
                        <div className={styles.filterControls}>
                            <button className={activeFilter === 'all' ? styles.activeFilter : ''} onClick={() => setActiveFilter('all')}><h6>Tất cả ({categorizedTasks.all.length})</h6></button>
                            <button className={activeFilter === 'pending' ? styles.activeFilter : ''} onClick={() => setActiveFilter('pending')}><h6>Đang chờ ({categorizedTasks.pending.length})</h6></button>
                            <button className={activeFilter === 'success' ? styles.activeFilter : ''} onClick={() => setActiveFilter('success')}><h6>Thành công ({categorizedTasks.success.length})</h6></button>
                            <button className={activeFilter === 'failed' ? styles.activeFilter : ''} onClick={() => setActiveFilter('failed')}><h6>Thất bại ({categorizedTasks.failed.length})</h6></button>
                        </div>
                        {filteredTasks.map(task => (<TaskItem key={task._id} task={task} />))}
                    </div>
                )}
            />
            <AlertPopup
                open={!!jobToCancel}
                onClose={handleCloseCancelConfirm}
                title="Xác nhận hủy lịch trình"
                type="warning"
                content={jobToCancel && (<h5>Bạn có chắc chắn muốn hủy vĩnh viễn lịch trình <strong>{jobToCancel.jobName}</strong>? Hành động này không thể hoàn tác.</h5>)}
                actions={
                    <form action={cancelAction}>
                        <input type="hidden" name="jobId" value={jobToCancel?._id || ''} />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={handleCloseCancelConfirm} className='btn_s'><h5>Quay lại</h5></button>
                            <SubmitButton text="Xác nhận Hủy" />
                        </div>
                    </form>
                }
            />
            {isCancelPending && (<div className='loadingOverlay'><Loading content={<h5>Đang hủy lịch...</h5>} /></div>)}
            <Noti open={notification.open} onClose={handleCloseNoti} status={notification.status} mes={notification.mes} />
        </>
    );
}