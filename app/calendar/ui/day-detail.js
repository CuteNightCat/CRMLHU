"use client";

import { useState } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarCheck, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

// Status configuration with icons and colors
const statusConfig = {
  pending: { 
    icon: Clock, 
    color: 'text-amber-500 bg-amber-100',
  },
  completed: { 
    icon: CheckCircle2, 
    color: 'text-green-500 bg-green-100',
  },
  missed: { 
    icon: AlertTriangle, 
    color: 'text-red-500 bg-red-100',
  },
  cancelled: { 
    icon: XCircle, 
    color: 'text-slate-500 bg-slate-100',
  }
};

export default function DayDetail({ day, onClose, onAppointmentClick }) {
  const [isOpen, setIsOpen] = useState(true);

  // Format the day date for display
  const formattedDay = format(day.date, "EEEE, dd MMMM yyyy", { locale: vi });
  
  // Sort appointments by time
  const sortedAppointments = [...day.appointments].sort((a, b) => 
    new Date(a.appointmentDate) - new Date(b.appointmentDate)
  );

  // Handle dialog close with animation
  const handleDialogClose = () => {
    setIsOpen(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader className="flex flex-row items-center gap-2">
          <CalendarCheck className="h-5 w-5" />
          <DialogTitle></DialogTitle>
          <h4>Lịch hẹn: {formattedDay}</h4>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] mt-4">
          <div className="space-y-3">
            {sortedAppointments.map((appointment) => {
              const StatusIcon = statusConfig[appointment.status]?.icon || Clock;
              const colorClass = statusConfig[appointment.status]?.color || 'text-gray-500 bg-gray-100';
              
              return (
                <div 
                  key={appointment._id}
                  className="flex gap-3 p-3 rounded-lg border hover:border-primary cursor-pointer transition-colors"
                  onClick={() => onAppointmentClick(appointment)}
                >
                  <div className={`rounded-full p-2.5 h-fit ${colorClass}`}>
                    <StatusIcon className="h-5 w-5" />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <h6 className="font-medium">{appointment.title}</h6>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(appointment.appointmentDate), 'HH:mm')}
                      </span>
                    </div>
                    
                    <div className="text-sm text-muted-foreground mt-1">
                      Khách hàng: {appointment.customer?.name || 'Không có thông tin'}
                    </div>
                    
                    {appointment.notes && (
                      <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {appointment.notes}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {sortedAppointments.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <h6>Không có lịch hẹn nào trong ngày này</h6>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
