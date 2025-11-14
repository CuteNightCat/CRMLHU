'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format } from "date-fns";
import { Calendar as CalendarIcon, Filter, Loader2 } from "lucide-react";
import { DateRange } from "react-day-picker";

// --- Action & Data Function Imports ---
import { history_data } from '@/data/actions/get';

// --- Shadcn UI Component Imports ---
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// =============================================================
// == COMPONENT CHÍNH CỦA PHẦN LỊCH SỬ (ĐÃ NÂNG CẤP)
// =============================================================

export default function CustomerHistory({ initialHistory = [], isLoading = true }) {
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'success', 'error'
    const [dateRange, setDateRange] = useState(undefined);
    const filteredHistory = useMemo(() => {
        return initialHistory
            .filter(item => {
                // Lọc theo trạng thái
                if (statusFilter === 'all') return true;
                const isSuccess = item?.status?.status === true;
                return statusFilter === 'success' ? isSuccess : !isSuccess;
            })
            .filter(item => {
                // Lọc theo khoảng thời gian
                if (!dateRange?.from) return true;
                const itemDate = new Date(item.createdAt);
                if (dateRange.from && !dateRange.to) {
                    return itemDate >= dateRange.from;
                }
                if (dateRange.from && dateRange.to) {
                    const toDate = new Date(dateRange.to);
                    toDate.setDate(toDate.getDate() + 1);
                    return itemDate >= dateRange.from && itemDate < toDate;
                }
                return true;
            });
    }, [initialHistory, statusFilter, dateRange]);

    return (
        <div className="p-4 h-full flex flex-col flex-1 scroll">
            {/* --- PHẦN HEADER CỐ ĐỊNH --- */}
            <div className="flex-shrink-0">
                <h4 className="text_w_600">Lịch sử tương tác</h4>
                <div className="flex items-center flex-wrap gap-2 mt-4 mb-4">
                    {/* Bộ lọc trạng thái */}
                    <Select value={statusFilter} onValueChange={setStatusFilter} disabled={isLoading}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Lọc theo trạng thái" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tất cả trạng thái</SelectItem>
                            <SelectItem value="success">Thành công</SelectItem>
                            <SelectItem value="error">Thất bại</SelectItem>
                        </SelectContent>

                    </Select>

                    {/* Bộ lọc ngày giờ */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                disabled={isLoading}
                                variant={"outline"}
                                className={cn("w-full flex-1 justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? (
                                        <>{format(dateRange.from, "dd/MM/y")} - {format(dateRange.to, "dd/MM/y")}</>
                                    ) : (
                                        format(dateRange.from, "dd/MM/y")
                                    )
                                ) : (
                                    <span>Chọn khoảng thời gian</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                initialFocus
                                mode="range"
                                selected={dateRange}
                                onSelect={setDateRange}
                                numberOfMonths={2}
                            />
                        </PopoverContent>
                    </Popover>
                    <Button>
                        <h6 style={{ color: 'white' }}>Xóa bộ lọc</h6>
                    </Button>
                </div>
                <Separator />
            </div>

            {/* --- PHẦN DANH SÁCH CÓ SCROLL --- */}
            <div className="flex-1 mt-4 overflow-hidden">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        <h5>Đang tải lịch sử...</h5>
                    </div>
                ) : (
                    <ScrollArea className="h-full pr-4">
                        {filteredHistory.length > 0 ? (
                            <div className="space-y-4">
                                {filteredHistory.map((item) => (
                                    <div key={item._id} className="flex items-start gap-4">
                                        <div className="flex-shrink-0">
                                            <div className={`w-2 h-2 mt-2 rounded-full ${item?.status?.status ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center">
                                                <h5 className="font-semibold text-sm">Hành động: {item.type || 'Hành động'}</h5>
                                                <h5 className="text-xs text-muted-foreground">
                                                    {new Date(item.createdAt).toLocaleString('vi-VN')}
                                                </h5>
                                            </div>
                                            <h5 className="text-xs text-muted-foreground">
                                                Thực hiện bởi: {item.createBy?.name || 'Hệ thống'}
                                            </h5>
                                            <h5 className="text-sm text-gray-600 mt-1">
                                                {item.status?.message || 'Không có mô tả.'}
                                            </h5>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full text-center text-muted-foreground pt-10 flex flex-col items-center">
                                <Filter className="h-8 w-8 mb-2" />
                                <h5>Không tìm thấy lịch sử phù hợp.</h5>
                            </div>
                        )}
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}