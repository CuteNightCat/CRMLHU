'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format } from "date-fns";
import { Calendar as CalendarIcon, Filter, Loader2, Clock } from "lucide-react";
import { DateRange } from "react-day-picker";

// --- Action & Data Function Imports ---
import { history_data, future_actions_data } from '@/data/actions/get';

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

export default function CustomerHistory({ initialHistory = [], isLoading = true, customerId = null }) {
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'success', 'error', 'future'
    const [dateRange, setDateRange] = useState(undefined);
    const [futureActions, setFutureActions] = useState([]);
    const [loadingFuture, setLoadingFuture] = useState(false);
    const [timeFilter, setTimeFilter] = useState('all'); // 'all', 'past', 'future'

    // Lấy hành động tương lai khi component mount hoặc customerId thay đổi
    useEffect(() => {
        if (customerId) {
            setLoadingFuture(true);
            future_actions_data(customerId)
                .then(result => {
                    if (result.success) {
                        setFutureActions(result.data || []);
                    } else {
                        console.error('Error loading future actions:', result.error);
                        setFutureActions([]);
                    }
                })
                .catch(err => {
                    console.error('Error loading future actions:', err);
                    setFutureActions([]);
                })
                .finally(() => {
                    setLoadingFuture(false);
                });
        }
    }, [customerId]);

    // Kết hợp lịch sử và hành động tương lai
    const allItems = useMemo(() => {
        const pastItems = initialHistory.map(item => ({
            ...item,
            isFuture: false,
            scheduledAt: item.createdAt
        }));

        const futureItems = futureActions.map(item => ({
            ...item,
            isFuture: true,
            createdAt: item.scheduledAt || item.createdAt,
            status: {
                status: null, // Tương lai chưa có kết quả
                message: item.actionName || 'Hành động tự động'
            },
            type: item.type || 'future_action',
            createBy: { name: 'Hệ thống' }
        }));

        return [...pastItems, ...futureItems];
    }, [initialHistory, futureActions]);

    const filteredHistory = useMemo(() => {
        return allItems
            .filter(item => {
                // Lọc theo thời gian (quá khứ/tương lai)
                if (timeFilter === 'past') {
                    if (item.isFuture) return false;
                } else if (timeFilter === 'future') {
                    if (!item.isFuture) return false;
                }
                // timeFilter === 'all' thì không lọc

                // Lọc theo trạng thái (chỉ áp dụng cho quá khứ)
                if (!item.isFuture && statusFilter !== 'all') {
                    if (statusFilter === 'success') {
                        return item?.status?.status === true;
                    } else if (statusFilter === 'error') {
                        return item?.status?.status !== true;
                    } else if (statusFilter === 'future') {
                        return false; // future filter được xử lý ở timeFilter
                    }
                }

                // Lọc theo khoảng thời gian
                if (!dateRange?.from) return true;
                const itemDate = new Date(item.createdAt || item.scheduledAt);
                if (dateRange.from && !dateRange.to) {
                    return itemDate >= dateRange.from;
                }
                if (dateRange.from && dateRange.to) {
                    const toDate = new Date(dateRange.to);
                    toDate.setDate(toDate.getDate() + 1);
                    return itemDate >= dateRange.from && itemDate < toDate;
                }
                return true;
            })
            .sort((a, b) => {
                // Sắp xếp: tương lai trước (theo scheduledAt tăng dần), sau đó quá khứ (theo createdAt giảm dần)
                if (a.isFuture && b.isFuture) {
                    return new Date(a.scheduledAt) - new Date(b.scheduledAt);
                } else if (a.isFuture) {
                    return -1;
                } else if (b.isFuture) {
                    return 1;
                } else {
                    return new Date(b.createdAt) - new Date(a.createdAt);
                }
            });
    }, [allItems, statusFilter, dateRange, timeFilter]);

    return (
        <div className="p-4 h-full flex flex-col flex-1 scroll">
            {/* --- PHẦN HEADER CỐ ĐỊNH --- */}
            <div className="flex-shrink-0">
                <h4 className="text_w_600">Lịch sử tương tác</h4>
                <div className="flex items-center flex-wrap gap-2 mt-4 mb-4">
                    {/* Bộ lọc thời gian (quá khứ/tương lai) */}
                    <Select value={timeFilter} onValueChange={setTimeFilter} disabled={isLoading || loadingFuture}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Lọc theo thời gian" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tất cả</SelectItem>
                            <SelectItem value="past">Quá khứ</SelectItem>
                            <SelectItem value="future">Tương lai</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Bộ lọc trạng thái (chỉ áp dụng cho quá khứ) */}
                    <Select value={statusFilter} onValueChange={setStatusFilter} disabled={isLoading || timeFilter === 'future'}>
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
                    <Button onClick={() => {
                        setStatusFilter('all');
                        setTimeFilter('all');
                        setDateRange(undefined);
                    }}>
                        <h6 style={{ color: 'white' }}>Xóa bộ lọc</h6>
                    </Button>
                </div>
                <Separator />
            </div>

            {/* --- PHẦN DANH SÁCH CÓ SCROLL --- */}
            <div className="flex-1 mt-4 overflow-hidden">
                {(isLoading || loadingFuture) ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        <h5>Đang tải lịch sử...</h5>
                    </div>
                ) : (
                    <ScrollArea className="h-full pr-4">
                        {filteredHistory.length > 0 ? (
                            <div className="space-y-4">
                                {filteredHistory.map((item) => (
                                    <div key={item._id} className={`flex items-start gap-4 ${item.isFuture ? 'bg-blue-50 border border-blue-200 rounded-lg p-3' : ''}`}>
                                        <div className="flex-shrink-0">
                                            {item.isFuture ? (
                                                <Clock className="w-4 h-4 mt-2 text-blue-500" />
                                            ) : (
                                                <div className={`w-2 h-2 mt-2 rounded-full ${item?.status?.status ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <h5 className="font-semibold text-sm">
                                                        {item.isFuture ? item.actionName || item.type : `Hành động: ${item.type || 'Hành động'}`}
                                                    </h5>
                                                    {item.isFuture && (
                                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                            Tương lai
                                                        </span>
                                                    )}
                                                </div>
                                                <h5 className="text-xs text-muted-foreground">
                                                    {item.isFuture 
                                                        ? `Dự kiến: ${new Date(item.scheduledAt).toLocaleString('vi-VN')}`
                                                        : new Date(item.createdAt).toLocaleString('vi-VN')
                                                    }
                                                </h5>
                                            </div>
                                            {!item.isFuture && (
                                                <h5 className="text-xs text-muted-foreground">
                                                    Thực hiện bởi: {item.createBy?.name || 'Hệ thống'}
                                                </h5>
                                            )}
                                            {item.isFuture && item.workflowName && (
                                                <h5 className="text-xs text-muted-foreground">
                                                    Workflow: {item.workflowName}
                                                </h5>
                                            )}
                                            {item.isFuture && item.actionType && !item.workflowActions && (
                                                <h5 className="text-xs text-muted-foreground">
                                                    Loại hành động: {item.actionType}
                                                </h5>
                                            )}
                                            <h5 className="text-sm text-gray-600 mt-1">
                                                {item.isFuture ? (
                                                    <>
                                                        {/* Hiển thị các hành động của workflow từ repetitiontimes */}
                                                        {item.workflowActions && Array.isArray(item.workflowActions) && item.workflowActions.length > 0 ? (
                                                            <div className="space-y-2">
                                                                <div className="font-semibold text-xs text-gray-700 mb-1">
                                                                    Các hành động sẽ thực hiện:
                                                                </div>
                                                                {item.workflowActions.map((action, idx) => (
                                                                    <div key={idx} className="pl-2 border-l-2 border-blue-300">
                                                                        <div className="text-xs font-medium text-gray-700">
                                                                            {idx + 1}. {action.actionName}
                                                                        </div>
                                                                        {action.message && (
                                                                            <div className="text-xs text-gray-600 mt-1 italic pl-2">
                                                                                Nội dung: &quot;{action.message}&quot;
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                                <div className="mt-2 text-xs text-gray-500">
                                                                    Thời gian bắt đầu: {new Date(item.scheduledAt).toLocaleString('vi-VN')}
                                                                </div>
                                                            </div>
                                                        ) : item.message ? (
                                                            <div>
                                                                <span className="font-semibold">Nội dung: </span>
                                                                <span className="italic">&quot;{item.message}&quot;</span>
                                                                <div className="mt-1 text-xs text-gray-500">
                                                                    Thời gian thực hiện: {new Date(item.scheduledAt).toLocaleString('vi-VN')}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span>Hành động tự động sẽ được thực hiện vào {new Date(item.scheduledAt).toLocaleString('vi-VN')}</span>
                                                        )}
                                                    </>
                                                ) : (
                                                    item.status?.message || 'Không có mô tả.'
                                                )}
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