'use client';

import React, { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// --- MỚI: Import toast từ sonner ---
import { toast } from "sonner";

// --- Icon Imports ---
import { Loader2, ChevronsUpDown, Check, X } from 'lucide-react';

// --- Action & Data Function Imports ---
import { updateCustomerInfo } from '@/app/actions/customer.actions';
import { cn } from "@/lib/utils";

// --- Shadcn UI Component Imports ---
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";


// =============================================================
// == COMPONENT PHỤ: MultiSelect (Giữ nguyên)
// =============================================================
function MultiSelect({ options, selected, onChange, className }) {
    const [open, setOpen] = useState(false);
    const handleUnselect = (itemValue) => {
        onChange(selected.filter((v) => v !== itemValue));
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between h-auto min-h-[40px]">
                    <div className="flex gap-1 flex-wrap">
                        {selected.length > 0 ? (
                            options.filter(option => selected.includes(option.value)).map(option => (
                                <Badge variant="secondary" key={option.value} className="mr-1 mb-1" onClick={(e) => { e.stopPropagation(); handleUnselect(option.value); }}>
                                    <h6>{option.label}</h6>
                                    <X className="h-3 w-3 ml-1 text-muted-foreground cursor-pointer" />
                                </Badge>
                            ))
                        ) : (<h6>Chọn ngành học...</h6>)}
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command className={className}>
                    <CommandInput placeholder="Tìm kiếm ngành học..." />
                    <CommandList>
                        <CommandEmpty>Không tìm thấy ngành học.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem key={option.value} onSelect={() => {
                                    onChange(selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value]);
                                }}>
                                    <Check className={cn("mr-2 h-4 w-4", selected.includes(option.value) ? "opacity-100" : "opacity-0")} />
                                    {option.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

// =============================================================
// == COMPONENT CHÍNH
// =============================================================
const updateFormSchema = z.object({
    name: z.string().min(2, { message: 'Tên là bắt buộc.' }),
    email: z.string().email({ message: 'Email không hợp lệ.' }).optional().or(z.literal('')),
    area: z.string().optional(),
    bd: z.string().optional(),
    tags: z.array(z.string()).optional(),
});

export default function CustomerInfo({ customer, onClose, service = [] }) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const serviceOptions = useMemo(() =>
        service.map(item => ({ value: item._id, label: item.name })),
        [service]
    );

    const form = useForm({
        resolver: zodResolver(updateFormSchema),
        defaultValues: {
            name: customer.name || '',
            email: customer.email || '',
            area: customer.area || '',
            bd: customer.bd ? new Date(customer.bd).toISOString().split('T')[0] : '',
            tags: customer.tags?.map(tag => tag._id) || [],
        },
    });

    const onSubmit = async (values) => {
        setIsSubmitting(true);
        const formData = new FormData();
        formData.append('_id', customer._id);
        Object.entries(values).forEach(([key, value]) => {
            if (key === 'tags' && Array.isArray(value)) {
                value.forEach(tagId => formData.append('tags', tagId));
            } else {
                formData.append(key, value || '');
            }
        });

        // CẬP NHẬT: Truyền thẳng promise từ server action vào
        const promise = updateCustomerInfo(null, formData);

        toast.promise(promise, {
            loading: 'Đang cập nhật thông tin...',
            success: (result) => {
                setIsSubmitting(false);
                return result.message || 'Cập nhật thành công!';
            },
            error: (result) => {
                setIsSubmitting(false);
                return result.error || 'Cập nhật thất bại!';
            },
        });
    };

    return (
        <Form {...form}>
            {/* Không cần bất kỳ component thông báo hay lớp phủ nào ở đây */}
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4 flex-1 scroll">
                <h4 className='font-semibold' style={{ marginBottom: 16 }}>Thông tin cơ bản</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (<FormItem><Label><h6>Tên khách hàng *</h6></Label><FormControl><Input {...field} /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="email" render={({ field }) => (<FormItem><Label><h6>Email</h6></Label><FormControl><Input type="email" {...field} /></FormControl></FormItem>)} />
                    <div className="grid gap-2"><Label><h6>Nguồn chi tiết</h6></Label><Input defaultValue={customer.sourceDetails} disabled /></div>
                    <FormField control={form.control} name="area" render={({ field }) => (<FormItem><Label><h6>Khu vực</h6></Label><FormControl><Input {...field} /></FormControl></FormItem>)} />
                </div>
                <Separator className="my-4" />
                <h4 className='font-semibold' style={{ marginBottom: 16 }}>Thông tin liên hệ & Ngành học</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label><h6>Số điện thoại</h6></Label><Input defaultValue={customer.phone} disabled /></div>
                    <div className="grid gap-2"><Label><h6>Tên Zalo</h6></Label><Input defaultValue={customer.zaloname} disabled /></div>
                </div>

                <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                        <FormItem className="flex flex-col grid gap-2">
                            <FormLabel><h6 className="font-semibold">Ngành học quan tâm</h6></FormLabel>
                            <MultiSelect options={serviceOptions} selected={field.value} onChange={field.onChange} className="w-full" />
                        </FormItem>
                    )}
                />
                <DialogFooter className="pt-4">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Hủy</Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /><h6 style={{ color: 'white' }}>Đang lưu...</h6></> : <h6 style={{ color: 'white' }}>Lưu thay đổi</h6>}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
}