"use client";

import { useState, useEffect, useActionState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAppointmentAction } from '@/app/actions/appointment.actions';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

// Helper to combine date and time
function combineDateAndTime(date, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const newDate = new Date(date);
  newDate.setHours(hours, minutes);
  return newDate;
}

export default function CreateAppointment({ isOpen, onClose, onCreated, currentUser }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  
  const [actionState, dispatchAction] = useActionState(createAppointmentAction, null);
  
  // Reset form when reopening
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setCustomerId('');
      setCustomerName('');
      setDate(new Date());
      setTime('09:00');
      setNotes('');
      setFormErrors({});
    }
  }, [isOpen]);
  
  // Handle customer search
  const handleCustomerSearch = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      // This would be your actual search API call
      const response = await fetch(`/api/customers/search?query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.customers || []);
      }
    } catch (error) {
      console.error('Error searching customers:', error);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Handle customer selection
  const handleSelectCustomer = (customer) => {
    setCustomerId(customer._id);
    setCustomerName(customer.name);
    setSearchResults([]);
  };
  
  // Validate form
  const validateForm = () => {
    const errors = {};
    
    if (!title.trim()) {
      errors.title = 'Vui lòng nhập tiêu đề lịch hẹn';
    }
    
    if (!customerId) {
      errors.customerId = 'Vui lòng chọn khách hàng';
    }
    
    if (!date) {
      errors.date = 'Vui lòng chọn ngày hẹn';
    }
    
    if (!time) {
      errors.time = 'Vui lòng chọn giờ hẹn';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };
  
  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    const formData = new FormData();
    formData.append('title', title);
    formData.append('customerId', customerId);
    formData.append('appointmentDate', combineDateAndTime(date, time).toISOString());
    formData.append('notes', notes);
    
    dispatchAction(formData);
  };
  
  // Handle action state changes
  useEffect(() => {
    if (actionState?.status === true) {
      // Refresh the page to show the new appointment
      router.refresh();
      
      // Close the modal
      onClose();
      
      // Simulate the created appointment
      const newAppointment = {
        _id: Date.now().toString(), // Temporary ID
        title,
        customer: { _id: customerId, name: customerName },
        appointmentDate: combineDateAndTime(date, time),
        notes,
        status: 'pending',
        createdBy: currentUser
      };
      
      // Notify parent component
      onCreated(newAppointment);
    }
  }, [actionState, onClose, onCreated, router, title, customerId, customerName, date, time, notes, currentUser]);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Tạo lịch hẹn mới</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="title">Tiêu đề<span className="text-red-500">*</span></Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề lịch hẹn"
              className={formErrors.title ? "border-red-500" : ""}
            />
            {formErrors.title && (
              <p className="text-sm text-red-500">{formErrors.title}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="customer">Khách hàng<span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                id="customer"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setCustomerId('');
                  handleCustomerSearch(e.target.value);
                }}
                placeholder="Tìm kiếm khách hàng theo tên hoặc số điện thoại"
                className={formErrors.customerId ? "border-red-500" : ""}
              />
              
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 border rounded-md bg-background shadow-md max-h-60 overflow-auto">
                  {searchResults.map((customer) => (
                    <div
                      key={customer._id}
                      className="p-2 hover:bg-accent cursor-pointer"
                      onClick={() => handleSelectCustomer(customer)}
                    >
                      <div>{customer.name}</div>
                      <div className="text-sm text-muted-foreground">{customer.phone}</div>
                    </div>
                  ))}
                </div>
              )}
              
              {isSearching && (
                <div className="absolute right-3 top-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
            {formErrors.customerId && (
              <p className="text-sm text-red-500">{formErrors.customerId}</p>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Ngày hẹn<span className="text-red-500">*</span></Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={`w-full justify-start text-left font-normal ${formErrors.date ? "border-red-500" : ""}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "dd/MM/yyyy") : "Chọn ngày"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                    disabled={(date) => date < new Date()}
                  />
                </PopoverContent>
              </Popover>
              {formErrors.date && (
                <p className="text-sm text-red-500">{formErrors.date}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="time">Giờ hẹn<span className="text-red-500">*</span></Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={formErrors.time ? "border-red-500" : ""}
              />
              {formErrors.time && (
                <p className="text-sm text-red-500">{formErrors.time}</p>
              )}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Nhập ghi chú cho lịch hẹn (nếu có)"
              rows={3}
            />
          </div>
          
          <DialogFooter className="gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={actionState?.isPending}>
              {actionState?.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                "Tạo lịch hẹn"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
