"use client";

import { useState, useEffect } from 'react';
import { format, isValid } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  CalendarIcon, 
  CheckCircle2, 
  Clock, 
  X, 
  Filter, 
  User2, 
  RotateCcw,
  Calendar as CalendarIcon2
} from 'lucide-react';
import { cn } from "@/lib/utils";

export default function FilterControls({ isOpen, onClose, onApply, isAdmin, users = [] }) {
  const [status, setStatus] = useState('all');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [userId, setUserId] = useState('all');
  const [activeFilterCount, setActiveFilterCount] = useState(0);

  // Calculate active filter count
  useEffect(() => {
    let count = 0;
    if (status !== 'all') count++;
    if (startDate) count++;
    if (endDate) count++;
    if (userId !== 'all') count++;
    setActiveFilterCount(count);
  }, [status, startDate, endDate, userId]);

  // Reset form when reopening
  useEffect(() => {
    if (isOpen) {
      setStatus('all');
      setStartDate(null);
      setEndDate(null);
      setUserId('all');
    }
  }, [isOpen]);

  // Handle form submission
  const handleApply = () => {
    const filters = {
      status: status !== 'all' ? status : undefined,
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
      endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
      userId: userId !== 'all' ? userId : undefined
    };
    
    onApply(filters);
  };

  const handleReset = () => {
    setStatus('all');
    setStartDate(null);
    setEndDate(null);
    setUserId('all');
  };

  // Get status details for UI display
  const getStatusDetails = (statusValue) => {
    const statusMap = {
      'all': { label: 'Tất cả trạng thái', icon: Filter, color: 'bg-slate-100 text-slate-800' },
      'pending': { label: 'Chờ xác nhận', icon: Clock, color: 'bg-blue-100 text-blue-800' },
      'completed': { label: 'Hoàn thành', icon: CheckCircle2, color: 'bg-green-100 text-green-800' },
      'missed': { label: 'Lỡ hẹn', icon: X, color: 'bg-amber-100 text-amber-800' },
      'cancelled': { label: 'Đã hủy', icon: X, color: 'bg-red-100 text-red-800' }
    };
    
    return statusMap[statusValue] || statusMap.all;
  };

  const statusDetails = getStatusDetails(status);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex justify-between items-center">
            <SheetTitle className="text-xl font-bold flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              Bộ lọc lịch hẹn
            </SheetTitle>
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeFilterCount} lọc đang áp dụng
              </Badge>
            )}
          </div>
        </SheetHeader>
        
        <div className="my-6 space-y-6">
          {/* Status Filter */}
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <statusDetails.icon className={cn("h-4 w-4", status !== 'all' ? "text-primary" : "text-muted-foreground")} />
                <Label htmlFor="status" className="font-medium">Trạng thái</Label>
              </div>
              
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status" className={cn(
                  "w-full",
                  status !== 'all' && statusDetails.color
                )}>
                  <SelectValue placeholder="Tất cả trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả trạng thái</SelectItem>
                  <SelectItem value="pending" className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      <span>Chờ xác nhận</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="completed">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span>Hoàn thành</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="missed">
                    <div className="flex items-center gap-2">
                      <X className="h-3.5 w-3.5 text-amber-600" />
                      <span>Lỡ hẹn</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="cancelled">
                    <div className="flex items-center gap-2">
                      <X className="h-3.5 w-3.5 text-red-600" />
                      <span>Đã hủy</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Date Range Filter */}
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CalendarIcon2 className={cn(
                  "h-4 w-4", 
                  (startDate || endDate) ? "text-primary" : "text-muted-foreground"
                )} />
                <Label className="font-medium">Khoảng thời gian</Label>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Từ ngày</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={startDate ? "default" : "outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal h-9",
                          startDate && "bg-primary text-primary-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {startDate ? format(startDate, "dd/MM/yyyy", { locale: vi }) : "Chọn"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={(date) => {
                          setStartDate(date);
                          // Reset end date if it's before new start date
                          if (endDate && date && date > endDate) {
                            setEndDate(null);
                          }
                        }}
                        initialFocus
                        locale={vi}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Đến ngày</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={endDate ? "default" : "outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal h-9",
                          endDate && "bg-primary text-primary-foreground",
                          !startDate && "opacity-50 cursor-not-allowed"
                        )}
                        disabled={!startDate}
                      >
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {endDate ? format(endDate, "dd/MM/yyyy", { locale: vi }) : "Chọn"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        initialFocus
                        locale={vi}
                        disabled={date => !startDate || (date && date < startDate)}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              {(startDate || endDate) && (
                <div className="pt-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setStartDate(null);
                      setEndDate(null);
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Xóa khoảng thời gian
                  </Button>
                </div>
              )}
            </div>
          </div>
          
          {/* User Filter - Only for Admins */}
          {isAdmin && users.length > 0 && (
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <User2 className={cn(
                    "h-4 w-4", 
                    userId !== 'all' ? "text-primary" : "text-muted-foreground"
                  )} />
                  <Label htmlFor="user" className="font-medium">Người tạo lịch</Label>
                </div>
                
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="user" className={cn(
                    "w-full",
                    userId !== 'all' && "bg-blue-50 text-blue-700 border-blue-200"
                  )}>
                    <SelectValue placeholder="Tất cả người dùng" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả người dùng</SelectItem>
                    {users.map(user => (
                      <SelectItem key={user._id} value={user._id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
        
        <Separator className="my-4" />
        
        {/* Active Filters Summary */}
        {activeFilterCount > 0 && (
          <div className="mb-6 bg-muted/40 rounded-lg p-3 text-sm">
            <h4 className="font-medium mb-2">Bộ lọc đang áp dụng:</h4>
            <ul className="space-y-1 text-muted-foreground">
              {status !== 'all' && (
                <li className="flex items-center gap-2">
                  <statusDetails.icon className="h-3.5 w-3.5" />
                  <span>Trạng thái: {statusDetails.label}</span>
                </li>
              )}
              {startDate && (
                <li className="flex items-center gap-2">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span>Từ ngày: {format(startDate, "dd/MM/yyyy", { locale: vi })}</span>
                </li>
              )}
              {endDate && (
                <li className="flex items-center gap-2">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span>Đến ngày: {format(endDate, "dd/MM/yyyy", { locale: vi })}</span>
                </li>
              )}
              {userId !== 'all' && (
                <li className="flex items-center gap-2">
                  <User2 className="h-3.5 w-3.5" />
                  <span>Người tạo: {users.find(u => u._id === userId)?.name || userId}</span>
                </li>
              )}
            </ul>
          </div>
        )}
        
        <SheetFooter className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto order-2 sm:order-1">
            Hủy
          </Button>
          
          {activeFilterCount > 0 && (
            <Button 
              variant="ghost" 
              onClick={handleReset} 
              className="w-full sm:w-auto order-1 sm:order-2"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Đặt lại
            </Button>
          )}
          
          <Button 
            onClick={handleApply} 
            className="w-full sm:w-auto order-3"
            disabled={activeFilterCount === 0}
          >
            Áp dụng {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
