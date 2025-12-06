'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from "date-fns";

// --- Icon Imports ---
import {
    CalendarClock, Loader2, CalendarCheck, ChevronUp, ChevronDown, Plus,
    Calendar as CalendarIcon, CheckCircle2, Check, UserX, Trash2, AlertTriangle, Clock, X, Briefcase
} from 'lucide-react';
// --- Action & Data Function Imports ---
import { createAppointmentAction, updateAppointmentStatusAction, cancelAppointmentAction } from '@/app/actions/appointment.actions';
import { appointment_data } from '@/data/appointment_db/wraperdata.db';
// Sửa đường dẫn import nếu cần
import { useActionFeedback } from '@/hooks/useAction';

// --- Shadcn UI Component Imports ---
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardFooter, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@/components/ui/form';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from '@/lib/utils';
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";


// =============================================================
// == COMPONENT PHỤ & SCHEMA
// =============================================================
const appointmentSchema = z.object({
    serviceId: z.string().min(1, { message: "Vui lòng chọn ngành học." }),
    treatmentCourse: z.string().min(1, { message: "Vui lòng chọn chương trình." }),
    appointmentType: z.string({ required_error: "Vui lòng chọn loại lịch hẹn." }),
    appointmentDate: z.date({ required_error: "Vui lòng chọn ngày hẹn." }),
    appointmentTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: "Giờ hẹn không hợp lệ (HH:mm)." }),
    notes: z.string().optional(),
});

function CreateAppointmentForm({ customerId, services, onAppointmentCreated }) {
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const action = useActionFeedback();
    const form = useForm({
        resolver: zodResolver(appointmentSchema),
        defaultValues: {
            serviceId: "", treatmentCourse: "", notes: "",
            appointmentTime: "", appointmentType: "interview",
        },
    });

    const selectedService = useMemo(() => (
        services.find(s => s._id === selectedServiceId)
    ), [selectedServiceId, services]);

    const handleServiceChange = (serviceId) => {
        setSelectedServiceId(serviceId);
        form.setValue('serviceId', serviceId);
        form.setValue('treatmentCourse', '');
    };

    const onSubmit = async (values) => {
        const { serviceId, treatmentCourse, appointmentDate, appointmentTime, notes, appointmentType } = values;
        const [hours, minutes] = appointmentTime.split(':');
        const combinedDateTime = new Date(appointmentDate);
        combinedDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10));

        const formData = new FormData();
        formData.append('customerId', customerId);
        formData.append('serviceId', serviceId);
        formData.append('treatmentCourse', treatmentCourse);
        formData.append('appointmentDate', combinedDateTime.toISOString());
        formData.append('notes', notes || '');
        formData.append('appointmentType', appointmentType);

        await action.run(
            () => createAppointmentAction(null, formData),
            [],
            {
                successMessage: 'Tạo lịch hẹn thành công!',
                onSuccess: () => {
                    form.reset();
                    setSelectedServiceId('');
                    onAppointmentCreated();
                },
                autoRefresh: false
            }
        );
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="serviceId" render={({ field }) => (
                        <FormItem>
                            <Label>Ngành học *</Label>
                            <Select onValueChange={handleServiceChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Chọn ngành học" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {services.map(service => (
                                        <SelectItem key={service._id} value={service._id}>{service.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="treatmentCourse" render={({ field }) => (
                        <FormItem>
                            <Label>Chương trình của ngành học *</Label>
                            <Select onValueChange={field.onChange} value={field.value} disabled={!selectedService}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Chọn chương trình" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {selectedService?.treatmentCourses.map(course => (
                                        <SelectItem key={course._id} value={course.name}>{course.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="appointmentType" render={({ field }) => (
                        <FormItem>
                            <Label>Loại lịch hẹn *</Label>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Chọn loại lịch hẹn" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="interview">Phỏng vấn / Tư vấn</SelectItem>
                                    <SelectItem value="surgery">Hoàn tất thủ tục nhập học</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="appointmentDate" render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <Label>Ngày hẹn *</Label>
                            <Popover><PopoverTrigger asChild><FormControl>
                                <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                    {field.value ? format(field.value, "dd/MM/yyyy") : <span>Chọn ngày</span>}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                            </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                </PopoverContent></Popover>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="appointmentTime" render={({ field }) => (
                        <FormItem>
                            <Label>Giờ hẹn *</Label>
                            <FormControl><Input type="time" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem>
                            <Label>Ghi chú</Label>
                            <FormControl><Input placeholder="Thông tin thêm..." {...field} /></FormControl>
                        </FormItem>
                    )} />
                </div>
                <Button type="submit" className="w-full" disabled={action.loading}>
                    {action.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Tạo lịch hẹn
                </Button>
            </form>
        </Form>
    );
}

// =============================================================
// == COMPONENT CHÍNH
// =============================================================
export default function CustomerAppointments({ customer }) {
    const [appointments, setAppointments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const action = useActionFeedback();

    const getStatusInfo = useCallback((status) => {
        switch (status) {
            case 'completed': return { label: 'Hoàn thành', variant: 'success', border: 'border-green-500' };
            case 'missed': return { label: 'Vắng mặt', variant: 'secondary', border: 'border-gray-300' };
            case 'cancelled': return { label: 'Đã hủy', variant: 'destructive', border: 'border-gray-300' };
            case 'pending': default: return { label: 'Đang chờ', variant: 'default', border: 'border-blue-500' };
        }
    }, []);

    const fetchAppointments = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await appointment_data({ customerId: customer._id });
            // console.log(result);
            
            setAppointments(result || []);
        } catch (error) {
            action.toast("Không thể tải danh sách lịch hẹn.", "error");
        } finally {
            setIsLoading(false);
        }
    }, [customer._id]);

    useEffect(() => {
        if (customer._id) {
            fetchAppointments();
        }
    }, [customer._id, fetchAppointments]);

    const handleUpdateStatus = (appointmentId, newStatus) => {
        const formData = new FormData();
        formData.append('appointmentId', appointmentId);
        formData.append('newStatus', newStatus);
        action.run(() => updateAppointmentStatusAction(null, formData), [], {
            successMessage: 'Cập nhật trạng thái thành công!',
            onSuccess: fetchAppointments,
            autoRefresh: false,
        });
    };

    const handleCancelAppointment = (appointmentId) => {
        const formData = new FormData();
        formData.append('appointmentId', appointmentId);
        action.run(() => cancelAppointmentAction(null, formData), [], {
            successMessage: 'Đã hủy lịch hẹn.',
            onSuccess: fetchAppointments,
            autoRefresh: false,
        });
    };

    const sortedAppointments = useMemo(() => {
        return [...appointments].sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return new Date(b.appointmentDate) - new Date(a.appointmentDate);
        });
    }, [appointments]);

    return (
        <div className="p-4 h-full flex flex-col flex-1 gap-4 scroll">
            <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex-shrink-0 border rounded-lg">
                <CollapsibleTrigger asChild>
                    <div className="flex justify-between items-center cursor-pointer p-3 bg-muted/30">
                        <h5 className="font-semibold flex items-center gap-2"><Plus className="h-5 w-5" />Tạo Lịch Hẹn Mới</h5>
                        <Button variant="ghost" size="sm" className="w-8 h-8 p-0 rounded-full">
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="p-4 border-t">
                    <CreateAppointmentForm customerId={customer._id} services={customer.tags || []} onAppointmentCreated={fetchAppointments} />
                </CollapsibleContent>
            </Collapsible>

            <h5 className="font-semibold flex items-center gap-2 my-4 flex-shrink-0">
                <CalendarClock className="h-5 w-5" />
                Danh Sách Lịch Hẹn ({appointments.length})
            </h5>

            <div className="flex-1 scroll max-h-[400px] min-h-[400px] pr-2 -mr-2">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /><h5>Đang tải...</h5>
                    </div>
                ) : sortedAppointments.length > 0 ? (
                    <div className="space-y-3">
                        {sortedAppointments.map(app => {
                            const statusInfo = getStatusInfo(app.status);
                            const appointmentDate = new Date(app.appointmentDate);
                            const isPastDue = app.status === 'pending' && appointmentDate < new Date();
                            const isInactive = app.status === 'cancelled' || app.status === 'missed';

                            return (
                                <Card key={app._id} className={cn(
                                    'transition-all',
                                    isPastDue ? 'border-red-500 bg-red-50/50' :
                                        isInactive ? 'opacity-70 border-gray-300' :
                                            statusInfo.border
                                )}>
                                    <CardHeader className="flex flex-row items-start justify-between px-4 pt-3 pb-2 space-y-0">
                                        <div>
                                            <CardTitle className="flex items-start gap-2">
                                                {app.appointmentType === 'surgery'
                                                    ? <Briefcase className="h-4 w-4 text-rose-600 mt-1 flex-shrink-0" />
                                                    : <Briefcase className="h-4 w-4 text-sky-600 mt-1 flex-shrink-0" />
                                                }
                                                <div>
                                                    <h5 className={cn('font-semibold leading-tight', isInactive && 'line-through')}>
                                                        {app.treatmentCourse}
                                                    </h5>
                                                    <p className={cn("text-xs text-muted-foreground font-normal", isInactive && 'line-through')}>
                                                        {app.service?.name}
                                                    </p>
                                                </div>
                                            </CardTitle>
                                            <h5 className={cn("text-sm text-muted-foreground flex items-center gap-2 mt-2 pl-6", isInactive && 'line-through')}>
                                                <CalendarIcon className="h-4 w-4" />
                                                {format(appointmentDate, "HH:mm, dd/MM/yyyy")}
                                            </h5>
                                        </div>
                                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                                    </CardHeader>
                                    <CardContent className="px-4 pb-2 pt-1">
                                        {(app.notes || isPastDue) && (
                                            <div className="border-t pt-2 mt-2 space-y-1">
                                                {app.notes &&
                                                    <h6 className={cn("text-sm text-muted-foreground", isInactive && 'line-through')}>
                                                        Ghi chú: {app.notes}
                                                    </h6>
                                                }
                                                {isPastDue && (
                                                    <p className="text-xs font-semibold text-red-600 flex items-center gap-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        Lịch hẹn này đã quá hạn.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                    {app.status === 'pending' && (
                                        <CardFooter className="bg-muted/50 p-2 border-t">
                                            <div className="grid grid-cols-3 gap-2 w-full">
                                                <Button variant="outline" size="sm" className="bg-white text-green-600 border-green-300 hover:bg-green-50 hover:text-green-700" onClick={() => handleUpdateStatus(app._id, 'completed')}>
                                                    <Check className="mr-1 h-4 w-4" /> Hoàn thành
                                                </Button>
                                                <Button variant="outline" size="sm" className="bg-white text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700" onClick={() => handleUpdateStatus(app._id, 'missed')}>
                                                    <UserX className="mr-1 h-4 w-4" /> Vắng mặt
                                                </Button>
                                                <Button variant="outline" size="sm" className="bg-white text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700" onClick={() => handleCancelAppointment(app._id)}>
                                                    <Trash2 className="mr-1 h-4 w-4" /> Hủy
                                                </Button>
                                            </div>
                                        </CardFooter>
                                    )}
                                </Card>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground pt-10 flex flex-col items-center">
                        <CalendarCheck className="h-10 w-10 mb-2 opacity-50" />
                        <p className="font-semibold">Chưa có lịch hẹn nào</p>
                        <p className="text-sm">Tạo lịch hẹn mới ở trên để bắt đầu.</p>
                    </div>
                )}
            </div>
        </div>
    );
}