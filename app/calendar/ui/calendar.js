"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
    isSameMonth, isSameDay, addMonths, addWeeks, subMonths, subWeeks, parse, isToday
} from 'date-fns';
import { vi } from 'date-fns/locale';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Filter, List, Grid3X3, Pill, Scissors } from 'lucide-react';

import AppointmentDetail from './appointment-detail';
import DayDetail from './day-detail';
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import FilterControls from './filters';
import CreateAppointment from './create-appointment';

// Status color mapping
const statusColors = {
    pending: "bg-amber-500", // amber for pending
    completed: "bg-green-500", // green for completed
    missed: "bg-red-500", // red for missed
    cancelled: "bg-slate-500" // gray for cancelled
};

export default function CalendarView({ initialAppointments, currentUser, isAdmin, users }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
    const [currentDate, setCurrentDate] = useState(new Date());
    const [appointments, setAppointments] = useState(initialAppointments || []);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [selectedDay, setSelectedDay] = useState(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Calculate date range based on view mode
    const dateRange = useMemo(() => {
        if (viewMode === 'month') {
            return {
                start: startOfMonth(currentDate),
                end: endOfMonth(currentDate)
            };
        } else {
            return {
                start: startOfWeek(currentDate, { weekStartsOn: 1 }), // Monday
                end: endOfWeek(currentDate, { weekStartsOn: 1 }) // Sunday
            };
        }
    }, [currentDate, viewMode]);

    // Get all days in the current view
    const daysInView = useMemo(() => {
        return eachDayOfInterval({
            start: dateRange.start,
            end: dateRange.end
        });
    }, [dateRange]);

    // Group appointments by date for efficient lookup
    const appointmentsByDate = useMemo(() => {
        const byDate = {};

        appointments.forEach(appointment => {
            const dateStr = format(new Date(appointment.appointmentDate), 'yyyy-MM-dd');
            if (!byDate[dateStr]) {
                byDate[dateStr] = [];
            }
            byDate[dateStr].push(appointment);
        });

        return byDate;
    }, [appointments]);

    // Handle navigation
    const navigate = (direction) => {
        if (viewMode === 'month') {
            setCurrentDate(direction === 'next' ?
                addMonths(currentDate, 1) :
                subMonths(currentDate, 1)
            );
        } else {
            setCurrentDate(direction === 'next' ?
                addWeeks(currentDate, 1) :
                subWeeks(currentDate, 1)
            );
        }
    };

    // Handle appointment selection
    const handleAppointmentClick = (appointment) => {
        setSelectedAppointment(appointment);
    };

    // Handle day selection to see all appointments for that day
    const handleDayClick = (day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        if (appointmentsByDate[dateStr] && appointmentsByDate[dateStr].length > 0) {
            setSelectedDay({ date: day, appointments: appointmentsByDate[dateStr] });
        }
    };

    // Apply filters
    const applyFilters = (filters) => {
        // Build new URL with filters
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.startDate) params.set('startDate', filters.startDate);
        if (filters.endDate) params.set('endDate', filters.endDate);
        if (filters.userId && isAdmin) params.set('createdBy', filters.userId);

        router.push(`/calendar?${params.toString()}`);
        setIsFilterOpen(false);
    };

    // Handle appointment update/refresh
    const handleAppointmentUpdate = (updatedAppointment) => {
        setAppointments(prev =>
            prev.map(app => app._id === updatedAppointment._id ? updatedAppointment : app)
        );
        setSelectedAppointment(null);
    };


    const TypePill = ({ type }) => {
        const normalizedType = (type === 'telesale' || type === 'telesale_TuVan') ? 'telesale'
            : (type === 'care' || type === 'CareService') ? 'care'
                : type;
        const IconComponent = normalizedType === 'care' ? Scissors : Pill;
        return (
            <span
                className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-1.5 text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
            >
                <IconComponent className="w-4 h-4" />
            </span>
        );
    };



    return (
        <div className="container">
            <div className="flex flex-col space-y-4">
                {/* Header with title and controls */}
                <div className="flex justify-between items-center flex-wrap gap-4">
                    <p className='text_w_600'>Quản lý lịch hẹn khách hàng</p>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setIsFilterOpen(true)}>
                            <Filter className="h-4 w-4 mr-2" />
                            <h6>Bộ lọc</h6>
                        </Button>

                        <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                            <h6>Hôm nay</h6>
                        </Button>

                        <Tabs value={viewMode} onValueChange={setViewMode}>
                            <TabsList className="grid grid-cols-2 h-9">
                                <TabsTrigger value="month">
                                    <Grid3X3 className="h-4 w-4 mr-2" />
                                    <h6>Tháng</h6>
                                </TabsTrigger>
                                <TabsTrigger value="week">
                                    <List className="h-4 w-4 mr-2" />
                                    <h6>Tuần</h6>
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                </div>

                {/* Calendar navigation */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={() => navigate('prev')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="min-w-[240px] justify-start text-left font-normal">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    <h5>
                                        {viewMode === 'month'
                                            ? format(currentDate, 'MMMM yyyy', { locale: vi })
                                            : `${format(dateRange.start, 'dd/MM', { locale: vi })} - ${format(dateRange.end, 'dd/MM/yyyy', { locale: vi })}`
                                        }
                                    </h5>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={currentDate}
                                    onSelect={(date) => date && setCurrentDate(date)}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>

                        <Button variant="outline" size="icon" onClick={() => navigate('next')}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Status legend */}
                    <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-2">
                            <span className={`inline-block w-3 h-3 rounded-full ${statusColors.pending}`}></span>
                            <h6 className="text-sm">Chờ xác nhận</h6>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <span className={`inline-block w-3 h-3 rounded-full ${statusColors.completed}`}></span>
                            <h6 className="text-sm">Hoàn thành</h6>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <span className={`inline-block w-3 h-3 rounded-full ${statusColors.missed}`}></span>
                            <h6 className="text-sm">Lỡ hẹn</h6>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <span className={`inline-block w-3 h-3 rounded-full ${statusColors.cancelled}`}></span>
                            <h6 className="text-sm">Đã hủy</h6>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <Pill className='w-3.5 h-3.5' />
                            <h6 className="text-sm">Telesale</h6>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <Scissors className='w-3.5 h-3.5' />
                            <h6 className="text-sm">Care</h6>
                        </div>
                        <div className="md:hidden">
                            <Button variant="ghost" size="sm">
                                <h6>Chú thích</h6>
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Weekday headers */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                    {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day, i) => (
                        <div key={i} className="text-center py-2 font-medium">
                            <h6>{day}</h6>
                        </div>
                    ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1 auto-rows-fr">
                    {daysInView.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayAppointments = appointmentsByDate[dateStr] || [];
                        const isCurrentMonth = isSameMonth(day, currentDate);
                        const isTodayDate = isToday(day);

                        return (
                            <div
                                key={dateStr}
                                className={`min-h-[100px] p-1 border rounded-md transition-colors ${isCurrentMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
                                    } ${isTodayDate ? 'border-primary' : 'border-border'
                                    } hover:border-primary/80 cursor-pointer`}
                                onClick={() => handleDayClick(day)}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={`text-sm font-medium ${isTodayDate ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center' : ''
                                        }`}>
                                        {format(day, 'd')}
                                    </span>

                                    {dayAppointments.length > 3 && (
                                        <Badge variant="secondary" className="text-xs">
                                            +{dayAppointments.length - 2}
                                        </Badge>
                                    )}
                                </div>

                                <div className="mt-1 space-y-1 max-h-[calc(100%-24px)] overflow-hidden">
                                {dayAppointments.slice(0, 3).map((appointment) => {
                                        return (
                                            <div className='flex gap-1' key={appointment._id}>
                                                <div>
                                                    <TypePill type={appointment.createdBy.group} />
                                                </div>
                                                <div
                                                    className={`flex-1 text-xs p-1 rounded truncate ${statusColors[appointment.status]} text-white`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAppointmentClick(appointment);
                                                    }}
                                                >
                                                    {format(new Date(appointment.appointmentDate), 'HH:mm')} - {appointment.title}
                                                </div>
                                            </div>

                                        )
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Filter popover */}
            <FilterControls
                isOpen={isFilterOpen}
                onClose={() => setIsFilterOpen(false)}
                onApply={applyFilters}
                isAdmin={isAdmin}
                users={users}
            />

            {/* Appointment detail modal */}
            {selectedAppointment && (
                <AppointmentDetail
                    appointment={selectedAppointment}
                    onClose={() => setSelectedAppointment(null)}
                    onUpdate={handleAppointmentUpdate}
                    currentUser={currentUser}
                />
            )}

            {/* Day detail modal */}
            {selectedDay && (
                <DayDetail
                    day={selectedDay}
                    onClose={() => setSelectedDay(null)}
                    onAppointmentClick={handleAppointmentClick}
                />
            )}
        </div>
    );
}
