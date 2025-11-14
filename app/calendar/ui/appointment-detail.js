"use client";

import { useState, useEffect, useActionState, useTransition } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Clock, User, MapPin, FileText, Phone, XCircle, CheckCircle2, AlertTriangle, Gift } from 'lucide-react';
import { updateAppointmentStatusAction, cancelAppointmentAction } from '@/app/actions/appointment.actions';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Status configuration with icons and colors
const statusConfig = {
    pending: {
        label: 'Chờ xác nhận',
        icon: Clock,
        color: 'text-amber-500',
        badge: 'bg-amber-500'
    },
    completed: {
        label: 'Hoàn thành',
        icon: CheckCircle2,
        color: 'text-green-500',
        badge: 'bg-green-500'
    },
    missed: {
        label: 'Lỡ hẹn',
        icon: AlertTriangle,
        color: 'text-red-500',
        badge: 'bg-red-500'
    },
    cancelled: {
        label: 'Đã hủy',
        icon: XCircle,
        color: 'text-slate-500',
        badge: 'bg-slate-500'
    }
};

export default function AppointmentDetail({ appointment, onClose, onUpdate, currentUser }) {
    const [isOpen, setIsOpen] = useState(true);
    const [isConfirmCancelOpen, setIsConfirmCancelOpen] = useState(false);
    const [pendingStatus, setPendingStatus] = useState(null);
    const [, startTransition] = useTransition();

    // Action states for appointment status updates
    const [updateState, updateAction] = useActionState(updateAppointmentStatusAction, null);
    const [cancelState, cancelAction] = useActionState(cancelAppointmentAction, null);

    // Monitor action states for changes
    useEffect(() => {
        if (updateState?.success === true || updateState?.status === true) {
            // Simulate the updated appointment
            const updatedAppointment = {
                ...appointment,
                status: pendingStatus || 'completed'
            };
            onUpdate(updatedAppointment);
            setPendingStatus(null);
        }
    }, [updateState, appointment, onUpdate, pendingStatus]);

    useEffect(() => {
        if (cancelState?.status === true) {
            // Simulate the cancelled appointment
            const cancelledAppointment = {
                ...appointment,
                status: 'cancelled'
            };
            onUpdate(cancelledAppointment);
        }
    }, [cancelState, appointment, onUpdate]);

    // Format date for display
    const formattedDate = format(
        new Date(appointment.appointmentDate),
        "EEEE, dd MMMM yyyy 'lúc' HH:mm",
        { locale: vi }
    );

    // Handle status change
    const handleChangeStatus = (newStatus) => {
        const formData = new FormData();
        formData.append('appointmentId', appointment._id);
        formData.append('newStatus', newStatus);
        setPendingStatus(newStatus);
        startTransition(() => {
            updateAction(formData);
        });
    };

    // Handle appointment cancellation
    const handleCancel = () => {
        const formData = new FormData();
        formData.append('appointmentId', appointment._id);
        startTransition(() => {
            cancelAction(formData);
        });
    };

    // Handle close with animation
    const handleDialogClose = () => {
        setIsOpen(false);
        setTimeout(() => {
            onClose();
        }, 300);
    };

    // Status badge component
    const StatusBadge = ({ status }) => {
        const config = statusConfig[status];
        const Icon = config.icon;

        return (
            <Badge className={`${config.badge} text-white py-1.5 px-3`}>
                <Icon className="w-3.5 h-3.5 mr-1.5" />
                {config.label}
            </Badge>
        );
    };

    const roleList = Array.isArray(currentUser.role) ? currentUser.role : [currentUser.role].filter(Boolean);
    const canManageAppointment = roleList.some(role => ['Admin', 'Manager', 'Sale', 'Admin Sale', 'Telesale', 'Care'].includes(role));
    const canUpdateStatus = appointment.status === 'pending' &&
        (canManageAppointment || appointment.createdBy === currentUser._id);

    return (
        <>
            <Dialog open={isOpen} onOpenChange={handleDialogClose}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl"></DialogTitle>
                        <h4>{appointment.title}</h4>
                        <div className="mt-2">
                            <StatusBadge status={appointment.status} />
                        </div>
                    </DialogHeader>

                    <div className="mt-4 space-y-4">
                        <div className="flex items-start gap-3">
                            <CalendarCheck className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <h6 className="font-semibold">Thời gian hẹn</h6>
                                <h5 className="text-sm text-muted-foreground">{formattedDate}</h5>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <User className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <h6 className="font-semibold">Khách hàng</h6>
                                <div className="flex items-center gap-2 mt-1">
                                    <h5 className="text-sm">{appointment.customer?.name || 'Không có thông tin'}</h5>
                                </div>
                                {appointment.customer?.phone && (
                                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                        <Phone className="w-3 h-3" />
                                        <h5>{appointment.customer.phone}</h5>
                                    </div>
                                )}
                                <div className="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
                                    <Gift className="w-3.5 h-3.5 mt-0.5" />
                                    <div>
                                        <h5>
                                            {Array.isArray(appointment.interestedServices) && appointment.interestedServices.length > 0
                                                ? appointment.interestedServices.join(', ')
                                                : 'Không có thông tin cho ngành học quan tâm'}
                                        </h5>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {appointment.notes && (
                            <div className="flex items-start gap-3">
                                <FileText className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <h6 className="font-semibold">Ghi chú</h6>
                                    <h5 className="text-sm text-muted-foreground">{appointment.notes}</h5>
                                </div>
                            </div>
                        )}

                        <div className="flex items-start gap-3">
                            <User className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <h6 className="font-semibold">Người tạo</h6>
                                <div className="flex items-center gap-2 mt-1">
                                    <h5 className="text-sm">{appointment.createdBy?.name || 'Không xác định'}</h5>
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-6">
                        {canUpdateStatus && appointment.status === 'pending' && (
                            <>
                                <Button variant="outline" onClick={() => handleChangeStatus('missed')}>
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    <h6>Lỡ hẹn</h6>
                                </Button>
                                <Button className="bg-green-600 hover:bg-green-700" onClick={() => handleChangeStatus('completed')}>
                                    <CheckCircle2 className="w-4 h-4 mr-2" />
                                    <h6 style={{ color: 'white' }}>Hoàn thành</h6>
                                </Button>
                                <Button variant="destructive" onClick={() => setIsConfirmCancelOpen(true)}>
                                    <XCircle className="w-4 h-4 mr-2" />
                                    <h6 style={{ color: 'white' }}>Hủy lịch</h6>
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmation dialog for cancellation */}
            <Dialog open={isConfirmCancelOpen} onOpenChange={setIsConfirmCancelOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Xác nhận hủy lịch hẹn</DialogTitle>
                        <DialogDescription>
                            Bạn có chắc chắn muốn hủy lịch hẹn này? Hành động này không thể hoàn tác.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 mt-4">
                        <Button variant="outline" onClick={() => setIsConfirmCancelOpen(false)}>
                            <h6>Quay lại</h6>
                        </Button>
                        <Button variant="destructive" onClick={handleCancel}>
                            <h6>Xác nhận hủy</h6>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
