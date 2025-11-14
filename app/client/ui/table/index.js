'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// --- Shadcn UI & Icon Imports ---
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, SlidersHorizontal } from 'lucide-react';
import CustomerRow from './row';
import { getStatusInVietnamese, getCurrentStageFromPipeline } from '@/function/index'
// =============================================================
// == 1. ĐỊNH NGHĨA CỘT DỮ LIỆU VÀ CÁC HẰNG SỐ
// =============================================================

const ALL_COLUMNS = [
    { key: 'name', header: 'Tên Khách Hàng' },
    { key: 'phonex', header: 'Số Điện Thoại' },
    { key: 'currentStep', header: 'Bước Hiện Tại' },
    { key: 'pipelineStatus', header: 'Trạng Thái' },
    { key: 'tags', header: 'Ngành Học Quan Tâm' },
    { key: 'assignees', header: 'Nhân Sự Phụ Trách' },
    { key: 'sourceDetails', header: 'Nguồn' },
    { key: 'createAt', header: 'Ngày Tiếp Nhận' },
];

const INITIAL_VISIBLE_COLUMNS = ['name', 'phonex', 'currentStep', 'pipelineStatus', 'tags', 'assignees'];
const MAX_VISIBLE_COLUMNS = 6;

const useBreakpoint = () => {
    const [breakpoint, setBreakpoint] = useState('lg');
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 768) setBreakpoint('sm');
            else if (window.innerWidth < 1024) setBreakpoint('md');
            else setBreakpoint('lg');
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    return breakpoint;
};

// =============================================================
// == 2. COMPONENT BẢNG DỮ LIỆU CHÍNH
// =============================================================
export default function CustomerTable({ zalo, data = [], service, total = 0, user, selectedCustomers, setSelectedCustomers, viewMode }) {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();
    const breakpoint = useBreakpoint();

    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 10;
    const totalPages = Math.ceil(total / limit);

    const [visibleColumns, setVisibleColumns] = useState(INITIAL_VISIBLE_COLUMNS);

    const createURL = useCallback((paramsToUpdate) => {
        const params = new URLSearchParams(searchParams);
        Object.entries(paramsToUpdate).forEach(([key, value]) => {
            if (value !== undefined && value !== null) params.set(key, String(value));
            else params.delete(key);
        });
        if (paramsToUpdate.limit) params.set('page', '1');
        replace(`${pathname}?${params.toString()}`);
    }, [searchParams, pathname, replace]);

    const handleSelect = (customer, shouldSelect) => {
        setSelectedCustomers(prev => {
            const newMap = new Map(prev);
            if (shouldSelect) newMap.set(customer._id, customer);
            else newMap.delete(customer._id);
            return newMap;
        });
    };

    const handleSelectPage = (shouldSelectAll) => {
        setSelectedCustomers(prev => {
            const newMap = new Map(prev);
            if (shouldSelectAll) { data.forEach(c => newMap.set(c._id, c)); }
            else { data.forEach(c => newMap.delete(c._id)); }
            return newMap;
        });
    };

    const areAllSelectedOnPage = data.length > 0 && data.every(c => selectedCustomers.has(c._id));

    const renderedColumns = useMemo(() => {
        const guaranteed = ['name', 'phone'];
        const userSelected = [
            ...guaranteed.filter(c => visibleColumns.includes(c)),
            ...visibleColumns.filter(c => !guaranteed.includes(c))
        ];

        switch (breakpoint) {
            case 'sm': return userSelected.slice(0, 3);
            case 'md': return userSelected.slice(0, 4);
            case 'lg': default: return userSelected.slice(0, MAX_VISIBLE_COLUMNS);
        }
    }, [breakpoint, visibleColumns]);

    const renderCellContent = (customer, colKey) => {
        const value = customer[colKey];
        switch (colKey) {
            case 'createAt': return <h6>{new Date(value).toLocaleDateString('vi-VN')}</h6>;
            case 'tags':
                return <h6>{Array.isArray(value) ? value.map(tag => tag.name).join(', ') : '-'}</h6>;

            case 'pipelineStatus': {
                const status = getStatusInVietnamese(customer.pipelineStatus[0]);
                return <h6>{status}</h6>;
            }
            case 'assignees': return <h6>{Array.isArray(value) && value.length > 0 ? value.map(a => a.user?.name).join(', ') : '-'}</h6>;
            case 'currentStep': {
                // Hiển thị tối thiểu là Bước 1 nếu khách hàng chưa có bước trước đó
                const { currentStageId } = getCurrentStageFromPipeline(customer);
                return <h6>Bước {currentStageId}</h6>;
            }
            case 'phonex': {
                console.log(customer.phone, value == undefined);

                return <h6>{value != undefined ? String(value) : customer.phone}</h6>;
            }
            default: return <h6 className="truncate">{String(value)}</h6>;
        }
    };

    return (
        <div className="flex flex-col h-full bg-card border rounded-lg">
            <div className="flex-1 overflow-auto">
                <Table className="w-full">
                    <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                            <TableHead className="w-[60px]"><Checkbox checked={areAllSelectedOnPage} onCheckedChange={handleSelectPage} /></TableHead>
                            <TableHead className="w-[80px]"><h6>STT</h6></TableHead>
                            {renderedColumns.map(colKey => (
                                <TableHead key={colKey}><h6>{ALL_COLUMNS.find(c => c.key === colKey)?.header}</h6></TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.length > 0 ? (
                            data.map((customer, idx) => (
                                <CustomerRow
                                    key={customer._id}
                                    customer={customer}
                                    index={(page - 1) * limit + idx + 1}
                                    isSelected={selectedCustomers.has(customer._id)}
                                    onSelect={handleSelect}
                                    visibleColumns={renderedColumns}
                                    renderCellContent={renderCellContent}
                                    zalo={zalo}
                                    user={user}
                                    service={service}
                                />
                            ))
                        ) : (
                            <TableRow><TableCell colSpan={renderedColumns.length + 2} className="h-24 text-center"><h6>Không có dữ liệu.</h6></TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-center justify-between p-2 border-t">
                <div className="flex-1 text-sm text-muted-foreground">
                    <h6>{selectedCustomers.size} của {total} dòng được chọn.</h6>
                </div>
                <div className="flex items-center gap-2 md:gap-4 lg:gap-8">
                    <div className="flex items-center gap-2">
                        <h6 className="text-sm font-medium hidden md:block">Số dòng:</h6>
                        <Select value={`${limit}`} onValueChange={(value) => createURL({ limit: Number(value) })}>
                            <SelectTrigger className="h-8 w-[70px]"><SelectValue placeholder={limit} /></SelectTrigger>
                            <SelectContent side="top">
                                {[10, 20, 50, 100].map((pageSize) => (<SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center justify-center text-sm font-medium"><h6>Trang {page} của {totalPages}</h6></div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" className="h-8 w-8 p-0" onClick={() => createURL({ page: 1 })} disabled={page <= 1}><ChevronsLeft className="h-4 w-4" /></Button>
                        <Button variant="outline" className="h-8 w-8 p-0" onClick={() => createURL({ page: page - 1 })} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
                        <Button variant="outline" className="h-8 w-8 p-0" onClick={() => createURL({ page: page + 1 })} disabled={page >= totalPages}><ChevronRight className="h-4 w-4" /></Button>
                        <Button variant="outline" className="h-8 w-8 p-0" onClick={() => createURL({ page: totalPages })} disabled={page >= totalPages}><ChevronsRight className="h-4 w-4" /></Button>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="outline"><SlidersHorizontal className="mr-2 h-4 w-4" /><h6>Cột</h6></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel><h6>Hiển thị cột (tối đa {MAX_VISIBLE_COLUMNS})</h6></DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <TooltipProvider>
                                {ALL_COLUMNS.map((column) => {
                                    const isChecked = visibleColumns.includes(column.key);
                                    const isDisabled = !isChecked && visibleColumns.length >= MAX_VISIBLE_COLUMNS;
                                    return (
                                        <Tooltip key={column.key} delayDuration={100}>
                                            <TooltipTrigger asChild>
                                                <div className={isDisabled ? 'cursor-not-allowed' : ''}>
                                                    <DropdownMenuCheckboxItem checked={isChecked} disabled={isDisabled} onCheckedChange={(value) => {
                                                        const newCols = value ? [...visibleColumns, column.key] : visibleColumns.filter((key) => key !== column.key);
                                                        setVisibleColumns(newCols);
                                                    }}><h6>{column.header}</h6></DropdownMenuCheckboxItem>
                                                </div>
                                            </TooltipTrigger>
                                            {isDisabled && (<TooltipContent><p>Bỏ chọn một cột khác để chọn cột này.</p></TooltipContent>)}
                                        </Tooltip>
                                    );
                                })}
                            </TooltipProvider>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
}