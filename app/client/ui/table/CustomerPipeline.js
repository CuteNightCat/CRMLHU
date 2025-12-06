'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    MessageSquare, CheckCircle2, CircleDot, Circle, UserCheck, UserX, UserSearch,
    MessageSquareText, MessageSquareX, CheckCircle, User, Pencil, Trash2,
    ShieldCheck, BadgeCheck, Loader2, PlusCircle, Send,
} from 'lucide-react';
import { getCurrentStageFromPipeline, driveImage } from '@/function/index';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import Popup from '@/components/ui/popup';
import CloseServiceForm from './CloseServiceForm';

// Actions
import {
    updateServiceDetailAction,
    deleteServiceDetailAction,
    closeServiceAction,
} from '@/data/customers/wraperdata.db';
import { updateSubWorkflowConfigAction } from '@/app/actions/customer.actions';

import { useActionFeedback as useAction } from '@/hooks/useAction';

/* ============================== Helpers ============================== */
const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

function CareNoteItem({ note }) {
    return (
        <div className="flex gap-3 items-start py-2">
            <Avatar className="h-8 w-8">
                <AvatarImage src={note.createBy?.avt || undefined} alt={note.createBy?.name} />
                <AvatarFallback>{note.createBy?.name?.charAt(0) || 'S'}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <div className="flex justify-between items-center">
                    <h6 className="font-semibold">{note.createBy?.name || 'Hệ thống'}</h6>
                    <h6 className="text-xs text-muted-foreground">{new Date(note.createAt).toLocaleString('vi-VN')}</h6>
                </div>
                <h6 className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{note.content}</h6>
            </div>
        </div>
    );
}

function AddNoteForm({ customerId, dispatchAddNote, isNotePending, noteState, currentStep }) {
    const formRef = useRef(null);
    useEffect(() => { if (noteState?.success) formRef.current?.reset(); }, [noteState]);

    return (
        <form action={dispatchAddNote} ref={formRef} className="flex gap-3 items-start pt-3 mt-3 border-t">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="step" value={currentStep} />
            <Textarea name="content" placeholder="Thêm ghi chú..." className="flex-1 text-sm" rows={2} required disabled={isNotePending} />
            <Button type="submit" size="icon" disabled={isNotePending}>
                {isNotePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            </Button>
        </form>
    );
}

const DEFAULT_SUBWORKFLOW_CONFIG = {
    selectedWorkflowId: '',
    enabled: true,
    repeatCount: 1,
    intervalValue: 1,
    intervalUnit: 'seconds',
    startDate: null, // Date object
    startTime: '', // Time string (HH:mm)
};

const INTERVAL_UNITS = [
    { value: 'seconds', label: 'Giây' },
    { value: 'minutes', label: 'Phút' },
    { value: 'hours', label: 'Giờ' },
    { value: 'days', label: 'Ngày' },
    { value: 'months', label: 'Tháng' },
];

const getStep1Status = (customer) => {
    // Kiểm tra nếu uid === null (đã cố tìm nhưng thất bại)
    if (customer.uid === null) {
        return { text: 'Tìm thất bại', Icon: UserX, className: 'bg-red-100 text-red-800' };
    }
    
    // Kiểm tra nếu uid là array và có ít nhất 1 entry có uid hợp lệ - ƯU TIÊN CAO NHẤT
    if (Array.isArray(customer.uid) && customer.uid.length > 0) {
        const hasValidUid = customer.uid.some(u => u && u.uid && u.uid.trim() !== '');
        if (hasValidUid) {
            return { text: 'Tìm thành công', Icon: UserCheck, className: 'bg-green-100 text-green-800' };
        }
    }
    
    // Kiểm tra xem đã có care log về tìm UID thành công chưa
    const hasFindUidSuccessLog = customer.care?.some(note => 
        note.content?.includes('Tìm thành công UID') ||
        note.content?.includes('tìm thấy UID') ||
        (note.content?.includes('Tìm thành công') && note.content?.includes('UID'))
    );
    
    if (hasFindUidSuccessLog) {
        // Đã có log thành công nhưng có thể uid chưa được lưu vào array -> vẫn hiển thị thành công
        return { text: 'Tìm thành công', Icon: UserCheck, className: 'bg-green-100 text-green-800' };
    }
    
    // Kiểm tra xem đã có care log về tìm UID thất bại chưa
    const hasFindUidFailLog = customer.care?.some(note => 
        note.content?.includes('Tìm UID thất bại') ||
        (note.content?.includes('Tìm') && note.content?.includes('thất bại') && note.content?.includes('UID'))
    );
    
    if (hasFindUidFailLog) {
        return { text: 'Tìm thất bại', Icon: UserX, className: 'bg-red-100 text-red-800' };
    }
    
    // Mặc định: chưa tìm UID
    return { text: 'Chưa tìm UID', Icon: UserSearch, className: 'bg-gray-100 text-gray-800' };
};
const getStep2Status = (customer) => {
    if (!customer.care || !Array.isArray(customer.care)) {
        return null;
    }
    
    // Kiểm tra care log về gửi tin nhắn thành công
    const successNote = customer.care.find(n => 
        n.content?.includes('Gửi tin nhắn Zalo] đã hoàn thành thành công') ||
        (n.content?.includes('Gửi tin nhắn Zalo') && n.content?.includes('thành công'))
    );
    if (successNote) {
        return { text: 'Gửi tin thành công', Icon: MessageSquareText, className: 'bg-green-100 text-green-800' };
    }
    
    // Kiểm tra care log về gửi tin nhắn thất bại
    const failNote = customer.care.find(n => 
        n.content?.includes('Gửi tin nhắn Zalo] thất bại') ||
        (n.content?.includes('Gửi tin nhắn Zalo') && n.content?.includes('thất bại'))
    );
    if (failNote) {
        return { text: 'Gửi tin thất bại', Icon: MessageSquareX, className: 'bg-red-100 text-red-800' };
    }
    
    return null;
};
const getStep3Status = (customer) => {
    if (Array.isArray(customer.assignees) && customer.assignees.length > 0) {
        const last = customer.assignees[customer.assignees.length - 1];
        if (last.group === 'care' || last.group === 'CareService') return { text: 'Phân bổ: Care', Icon: User, className: 'bg-purple-100 text-purple-800' };
        if (last.group === 'telesale' || last.group === 'telesale_TuVan') return { text: 'Phân bổ: Telesale', Icon: User, className: 'bg-indigo-100 text-indigo-800' };
    }
    return { text: 'Chưa phân bổ', Icon: User, className: 'bg-gray-100 text-gray-800' };
};
const getStep5Status = (customer) => {
    const hasAppointment = customer.pipelineStatus === 'appointed' || customer.care.some(n => n.content?.includes('Đặt lịch hẹn'));
    if (hasAppointment) return { text: 'Đã có lịch hẹn', Icon: CheckCircle, className: 'bg-green-100 text-green-800' };
    return null;
};
const getStep6Status = (customer) => {
    const list = Array.isArray(customer.serviceDetails) ? customer.serviceDetails : (customer.serviceDetails ? [customer.serviceDetails] : []);
    if (list.length === 0) return null;
    const approvedCount = list.filter(d => d.approvalStatus === 'approved').length;
    const pendingCount = list.filter(d => d.approvalStatus !== 'approved').length;
    if (approvedCount > 0) return { text: `${approvedCount} đơn đã duyệt`, Icon: CheckCircle, className: 'bg-green-100 text-green-800' };
    if (pendingCount > 0) return { text: `${pendingCount} đơn chờ duyệt`, Icon: CircleDot, className: 'bg-amber-100 text-amber-800' };
    return null;
};

/* ======================= Zod schema ======================= */
const closeServiceSchema = z.object({
    _id: z.string().optional(),
    status: z.enum(['completed', 'in_progress', 'rejected']),
    selectedService: z.string().optional(),
    selectedCourseName: z.string().optional(),
    notes: z.string().optional(),
    invoiceImage: z.any().optional(), // FileList
    customerPhotos: z.any().optional(), // FileList cho ảnh khách hàng
    discountType: z.enum(['none', 'amount', 'percent']).default('none'),
    discountValue: z.string().optional(),
    adjustmentType: z.enum(['none', 'discount', 'increase']).default('none'), // Mới: loại điều chỉnh
    adjustmentValue: z.string().optional(), // Mới: giá trị điều chỉnh
    hasExistingInvoice: z.coerce.boolean().default(false), // ép string->boolean
}).superRefine((data, ctx) => {
    if (data.status !== 'rejected') {
        const hasNew = !!data.invoiceImage && data.invoiceImage.length > 0;
        const hasOld = !!data._id && data.hasExistingInvoice;
        const isEditMode = !!data._id; // Đang ở chế độ edit
        
        // Khi edit (có _id), không cần validate selectedService và selectedCourseName
        // Vì có thể chỉ đang sửa ảnh hoặc ghi chú
        if (!isEditMode && !hasOld) {
            if (!data.selectedService) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedService'], message: 'Vui lòng chọn ngành học.' });
            }
            if (!data.selectedCourseName) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedCourseName'], message: 'Vui lòng chọn chương trình để chốt.' });
            }
        }
    }
});

/* ===================== Bước 6: ServiceDetailsSection ===================== */
function ServiceDetailsSection({ customer, services = [], currentUserId, onOpenCreatePopup, onOpenEditPopup, onOpenViewPopup }) {
    const { run: runAction } = useAction();

    const details = useMemo(() => {
        const arr = Array.isArray(customer.serviceDetails) ? customer.serviceDetails : (customer.serviceDetails ? [customer.serviceDetails] : []);
        return [...arr].sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0));
    }, [customer.serviceDetails]);

    const approvedTotalReceived = useMemo(
        () => details.filter(d => d.approvalStatus === 'approved')
            .reduce((sum, d) => sum + (Number(d.pricing.finalPrice) || 0), 0),
        [details]
    );

    const handleDelete = async (customerId, serviceDetailId) => {
        if (!window.confirm('Bạn có chắc chắn muốn xóa đơn chốt này không?')) return;
        const fd = new FormData();
        fd.append('customerId', customerId);
        fd.append('serviceDetailId', serviceDetailId);
        await runAction(deleteServiceDetailAction, [null, fd], {
            successMessage: (res) => res?.message || 'Đã xóa đơn.',
            errorMessage: (res) => res?.error || 'Xóa đơn thất bại.',
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                    <BadgeCheck className="h-5 w-5 text-green-600" />
                    <span className="font-medium">Tổng đã nhận (đã duyệt):</span>
                    <span className="font-semibold">{vnd.format(approvedTotalReceived)}</span>
                </div>
                <Button size="sm" onClick={onOpenCreatePopup}>
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Chốt Đơn Mới
                </Button>
            </div>

            {details.length === 0 ? (
                <h6 className="text-center text-muted-foreground py-6">Chưa có đơn chốt nào.</h6>
            ) : (
                <div className="space-y-3">
                    {details.map((d) => {
                        const approved = d.approvalStatus === 'approved';
                        const canEditOrDelete = !approved && !!currentUserId &&
                            ((typeof d.closedBy === 'string' && d.closedBy === currentUserId) ||
                                (d.closedBy?._id && String(d.closedBy._id) === currentUserId));

                        const statusChip = d.status === 'completed'
                            ? { text: 'Hoàn thành', className: 'bg-green-100 text-green-800' }
                            : d.status === 'in_progress'
                                ? { text: 'Còn chương trình', className: 'bg-amber-100 text-amber-800' }
                                : { text: 'Mới', className: 'bg-slate-100 text-slate-800' };

                        const approvalChip = approved
                            ? { text: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle }
                            : { text: 'Chờ duyệt', className: 'bg-amber-100 text-amber-800', Icon: CircleDot };

                        const serviceName = d.selectedService?.name || 'Không rõ';
                        const courseName = d.selectedCourse?.name || '';
                        const listPrice = Number(d?.pricing?.listPrice || 0);
                        const finalPrice = Number(d?.pricing?.finalPrice || d.revenue || 0);
                        const discountAmount = Math.max(0, listPrice - finalPrice);

                        return (
                            <Card key={d._id} className="border">
                                <CardContent className="p-3">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck className="h-5 w-5 text-primary" />
                                                <div className="font-semibold">{serviceName} {courseName && `• ${courseName}`}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge className={`font-normal ${statusChip.className}`}>{statusChip.text}</Badge>
                                                <Badge className={`font-normal ${approvalChip.className}`}>
                                                    <approvalChip.Icon className="h-3 w-3 mr-1" />{approvalChip.text}
                                                </Badge>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="rounded-md bg-muted/40 p-2">
                                                <div className="text-muted-foreground">Giá gốc</div>
                                                <div className="font-medium">{vnd.format(listPrice)}</div>
                                            </div>
                                            <div className="rounded-md bg-muted/40 p-2">
                                                <div className="text-muted-foreground">Giảm giá</div>
                                                <div className="font-medium text-red-600">{vnd.format(discountAmount)}</div>
                                            </div>
                                            <div className="rounded-md bg-muted/40 p-2">
                                                <div className="text-muted-foreground">Thành tiền</div>
                                                <div className="font-medium">{vnd.format(finalPrice)}</div>
                                            </div>
                                        </div>

                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
                                            <div className="flex gap-3">
                                                <span>Chốt bởi: <b>{d.closedBy?.name || '—'}</b></span>
                                                <span>Lúc: <b>{d.closedAt ? new Date(d.closedAt).toLocaleString('vi-VN') : '—'}</b></span>
                                            </div>
                                            {approved && (
                                                <div className="flex gap-3">
                                                    <span>Duyệt bởi: <b>{d.approvedBy?.name || '—'}</b></span>
                                                    <span>Lúc: <b>{d.approvedAt ? new Date(d.approvedAt).toLocaleString('vi-VN') : '—'}</b></span>
                                                </div>
                                            )}
                                        </div>

                                        {d.notes && (<div className="text-sm text-muted-foreground border-t pt-2 mt-1">Ghi chú: {d.notes}</div>)}

                                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t mt-1">
                                            <Button size="sm" onClick={() => onOpenViewPopup(d)}>
                                                Xem
                                            </Button>
                                            {canEditOrDelete && (
                                                <>
                                                    <Button size="sm" variant="secondary" onClick={() => onOpenEditPopup(d)}>
                                                        <Pencil className="h-4 w-4 mr-1" />Sửa
                                                    </Button>
                                                    <Button size="sm" variant="destructive" onClick={() => handleDelete(customer._id, d._id)}>
                                                        <Trash2 className="h-4 w-4 mr-1" />Xóa
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ============================ COMPONENT CHÍNH ============================ */
export default function CustomerPipeline({ customer, addNoteAction, isNotePending, noteState, currentUserId, workflows = [] }) {
    const router = useRouter();
    const [localCustomer, setLocalCustomer] = useState(customer);
    const [subWorkflowControls, setSubWorkflowControls] = useState({});
    
    // Auto-refresh customer data mỗi 3 giây để cập nhật logs
    useEffect(() => {
        setLocalCustomer(customer); // Cập nhật khi customer prop thay đổi
    }, [customer]);
    
    useEffect(() => {
        const intervalId = setInterval(() => {
            // Chỉ refresh khi tab đang hiển thị để tiết kiệm tài nguyên
            if (typeof document !== 'undefined' && !document.hidden) {
                router.refresh();
            }
        }, 3000); // Refresh mỗi 3 giây
        
        return () => clearInterval(intervalId);
    }, [router]);

    const PIPELINE_STAGES = useMemo(() => [
        { id: 1, title: 'Tiếp nhận & Xử lý', getStatus: getStep1Status },
        { id: 2, title: 'Nhắn tin xác nhận', getStatus: getStep2Status },
        { id: 3, title: 'Phân bổ Telesale', getStatus: getStep3Status },
        { id: 4, title: 'Telesale Tư vấn', getStatus: () => null },
        { id: 5, title: 'Nhắc lịch & Xác nhận vào học', getStatus: getStep5Status },
        { id: 6, title: 'Chốt đăng ký vào học', getStatus: getStep6Status }
    ], []);

    const subWorkflowMap = useMemo(() => {
        if (!Array.isArray(workflows)) return {};
        return workflows.reduce((acc, wf) => {
            if (!wf?.isSubWorkflow) return acc;
            const position = Number(wf.workflow_position);
            if (!position) return acc;
            if (!acc[position]) acc[position] = [];
            acc[position].push(wf);
            return acc;
        }, {});
    }, [workflows]);

    // Load cấu hình sub-workflow từ database khi component mount hoặc khi có thay đổi
    const workflowTemplatesStr = useMemo(() => {
        return localCustomer?.workflowTemplates ? JSON.stringify(localCustomer.workflowTemplates) : '';
    }, [localCustomer?.workflowTemplates]);

    // Tạo dependency ổn định cho care array
    const careArrayStr = useMemo(() => {
        if (!localCustomer?.care || !Array.isArray(localCustomer.care)) return '';
        // Chỉ lấy các thông tin cần thiết để tạo string ổn định
        return JSON.stringify(localCustomer.care.map(log => ({
            step: log.step,
            createAt: log.createAt
        })));
    }, [localCustomer?.care]);

    // Helper function để lấy thời gian từ phần tử cuối cùng trong care có step tương ứng
    const getLastCareTimeForStep = (stepId) => {
        if (!localCustomer?.care || !Array.isArray(localCustomer.care) || localCustomer.care.length === 0) {
            return { date: null, time: '' };
        }
        
        const currentStepId = parseInt(stepId, 10);
        // Duyệt từ cuối mảng lên để tìm phần tử cuối cùng có step = currentStepId
        let lastLogWithStep = null;
        for (let i = localCustomer.care.length - 1; i >= 0; i--) {
            const log = localCustomer.care[i];
            if (!log || !log.createAt) continue;
            
            // So sánh step (có thể là number hoặc string)
            const logStep = typeof log.step === 'number' ? log.step : parseInt(log.step, 10);
            if (logStep === currentStepId) {
                lastLogWithStep = log;
                break; // Tìm thấy phần tử cuối cùng, dừng lại
            }
        }
        
        if (!lastLogWithStep) {
            return { date: null, time: '' };
        }
        
        // Parse createAt (format: 2025-11-26T07:08:41.414+00:00)
        const lastLogTime = new Date(lastLogWithStep.createAt);
        if (isNaN(lastLogTime.getTime())) {
            return { date: null, time: '' };
        }
        
        // Thêm 1 phút vào thời gian
        const futureTime = new Date(lastLogTime.getTime() + 60 * 1000); // + 1 phút
        
        // Lấy ngày (chỉ phần date, không có time)
        const date = new Date(futureTime.getFullYear(), futureTime.getMonth(), futureTime.getDate());
        
        // Format thời gian theo local timezone (HH:mm) - đã cộng thêm 1 phút
        const hours = futureTime.getHours().toString().padStart(2, '0');
        const minutes = futureTime.getMinutes().toString().padStart(2, '0');
        const time = `${hours}:${minutes}`;
        
        return { date, time };
    };

    useEffect(() => {
        setSubWorkflowControls(prev => {
            let updated = prev;
            Object.entries(subWorkflowMap).forEach(([stageId, list]) => {
                if (!list || list.length === 0) return;
                const selectedWf = list[0];
                const workflowId = selectedWf?._id?.toString();
                
                if (!prev[stageId]) {
                    if (updated === prev) updated = { ...prev };
                    
                    // Nếu có workflowTemplates trong customer, load giá trị từ database
                    const workflowConfig = localCustomer?.workflowTemplates?.[workflowId];
                    if (workflowConfig) {
                        // Parse timeRepeate nếu có (format: "1 seconds")
                        let intervalValue = 1;
                        let intervalUnit = 'seconds';
                        if (workflowConfig.timeRepeate) {
                            const parts = workflowConfig.timeRepeate.toString().split(' ');
                            if (parts.length >= 2) {
                                intervalValue = parseInt(parts[0], 10) || 1;
                                intervalUnit = parts[1] || 'seconds';
                            }
                        }
                        
                        // Parse startDay từ database (format: ISO string)
                        let startDate = null;
                        let startTime = '';
                        if (workflowConfig.startDay) {
                            try {
                                const parsedDate = new Date(workflowConfig.startDay);
                                if (!isNaN(parsedDate.getTime())) {
                                    startDate = parsedDate;
                                    startTime = format(parsedDate, 'HH:mm');
                                }
                            } catch (e) {
                                console.error('Error parsing startDay:', e);
                            }
                        }
                        
                        // Nếu startDay không có trong database, lấy từ care
                        if (!startDate) {
                            const { date, time } = getLastCareTimeForStep(stageId);
                            startDate = date;
                            startTime = time;
                        }
                        
                        updated[stageId] = {
                            ...DEFAULT_SUBWORKFLOW_CONFIG,
                            selectedWorkflowId: workflowId || '',
                            enabled: workflowConfig.switchButton !== undefined ? workflowConfig.switchButton : true,
                            repeatCount: workflowConfig.repeat !== null && workflowConfig.repeat !== undefined ? workflowConfig.repeat : 1,
                            intervalValue: intervalValue,
                            intervalUnit: intervalUnit,
                            startDate: startDate,
                            startTime: startTime,
                        };
                    } else {
                        // Tính toán thời gian mặc định từ phần tử cuối cùng trong care có step tương ứng
                        const { date, time } = getLastCareTimeForStep(stageId);
                        
                        const defaultConfig = {
                            ...DEFAULT_SUBWORKFLOW_CONFIG,
                            selectedWorkflowId: workflowId || '',
                            startDate: date,
                            startTime: time,
                        };
                        
                        updated[stageId] = defaultConfig;
                        
                        // Tự động lưu tất cả giá trị mặc định vào database khi khởi tạo
                        if (workflowId && customer?._id && date) {
                            // Sử dụng setTimeout để tránh gọi trong quá trình render
                            setTimeout(async () => {
                                const formData = new FormData();
                                formData.append('customerId', customer._id.toString());
                                formData.append('workflowId', workflowId);
                                
                                // Lưu tất cả giá trị mặc định
                                formData.append('repeat', defaultConfig.repeatCount.toString());
                                formData.append('timeRepeate', `${defaultConfig.intervalValue} ${defaultConfig.intervalUnit}`);
                                
                                // Kết hợp date và time thành datetime string
                                const [hours, minutes] = time.split(':').map(Number);
                                const combinedDate = new Date(date);
                                combinedDate.setHours(hours, minutes, 0, 0);
                                formData.append('startDay', combinedDate.toISOString());
                                
                                formData.append('switchButton', defaultConfig.enabled.toString());
                                
                                // Lưu vào database (silent để không hiển thị thông báo)
                                try {
                                    await runSubWorkflowAction(updateSubWorkflowConfigAction, [null, formData], {
                                        successMessage: () => '',
                                        errorMessage: (res) => res?.error || 'Lỗi khi lưu cấu hình',
                                        silent: true,
                                    });
                                } catch (err) {
                                    console.error('Error auto-saving default sub-workflow config:', err);
                                }
                            }, 0);
                        }
                    }
                } else {
                    // Nếu đã có config nhưng startDate vẫn null, cập nhật từ care và tự động lưu vào database
                    if (updated === prev) updated = { ...prev };
                    const currentConfig = prev[stageId];
                    if (currentConfig && !currentConfig.startDate) {
                        const { date, time } = getLastCareTimeForStep(stageId);
                        if (date) {
                            updated[stageId] = {
                                ...currentConfig,
                                startDate: date,
                                startTime: time,
                            };
                            
                            // Tự động lưu tất cả giá trị hiện tại vào database khi startDay được cập nhật
                            if (workflowId && customer?._id) {
                                // Sử dụng setTimeout để tránh gọi trong quá trình render
                                setTimeout(async () => {
                                    const formData = new FormData();
                                    formData.append('customerId', customer._id.toString());
                                    formData.append('workflowId', workflowId);
                                    
                                    // Lưu tất cả giá trị hiện tại
                                    formData.append('repeat', (currentConfig.repeatCount || 1).toString());
                                    formData.append('timeRepeate', `${currentConfig.intervalValue || 1} ${currentConfig.intervalUnit || 'seconds'}`);
                                    
                                    // Kết hợp date và time thành datetime string
                                    const [hours, minutes] = time.split(':').map(Number);
                                    const combinedDate = new Date(date);
                                    combinedDate.setHours(hours, minutes, 0, 0);
                                    formData.append('startDay', combinedDate.toISOString());
                                    
                                    formData.append('switchButton', (currentConfig.enabled !== undefined ? currentConfig.enabled : true).toString());
                                    
                                    // Lưu vào database (silent để không hiển thị thông báo)
                                    try {
                                        await runSubWorkflowAction(updateSubWorkflowConfigAction, [null, formData], {
                                            successMessage: () => '',
                                            errorMessage: (res) => res?.error || 'Lỗi khi lưu cấu hình',
                                            silent: true,
                                        });
                                    } catch (err) {
                                        console.error('Error auto-saving sub-workflow config:', err);
                                    }
                                }, 0);
                            }
                        }
                    }
                }
            });
            return updated;
        });
    }, [subWorkflowMap, workflowTemplatesStr, careArrayStr]);

    const { run: runSubWorkflowAction, loading: isSavingSubWorkflow } = useAction();

    const updateSubWorkflowControl = (stageId, patch) => {
        // Chỉ cập nhật state local, không lưu vào database
        setSubWorkflowControls(prev => ({
            ...prev,
            [stageId]: {
                ...DEFAULT_SUBWORKFLOW_CONFIG,
                ...prev[stageId],
                ...patch,
            },
        }));
    };

    const saveSubWorkflowConfig = async (stageId) => {
        const config = subWorkflowControls[stageId];
        if (!config || !config.selectedWorkflowId || !customer?._id) {
            return;
        }

        const formData = new FormData();
        formData.append('customerId', customer._id.toString());
        formData.append('workflowId', config.selectedWorkflowId);
        
        // Chuyển đổi các giá trị để lưu vào database
        if (config.repeatCount !== undefined) {
            formData.append('repeat', config.repeatCount.toString());
        }
        
        // Kết hợp intervalValue và intervalUnit thành timeRepeate (ví dụ: "1 seconds")
        if (config.intervalValue !== undefined && config.intervalUnit) {
            formData.append('timeRepeate', `${config.intervalValue} ${config.intervalUnit}`);
        }
        
        // Kết hợp date và time thành datetime string để lưu vào database
        if (config.startDate) {
            let dateTimeStr = '';
            if (config.startTime) {
                // Combine date và time
                const [hours, minutes] = config.startTime.split(':').map(Number);
                const combinedDate = new Date(config.startDate);
                combinedDate.setHours(hours, minutes, 0, 0);
                dateTimeStr = combinedDate.toISOString();
            } else {
                // Chỉ có date, set time là 00:00
                const dateOnly = new Date(config.startDate);
                dateOnly.setHours(0, 0, 0, 0);
                dateTimeStr = dateOnly.toISOString();
            }
            formData.append('startDay', dateTimeStr);
        } else {
            formData.append('startDay', '');
        }
        
        if (config.enabled !== undefined) {
            formData.append('switchButton', config.enabled.toString());
        }

        // Gọi server action để lưu vào database
        await runSubWorkflowAction(updateSubWorkflowConfigAction, [null, formData], {
            successMessage: () => 'Đã lưu cấu hình workflow con thành công!',
            errorMessage: (res) => res?.error || 'Lỗi khi lưu cấu hình',
        });
    };

    const { currentStageId, currentStageIndex } = useMemo(() => getCurrentStageFromPipeline(localCustomer), [localCustomer]);

    const [isCloseServiceOpen, setCloseServiceOpen] = useState(false);
    const [editingDetail, setEditingDetail] = useState(null);
    const [isReadOnlyView, setIsReadOnlyView] = useState(false);
    const [newImagePreviews, setNewImagePreviews] = useState([]);
    const [existingImageUrls, setExistingImageUrls] = useState([]);
    const [existingImageIds, setExistingImageIds] = useState([]); // Lưu mapping ID
    // State cho ảnh khách hàng
    const [newCustomerPhotoPreviews, setNewCustomerPhotoPreviews] = useState([]);
    const [existingCustomerPhotoUrls, setExistingCustomerPhotoUrls] = useState([]);
    const [existingCustomerPhotoIds, setExistingCustomerPhotoIds] = useState([]);
    // Unified state để quản lý thứ tự ảnh (gộp existing và new)
    const [unifiedInvoiceImages, setUnifiedInvoiceImages] = useState([]);
    const [unifiedCustomerPhotos, setUnifiedCustomerPhotos] = useState([]);
    // State để lưu các ID ảnh đã bị xóa (từ CloseServiceForm)
    const [deletedImageIds, setDeletedImageIds] = useState([]);
    const [deletedCustomerPhotoIds, setDeletedCustomerPhotoIds] = useState([]);
    const [formResetToken, setFormResetToken] = useState(0);
    const [availableCourses, setAvailableCourses] = useState([]);
    const [listPrice, setListPrice] = useState(0);
    const [finalRevenue, setFinalRevenue] = useState(0);
    const { run: runFormAction, loading: isFormSubmitting } = useAction();

    const services = useMemo(() => localCustomer.tags || [], [localCustomer.tags]);

    const form = useForm({
        resolver: zodResolver(closeServiceSchema),
        defaultValues: {
            status: 'completed',
            selectedService: '',
            selectedCourseName: '',
            notes: '',
            invoiceImage: new DataTransfer().files, // FileList rỗng
            customerPhotos: new DataTransfer().files, // FileList rỗng
            discountType: 'none',
            discountValue: '0',
            adjustmentType: 'none',
            adjustmentValue: '0',
            hasExistingInvoice: false,
        },
    });

    const status = form.watch('status');
    const selectedServiceId = form.watch('selectedService');
    const selectedCourseName = form.watch('selectedCourseName');
    const discountType = form.watch('discountType');
    const discountValue = form.watch('discountValue');
    const adjustmentType = form.watch('adjustmentType');
    const adjustmentValue = form.watch('adjustmentValue');

    // mở form tạo mới
    const openCreatePopup = () => {
        setEditingDetail(null);
        setIsReadOnlyView(false);
        form.reset({
            status: 'completed',
            selectedService: '',
            selectedCourseName: '',
            notes: '',
            invoiceImage: new DataTransfer().files,
            customerPhotos: new DataTransfer().files,
            discountType: 'none',
            discountValue: '0',
            adjustmentType: 'none',
            adjustmentValue: '0',
            hasExistingInvoice: false,
        });
        setExistingImageUrls([]);
        setExistingImageIds([]);
        setNewImagePreviews([]);
        setExistingCustomerPhotoUrls([]);
        setExistingCustomerPhotoIds([]);
        setNewCustomerPhotoPreviews([]);
        setUnifiedInvoiceImages([]);
        setUnifiedCustomerPhotos([]);
        setDeletedImageIds([]);
        setDeletedCustomerPhotoIds([]);
        setCloseServiceOpen(true);
    };

    const openEditPopup = (detail) => {
        setEditingDetail(detail);
        setIsReadOnlyView(false);
        setCloseServiceOpen(true);
    };

    const openViewPopup = (detail) => {
        setEditingDetail(detail);
        setIsReadOnlyView(true);
        setCloseServiceOpen(true);
    };

    // nạp dữ liệu khi sửa
    useEffect(() => {
        if (!isCloseServiceOpen || !editingDetail) return;

        // Ép serviceId về string an toàn
        const raw = editingDetail.selectedService;
        const serviceId = String(
            (raw && (typeof raw === 'object' ? raw._id : raw)) ?? ''
        );

        // Tìm service trong danh sách truyền vào
        const service = services.find(s => String(s._id) === serviceId);
        const courses = service?.treatmentCourses ?? [];
        setAvailableCourses(courses);

        // Tên chương trình cũ (nếu có)
        const courseName = editingDetail.selectedCourse?.name ?? '';

        // Ảnh đã lưu - lưu cả URL và ID
        const ids = editingDetail.invoiceDriveIds || [];
        const urls = ids.map(id => driveImage(id)).filter(Boolean);
        setExistingImageUrls(urls);
        setExistingImageIds(ids);
        setNewImagePreviews([]);

        // Khởi tạo unified state cho ảnh đã lưu
        setUnifiedInvoiceImages(urls.map((url, idx) => ({
            type: 'existing',
            url,
            id: ids[idx],
            index: idx
        })));

        // Ảnh khách hàng đã lưu
        const customerPhotoIds = editingDetail.customerPhotosDriveIds || [];
        const customerPhotoUrls = customerPhotoIds.map(id => driveImage(id));
        const validCustomerPhotoUrls = customerPhotoUrls.filter(Boolean);
        setExistingCustomerPhotoUrls(validCustomerPhotoUrls);
        setExistingCustomerPhotoIds(customerPhotoIds);
        setNewCustomerPhotoPreviews([]);

        // Khởi tạo unified state cho ảnh khách hàng đã lưu
        setUnifiedCustomerPhotos(validCustomerPhotoUrls.map((url, idx) => ({
            type: 'existing',
            url,
            id: customerPhotoIds[idx],
            index: idx
        })));

        // Reset form với giá trị cũ (chỉ set course nếu tồn tại trong options)
        form.reset({
            _id: editingDetail._id,
            status: editingDetail.status || 'completed',
            selectedService: serviceId,
            selectedCourseName: courses.some(c => c.name === courseName) ? courseName : '',
            notes: editingDetail.notes || '',
            invoiceImage: new DataTransfer().files, // rỗng; chỉ preview ảnh cũ
            customerPhotos: new DataTransfer().files, // rỗng; chỉ preview ảnh cũ
            discountType: editingDetail.pricing?.discountType || 'none',
            discountValue: new Intl.NumberFormat('vi-VN').format(editingDetail.pricing?.discountValue || 0),
            adjustmentType: 'none',
            adjustmentValue: '0',
            hasExistingInvoice: urls.length > 0,
        });
        setDeletedImageIds([]);
        setDeletedCustomerPhotoIds([]);
        setFormResetToken(Date.now());
    }, [editingDetail, isCloseServiceOpen, services, form]);

    // tính giá list theo service/course
    useEffect(() => {
        let price = 0;
        if (selectedServiceId) {
            const service = services.find(s => s._id === selectedServiceId);
            const courses = service?.treatmentCourses || [];
            setAvailableCourses(courses);

            if (selectedCourseName) {
                const course = courses.find(c => c.name === selectedCourseName);
                if (course?.costs) {
                    price = (course.costs.basePrice || 0) + (course.costs.fullMedication || 0) +
                        (course.costs.partialMedication || 0) + (course.costs.otherFees || 0);
                }
            }
        } else {
            setAvailableCourses([]);
        }
        setListPrice(price);
    }, [selectedServiceId, selectedCourseName, services]);

    // tính thành tiền
    useEffect(() => {
        let final = listPrice;
        if (adjustmentType === 'discount') {
            const numDiscountValue = parseFloat(String(discountValue).replace(/\D/g, '')) || 0;
            if (discountType === 'amount') final = listPrice - numDiscountValue;
            else if (discountType === 'percent') final = listPrice * (1 - (numDiscountValue / 100));
        } else if (adjustmentType === 'increase') {
            const numAdjustmentValue = parseFloat(String(adjustmentValue).replace(/\D/g, '')) || 0;
            if (discountType === 'amount') final = listPrice + numAdjustmentValue;
            else if (discountType === 'percent') final = listPrice * (1 + (numAdjustmentValue / 100));
        }
        setFinalRevenue(Math.max(0, final));
    }, [listPrice, discountType, discountValue, adjustmentType, adjustmentValue]);

    const handleSuccess = () => {
        setCloseServiceOpen(false);
        setEditingDetail(null);
        setDeletedImageIds([]);
        setDeletedCustomerPhotoIds([]);
        router.refresh();
    };

    const onSubmit = async (values) => {
        // console.log('🟡 [onSubmit] Starting submit with values:', values);
        // console.log('🟡 [onSubmit] editingDetail:', editingDetail);
        // console.log('🟡 [onSubmit] deletedImageIds:', deletedImageIds);
        // console.log('🟡 [onSubmit] deletedCustomerPhotoIds:', deletedCustomerPhotoIds);
        
        const formData = new FormData();
        formData.append('customerId', customer._id);
        formData.append('status', values.status);
        formData.append('notes', values.notes || '');
        if (values.selectedService) formData.append('selectedService', values.selectedService);
        if (values.selectedCourseName) formData.append('selectedCourseName', values.selectedCourseName);

        // Gửi ảnh theo thứ tự từ unified state (đã sắp xếp)
        // Gửi ảnh mới (files) theo thứ tự trong unified state
        unifiedInvoiceImages.forEach(img => {
            if (img.type === 'new' && img.file) {
                formData.append('invoiceImage', img.file);
            }
        });

        // Gửi ảnh khách hàng theo thứ tự từ unified state
        unifiedCustomerPhotos.forEach(img => {
            if (img.type === 'new' && img.file) {
                formData.append('customerPhotos', img.file);
            }
        });

        formData.append('discountType', values.discountType);
        formData.append('discountValue', String(values.discountValue || '0').replace(/\D/g, ''));
        formData.append('adjustmentType', values.adjustmentType || 'none');
        formData.append('adjustmentValue', String(values.adjustmentValue || '0').replace(/\D/g, ''));
        formData.append('listPrice', String(listPrice));
        formData.append('finalPrice', String(finalRevenue));

        if (editingDetail) {
            formData.append('serviceDetailId', editingDetail._id);
            
            // Gửi thứ tự ảnh đã lưu theo unified state (đã sắp xếp)
            unifiedInvoiceImages.forEach(img => {
                if (img.type === 'existing' && img.id) {
                    formData.append('existingImageIds', img.id);
                }
            });

            // Gửi thứ tự ảnh khách hàng đã lưu theo unified state
            unifiedCustomerPhotos.forEach(img => {
                if (img.type === 'existing' && img.id) {
                    formData.append('existingCustomerPhotoIds', img.id);
                }
            });
            
            // Gửi danh sách ID ảnh cần xóa
            if (deletedImageIds.length > 0) {
                deletedImageIds.forEach(id => formData.append('deletedImageIds', id));
            }
            if (deletedCustomerPhotoIds.length > 0) {
                deletedCustomerPhotoIds.forEach(id => formData.append('deletedCustomerPhotoIds', id));
            }
            
            // console.log('🟡 [onSubmit] Calling updateServiceDetailAction...');
            await runFormAction(updateServiceDetailAction, [null, formData], {
                successMessage: 'Cập nhật đơn thành công!',
                errorMessage: (err) => {
                    console.error('❌ [onSubmit] Update failed:', err);
                    return err?.error || "Cập nhật thất bại.";
                },
                onSuccess: (res) => {
                    // console.log('✅ [onSubmit] Update success:', res);
                    handleSuccess();
                },
            });
        } else {
            await runFormAction(closeServiceAction, [null, formData], {
                successMessage: 'Chốt đơn mới thành công!',
                errorMessage: (err) => err?.error || "Chốt đơn thất bại.",
                onSuccess: handleSuccess,
            });
        }
    };

    const fileReg = form.register('invoiceImage');

    // thêm/xóa ảnh mới
    const onImageChange = (e) => {
        const added = Array.from(e.target.files || []);
        if (!added.length) return;

        const current = Array.from(form.getValues('invoiceImage') || []);
        const dt = new DataTransfer();
        [...current, ...added].forEach(f => dt.items.add(f));

        // LƯU FileList vào RHF (điểm "ăn ảnh")
        form.setValue('invoiceImage', dt.files, { shouldValidate: true, shouldDirty: true });
        form.trigger('invoiceImage');

        // Preview và thêm vào unified state
        const newPreviews = added.map(f => ({ url: URL.createObjectURL(f), file: f }));
        setNewImagePreviews(prev => [...prev, ...newPreviews]);
        
        // Thêm vào unified state (thêm vào cuối)
        setUnifiedInvoiceImages(prev => [
            ...prev,
            ...newPreviews.map((preview, idx) => ({
                type: 'new',
                url: preview.url,
                file: preview.file,
                index: prev.length + idx
            }))
        ]);
    };

    const onRemoveNewImage = (indexToRemove) => {
        // Lấy preview cần xóa
        const previewToRemove = newImagePreviews[indexToRemove];
        if (!previewToRemove) return;

        // Tìm và xóa khỏi unified state (so sánh bằng URL)
        setUnifiedInvoiceImages(prev => prev.filter(img => 
            !(img.type === 'new' && img.url === previewToRemove.url)
        ));

        // Cập nhật state riêng lẻ
        setNewImagePreviews(prev => prev.filter((_, i) => i !== indexToRemove));

        // Cập nhật FileList trong form
        const currentFiles = Array.from(form.getValues('invoiceImage') || []);
        const kept = currentFiles.filter((_, i) => i !== indexToRemove);

        const dt = new DataTransfer();
        kept.forEach(f => dt.items.add(f));

        form.setValue('invoiceImage', dt.files, { shouldValidate: true, shouldDirty: true });
        form.trigger('invoiceImage'); // revalidate lại trường ảnh
    };

    // Handler cho ảnh khách hàng
    const onCustomerPhotoChange = (e) => {
        const added = Array.from(e.target.files || []);
        if (!added.length) return;

        const current = Array.from(form.getValues('customerPhotos') || []);
        const dt = new DataTransfer();
        [...current, ...added].forEach(f => dt.items.add(f));

        form.setValue('customerPhotos', dt.files, { shouldValidate: true, shouldDirty: true });
        form.trigger('customerPhotos');

        const newPreviews = added.map(f => ({ url: URL.createObjectURL(f), file: f }));
        setNewCustomerPhotoPreviews(prev => [...prev, ...newPreviews]);
        
        // Thêm vào unified state
        setUnifiedCustomerPhotos(prev => [
            ...prev,
            ...newPreviews.map((preview, idx) => ({
                type: 'new',
                url: preview.url,
                file: preview.file,
                index: prev.length + idx
            }))
        ]);
    };

    const onRemoveCustomerPhoto = (indexToRemove) => {
        // Lấy preview cần xóa
        const previewToRemove = newCustomerPhotoPreviews[indexToRemove];
        if (!previewToRemove) return;

        // Tìm và xóa khỏi unified state (so sánh bằng URL)
        setUnifiedCustomerPhotos(prev => prev.filter(img => 
            !(img.type === 'new' && img.url === previewToRemove.url)
        ));

        setNewCustomerPhotoPreviews(prev => prev.filter((_, i) => i !== indexToRemove));

        // Cập nhật FileList trong form
        const currentFiles = Array.from(form.getValues('customerPhotos') || []);
        const kept = currentFiles.filter((_, i) => i !== indexToRemove);

        const dt = new DataTransfer();
        kept.forEach(f => dt.items.add(f));

        form.setValue('customerPhotos', dt.files, { shouldValidate: true, shouldDirty: true });
        form.trigger('customerPhotos');
    };

    // Handler để sắp xếp lại ảnh invoice (gộp cả existing và new)
    const onReorderInvoiceImages = (dragIndex, dropIndex) => {
        if (dragIndex === dropIndex) return;
        
        const newUnified = [...unifiedInvoiceImages];
        const [removed] = newUnified.splice(dragIndex, 1);
        newUnified.splice(dropIndex, 0, removed);
        
        // Cập nhật index
        newUnified.forEach((img, idx) => { img.index = idx; });
        
        setUnifiedInvoiceImages(newUnified);
        
        // Đồng bộ lại state riêng lẻ
        const existing = newUnified.filter(img => img.type === 'existing');
        const news = newUnified.filter(img => img.type === 'new');
        
        setExistingImageUrls(existing.map(img => img.url));
        setExistingImageIds(existing.map(img => img.id));
        setNewImagePreviews(news.map(img => ({ url: img.url, file: img.file })));
        
        // Cập nhật FileList trong form theo thứ tự mới
        const dt = new DataTransfer();
        news.forEach(img => {
            if (img.file) dt.items.add(img.file);
        });
        form.setValue('invoiceImage', dt.files, { shouldValidate: true, shouldDirty: true });
    };

    // Handler để sắp xếp lại ảnh khách hàng
    const onReorderCustomerPhotos = (dragIndex, dropIndex) => {
        if (dragIndex === dropIndex) return;
        
        const newUnified = [...unifiedCustomerPhotos];
        const [removed] = newUnified.splice(dragIndex, 1);
        newUnified.splice(dropIndex, 0, removed);
        
        // Cập nhật index
        newUnified.forEach((img, idx) => { img.index = idx; });
        
        setUnifiedCustomerPhotos(newUnified);
        
        // Đồng bộ lại state riêng lẻ
        const existing = newUnified.filter(img => img.type === 'existing');
        const news = newUnified.filter(img => img.type === 'new');
        
        setExistingCustomerPhotoUrls(existing.map(img => img.url));
        setExistingCustomerPhotoIds(existing.map(img => img.id));
        setNewCustomerPhotoPreviews(news.map(img => ({ url: img.url, file: img.file })));
        
        // Cập nhật FileList trong form theo thứ tự mới
        const dt = new DataTransfer();
        news.forEach(img => {
            if (img.file) dt.items.add(img.file);
        });
        form.setValue('customerPhotos', dt.files, { shouldValidate: true, shouldDirty: true });
    };


    return (
        <div className="p-4 max-h-[calc(100vh-150px)] overflow-y-auto">
            <Accordion type="single" collapsible defaultValue={`item-${currentStageIndex}`} className="w-full">
                {PIPELINE_STAGES.map((stage, index) => {
                    const isCompleted = stage.id < currentStageId;
                    const isCurrent = stage.id === currentStageId;
                    const s = isCompleted ? 'completed' : (isCurrent ? 'current' : 'pending');
                    const IconCmp = s === 'completed' ? CheckCircle2 : (isCurrent ? CircleDot : Circle);
                    const color = s === 'completed' ? 'text-green-500' : (isCurrent ? 'text-blue-500' : 'text-slate-400');
                    const notesForStage = localCustomer.care.filter(note => note.step === stage.id);
                    const statusChip = stage.getStatus(localCustomer);
                    const subWorkflowList = subWorkflowMap[stage.id] || [];
                    const subWorkflowConfig = subWorkflowControls[stage.id] || DEFAULT_SUBWORKFLOW_CONFIG;

                    return (
                        <AccordionItem key={stage.id} value={`item-${index}`}>
                            <AccordionTrigger className={`hover:no-underline ${s === 'current' ? 'bg-muted/50' : ''}`}>
                                <div className="flex items-center gap-3 flex-1">
                                    <IconCmp className={`h-5 w-5 ${color} flex-shrink-0`} />
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h5 className="text-left">{stage.id}. {stage.title}</h5>
                                        {statusChip && (
                                            <Badge variant="secondary" className={`font-normal ${statusChip.className}`}>
                                                <statusChip.Icon className="h-3 w-3 mr-1" />
                                                {statusChip.text}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                {stage.id !== 6 && notesForStage.length > 0 && (
                                    <MessageSquare className="h-4 w-4 text-muted-foreground ml-3 flex-shrink-0" />
                                )}
                            </AccordionTrigger>

                            <AccordionContent className="p-2">
                                <div className="border rounded-md p-2 max-h-[400px] overflow-y-auto">
                                    {stage.id === 6 ? (
                                        <ServiceDetailsSection
                                            customer={localCustomer}
                                            services={services}
                                            currentUserId={currentUserId}
                                            onOpenCreatePopup={openCreatePopup}
                                            onOpenEditPopup={openEditPopup}
                                            onOpenViewPopup={openViewPopup}
                                        />
                                    ) : (
                                        <>
                                            {notesForStage.length > 0
                                                ? notesForStage.map(note => <CareNoteItem key={note._id || `${stage.id}-${Math.random()}`} note={note} />)
                                                : <h6 className='text-center text-muted-foreground p-4'>Chưa có hoạt động.</h6>
                                            }
                                            {isCurrent && (
                                                <AddNoteForm
                                                        customerId={localCustomer._id}
                                                    dispatchAddNote={addNoteAction}
                                                    isNotePending={isNotePending}
                                                    noteState={noteState}
                                                    currentStep={stage.id}
                                                />
                                            )}
                                                {subWorkflowList.length > 0 && (
                                                    <div className="mt-4 border rounded-md bg-muted/40 p-3 space-y-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div>
                                                                <h4 className="text-sm font-semibold">Khung điền workflow con</h4>
                                                                <p className="text-xs text-muted-foreground">
                                                                    Lặp lại workflow con sau khi bước cha hoàn tất.
                                                                </p>
                                                            </div>
                                                            <Switch
                                                                checked={subWorkflowConfig.enabled}
                                                                onCheckedChange={(checked) => updateSubWorkflowControl(stage.id, { enabled: checked })}
                                                            />
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-2">
                                                            <div>
                                                                <p className="text-xs font-semibold mb-1" style={{ fontSize: '15px' }}>Chọn workflow con</p>
                                                                <Select
                                                                    value={subWorkflowConfig.selectedWorkflowId || ''}
                                                                    onValueChange={(value) => updateSubWorkflowControl(stage.id, { selectedWorkflowId: value })}
                                                                >
                                                                    <SelectTrigger className="w-full">
                                                                        <SelectValue placeholder="Chọn workflow con" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {subWorkflowList.map(wf => (
                                                                            <SelectItem key={wf._id} value={wf._id}>
                                                                                {wf.name}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-semibold mb-1" style={{ fontSize: '15px' }}>Số lần lặp</p>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    value={subWorkflowConfig.repeatCount}
                                                                    onChange={(e) => updateSubWorkflowControl(stage.id, {
                                                                        repeatCount: Math.max(1, Number(e.target.value) || 1)
                                                                    })}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-3">
                                                            <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                                                                <div>
                                                                    <p className="text-xs font-semibold mb-1" style={{ fontSize: '15px' }}>Khoảng cách mỗi lần lặp</p>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        value={subWorkflowConfig.intervalValue}
                                                                        onChange={(e) => updateSubWorkflowControl(stage.id, {
                                                                            intervalValue: Math.max(0, Number(e.target.value) || 0)
                                                                        })}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs font-semibold mb-1" style={{ fontSize: '15px' }}>Đơn vị thời gian</p>
                                                                    <Select
                                                                        value={subWorkflowConfig.intervalUnit}
                                                                        onValueChange={(value) => updateSubWorkflowControl(stage.id, { intervalUnit: value })}
                                                                    >
                                                                        <SelectTrigger>
                                                                            <SelectValue placeholder="Đơn vị" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {INTERVAL_UNITS.map(unit => (
                                                                                <SelectItem key={unit.value} value={unit.value}>
                                                                                    {unit.label}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-semibold mb-1" style={{ fontSize: '15px' }}>Ngày bắt đầu kích hoạt lần lặp</p>
                                                                <div className="grid ">
                                                                    <Popover>
                                                                        <PopoverTrigger asChild>
                                                                            <Button
                                                                                variant="outline"
                                                                                className="w-full justify-start text-left font-normal"
                                                                            >
                                                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                                {subWorkflowConfig.startDate ? format(subWorkflowConfig.startDate, "dd/MM/yyyy") : "Chọn ngày"}
                                                                            </Button>
                                                                        </PopoverTrigger>
                                                                        <PopoverContent className="w-auto p-0" align="start">
                                                                            <Calendar
                                                                                mode="single"
                                                                                selected={subWorkflowConfig.startDate}
                                                                                onSelect={(date) => updateSubWorkflowControl(stage.id, { startDate: date })}
                                                                                initialFocus
                                                                                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                                                            />
                                                                        </PopoverContent>
                                                                    </Popover>
                                                                    <Input
                                                                        type="time"
                                                                        value={subWorkflowConfig.startTime}
                                                                        onChange={(e) => updateSubWorkflowControl(stage.id, { startTime: e.target.value })}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {subWorkflowConfig.selectedWorkflowId && (
                                                            <div className="flex justify-end pt-2">
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => saveSubWorkflowConfig(stage.id)}
                                                                    disabled={isSavingSubWorkflow}
                                                                >
                                                                    {isSavingSubWorkflow ? (
                                                                        <>
                                                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                                            Đang lưu...
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Send className="h-4 w-4 mr-2" />
                                                                            Lưu
                                                                        </>
                                                                    )}
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                        </>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>

            <Popup
                open={isCloseServiceOpen}
                onClose={() => setCloseServiceOpen(false)}
                widthClass="max-w-3xl"
                header={isReadOnlyView ? "Xem Chi Tiết Đơn Đăng Ký" : (editingDetail ? "Chỉnh Sửa Đơn Đăng Ký" : "Chốt Đơn Đăng Ký Mới")}
                footer={
                    isReadOnlyView ? (
                        <Button onClick={() => setCloseServiceOpen(false)}>Đóng</Button>
                    ) : (
                        <Button type="submit" form="close-service-form" disabled={isFormSubmitting}>
                            {isFormSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editingDetail ? <Pencil className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                            {editingDetail ? "Lưu thay đổi" : "Xác nhận"}
                        </Button>
                    )
                }
            >
                <CloseServiceForm
                    key={editingDetail?._id || 'new'}
                    form={form}
                    status={status}
                    services={services}
                    availableCourses={availableCourses}
                    listPrice={listPrice}
                    finalRevenue={finalRevenue}
                    discountType={discountType}
                    fileReg={fileReg}
                    onImageChange={onImageChange}
                    existingImageUrls={existingImageUrls}
                    setExistingImageUrls={setExistingImageUrls}
                    existingImageIds={existingImageIds}
                    setExistingImageIds={setExistingImageIds}
                    newImagePreviews={newImagePreviews}
                    onRemoveNewImage={onRemoveNewImage}
                    customerPhotoFileReg={form.register('customerPhotos')}
                    onCustomerPhotoChange={onCustomerPhotoChange}
                    existingCustomerPhotoUrls={existingCustomerPhotoUrls}
                    setExistingCustomerPhotoUrls={setExistingCustomerPhotoUrls}
                    existingCustomerPhotoIds={existingCustomerPhotoIds}
                    setExistingCustomerPhotoIds={setExistingCustomerPhotoIds}
                    newCustomerPhotoPreviews={newCustomerPhotoPreviews}
                    onRemoveCustomerPhoto={onRemoveCustomerPhoto}
                    onSubmit={onSubmit}
                    readOnly={isReadOnlyView}
                    unifiedInvoiceImages={unifiedInvoiceImages}
                    setUnifiedInvoiceImages={setUnifiedInvoiceImages}
                    onReorderInvoiceImages={onReorderInvoiceImages}
                    unifiedCustomerPhotos={unifiedCustomerPhotos}
                    setUnifiedCustomerPhotos={setUnifiedCustomerPhotos}
                    onReorderCustomerPhotos={onReorderCustomerPhotos}
                    onGetDeletedIds={(ids) => {
                        setDeletedImageIds(ids.deletedImageIds || []);
                        setDeletedCustomerPhotoIds(ids.deletedCustomerPhotoIds || []);
                    }}
                    resetToken={formResetToken}
                />
            </Popup>
        </div>
    );
}
