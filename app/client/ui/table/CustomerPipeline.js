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
import Popup from '@/components/ui/popup';
import CloseServiceForm from './CloseServiceForm';

// Actions
import {
    updateServiceDetailAction,
    deleteServiceDetailAction,
    closeServiceAction,
} from '@/data/customers/wraperdata.db';

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
export default function CustomerPipeline({ customer, addNoteAction, isNotePending, noteState, currentUserId }) {
    const router = useRouter();
    const PIPELINE_STAGES = useMemo(() => [
        { id: 1, title: 'Tiếp nhận & Xử lý', getStatus: getStep1Status },
        { id: 2, title: 'Nhắn tin xác nhận', getStatus: getStep2Status },
        { id: 3, title: 'Phân bổ Telesale', getStatus: getStep3Status },
        { id: 4, title: 'Telesale Tư vấn', getStatus: () => null },
        { id: 5, title: 'Nhắc lịch & Xác nhận', getStatus: getStep5Status },
        { id: 6, title: 'Chốt đăng ký vào học', getStatus: getStep6Status }
    ], []);

    const { currentStageId, currentStageIndex } = useMemo(() => getCurrentStageFromPipeline(customer), [customer]);

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

    const services = useMemo(() => customer.tags || [], [customer.tags]);

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
        console.log('🟡 [onSubmit] Starting submit with values:', values);
        console.log('🟡 [onSubmit] editingDetail:', editingDetail);
        console.log('🟡 [onSubmit] deletedImageIds:', deletedImageIds);
        console.log('🟡 [onSubmit] deletedCustomerPhotoIds:', deletedCustomerPhotoIds);
        
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
            
            console.log('🟡 [onSubmit] Calling updateServiceDetailAction...');
            await runFormAction(updateServiceDetailAction, [null, formData], {
                successMessage: 'Cập nhật đơn thành công!',
                errorMessage: (err) => {
                    console.error('❌ [onSubmit] Update failed:', err);
                    return err?.error || "Cập nhật thất bại.";
                },
                onSuccess: (res) => {
                    console.log('✅ [onSubmit] Update success:', res);
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
                    const notesForStage = customer.care.filter(note => note.step === stage.id);
                    const statusChip = stage.getStatus(customer);

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
                                <div className="border rounded-md p-2">
                                    {stage.id === 6 ? (
                                        <ServiceDetailsSection
                                            customer={customer}
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
                                                    customerId={customer._id}
                                                    dispatchAddNote={addNoteAction}
                                                    isNotePending={isNotePending}
                                                    noteState={noteState}
                                                    currentStep={stage.id}
                                                />
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
