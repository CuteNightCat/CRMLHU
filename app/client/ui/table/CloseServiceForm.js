'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileImage, DollarSign, Percent, Tag, X, Plus, Download, Trash2, RotateCcw } from 'lucide-react';

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function CloseServiceForm({
    form,
    status,
    services,
    availableCourses,
    listPrice,
    finalRevenue,
    discountType,
    fileReg,                 // form.register('invoiceImage')
    onImageChange,
    existingImageUrls = [],
    setExistingImageUrls,
    existingImageIds = [],
    setExistingImageIds,
    newImagePreviews = [],
    onRemoveNewImage,
    customerPhotoFileReg,
    onCustomerPhotoChange,
    existingCustomerPhotoUrls = [],
    setExistingCustomerPhotoUrls,
    existingCustomerPhotoIds = [],
    setExistingCustomerPhotoIds,
    newCustomerPhotoPreviews = [],
    onRemoveCustomerPhoto,
    onSubmit,
    readOnly = false,
    unifiedInvoiceImages = [],
    setUnifiedInvoiceImages,
    onReorderInvoiceImages,
    unifiedCustomerPhotos = [],
    setUnifiedCustomerPhotos,
    onReorderCustomerPhotos,
    onGetDeletedIds, // Callback để lấy các ID đã xóa khi submit
    resetToken,
}) {
    if (!form) return null;

    const currencyVN = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0));

    // State cho checkbox trong chế độ xem - ảnh minh chứng (readOnly để download)
    const [selectedImageIndices, setSelectedImageIndices] = useState(() => {
        if (readOnly && existingImageUrls.length > 0) {
            return existingImageUrls.map((_, i) => i);
        }
        return [];
    });

    const [invoiceReloadToken, setInvoiceReloadToken] = useState(() => Date.now());
    const [customerPhotoReloadToken, setCustomerPhotoReloadToken] = useState(() => Date.now());
    const [invoiceImageErrorTokens, setInvoiceImageErrorTokens] = useState({});
    const [customerPhotoErrorTokens, setCustomerPhotoErrorTokens] = useState({});

    useEffect(() => {
        setInvoiceReloadToken(Date.now());
        setInvoiceImageErrorTokens({});
    }, [existingImageUrls]);

    useEffect(() => {
        setCustomerPhotoReloadToken(Date.now());
        setCustomerPhotoErrorTokens({});
    }, [existingCustomerPhotoUrls]);

    const buildCacheBustedUrl = (url, token) => {
        if (!url) return url;
        try {
            const parsed = new URL(url);
            parsed.searchParams.set('_cb', String(token));
            return parsed.toString();
        } catch (_error) {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}_cb=${token}`;
        }
    };

    // Reset selected indices khi existingImageUrls thay đổi trong chế độ xem
    useEffect(() => {
        if (readOnly && existingImageUrls.length > 0) {
            setSelectedImageIndices(existingImageUrls.map((_, i) => i));
        }
    }, [existingImageUrls.length, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

    // State cho checkbox trong chế độ xem - ảnh khách hàng (readOnly để download)
    const [selectedCustomerPhotoIndices, setSelectedCustomerPhotoIndices] = useState(() => {
        if (readOnly && existingCustomerPhotoUrls.length > 0) {
            return existingCustomerPhotoUrls.map((_, i) => i);
        }
        return [];
    });

    // Reset selected indices khi existingCustomerPhotoUrls thay đổi trong chế độ xem
    useEffect(() => {
        if (readOnly && existingCustomerPhotoUrls.length > 0) {
            setSelectedCustomerPhotoIndices(existingCustomerPhotoUrls.map((_, i) => i));
        }
    }, [existingCustomerPhotoUrls.length, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

    // State cho các ID ảnh được chọn để xóa (chế độ edit - ảnh đã lưu)
    const [selectedImageIdsToDelete, setSelectedImageIdsToDelete] = useState([]);
    const [selectedCustomerPhotoIdsToDelete, setSelectedCustomerPhotoIdsToDelete] = useState([]);
    
    // State cho các ID ảnh đã bị xóa (để gửi lên server khi submit)
    const [deletedImageIds, setDeletedImageIds] = useState([]);
    const [deletedCustomerPhotoIds, setDeletedCustomerPhotoIds] = useState([]);

    useEffect(() => {
        setSelectedImageIdsToDelete([]);
        setSelectedCustomerPhotoIdsToDelete([]);
        setDeletedImageIds([]);
        setDeletedCustomerPhotoIds([]);
    }, [resetToken]);

    const downloadImage = async (url, filename) => {
        try {
            const response = await fetch(url, { mode: 'cors' });
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename || 'image.jpg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        } catch (_) {
            try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
        }
    };

    const downloadSelectedImages = async () => {
        if (selectedImageIndices.length === 0) return;
        
        for (let i = 0; i < selectedImageIndices.length; i++) {
            const index = selectedImageIndices[i];
            const url = buildCacheBustedUrl(existingImageUrls[index], Date.now());
            const filename = `invoice-${index + 1}.jpg`;
            // Delay nhỏ giữa các lần tải để tránh trình duyệt block
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));
            await downloadImage(url, filename);
        }
    };

    const toggleImageSelection = (index) => {
        if (readOnly) {
            // Chế độ xem: để download
            setSelectedImageIndices(prev => 
                prev.includes(index) 
                    ? prev.filter(i => i !== index)
                    : [...prev, index]
            );
        }
    };

    // Toggle chọn ảnh để xóa (chế độ edit)
    const toggleImageSelectionForDelete = (imageId) => {
        if (readOnly) return;
        setSelectedImageIdsToDelete(prev => 
            prev.includes(imageId) 
                ? prev.filter(id => id !== imageId)
                : [...prev, imageId]
        );
    };

    const downloadSelectedCustomerPhotos = async () => {
        if (selectedCustomerPhotoIndices.length === 0) return;
        
        for (let i = 0; i < selectedCustomerPhotoIndices.length; i++) {
            const index = selectedCustomerPhotoIndices[i];
            const url = buildCacheBustedUrl(existingCustomerPhotoUrls[index], Date.now());
            const filename = `customer-photo-${index + 1}.jpg`;
            // Delay nhỏ giữa các lần tải để tránh trình duyệt block
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));
            await downloadImage(url, filename);
        }
    };

    const toggleCustomerPhotoSelection = (index) => {
        if (readOnly) {
            // Chế độ xem: để download
            setSelectedCustomerPhotoIndices(prev => 
                prev.includes(index) 
                    ? prev.filter(i => i !== index)
                    : [...prev, index]
            );
        }
    };

    // Toggle chọn ảnh khách hàng để xóa (chế độ edit)
    const toggleCustomerPhotoSelectionForDelete = (photoId) => {
        if (readOnly) return;
        setSelectedCustomerPhotoIdsToDelete(prev => 
            prev.includes(photoId) 
                ? prev.filter(id => id !== photoId)
                : [...prev, photoId]
        );
    };

    const updateInvoiceErrorToken = (key, updater) => {
        setInvoiceImageErrorTokens(prev => {
            const current = prev[key] || { count: 0, token: invoiceReloadToken };
            const next = updater(current);
            if (!next) {
                if (prev[key]) {
                    const { [key]: _, ...rest } = prev;
                    return rest;
                }
                return prev;
            }
            if (next.count === current.count && next.token === current.token) {
                return prev;
            }
            return { ...prev, [key]: next };
        });
    };

    const updateCustomerPhotoErrorToken = (key, updater) => {
        setCustomerPhotoErrorTokens(prev => {
            const current = prev[key] || { count: 0, token: customerPhotoReloadToken };
            const next = updater(current);
            if (!next) {
                if (prev[key]) {
                    const { [key]: _, ...rest } = prev;
                    return rest;
                }
                return prev;
            }
            if (next.count === current.count && next.token === current.token) {
                return prev;
            }
            return { ...prev, [key]: next };
        });
    };

    const handleInvoiceImageError = (key) => {
        updateInvoiceErrorToken(key, (current) => {
            if (current.count >= 3) return current;
            return { count: current.count + 1, token: Date.now() };
        });
    };

    const handleCustomerPhotoError = (key) => {
        updateCustomerPhotoErrorToken(key, (current) => {
            if (current.count >= 3) return current;
            return { count: current.count + 1, token: Date.now() };
        });
    };

    // Xóa các ảnh đã chọn khỏi giao diện (chưa xóa khỏi DB, chỉ xóa khi submit)
    const handleDeleteSelectedInvoiceImages = () => {
        if (selectedImageIdsToDelete.length === 0) return;
        
        // Lưu các ID đã xóa để gửi lên server khi submit
        setDeletedImageIds(prev => [...prev, ...selectedImageIdsToDelete]);
        
        // Xóa khỏi unified state
        if (setUnifiedInvoiceImages) {
            setUnifiedInvoiceImages(prev => prev.filter(img => 
                !(img.type === 'existing' && img.id && selectedImageIdsToDelete.includes(img.id))
            ));
        }
        
        // Xóa khỏi existing arrays
        const idsToKeep = existingImageIds.filter(id => !selectedImageIdsToDelete.includes(id));
        const urlsToKeep = existingImageUrls.filter((url, idx) => 
            existingImageIds[idx] && !selectedImageIdsToDelete.includes(existingImageIds[idx])
        );
        
        setExistingImageIds(idsToKeep);
        setExistingImageUrls(urlsToKeep);
        
        // Reset selection
        setSelectedImageIdsToDelete([]);
    };

    const handleDeleteSelectedCustomerPhotos = () => {
        if (selectedCustomerPhotoIdsToDelete.length === 0) return;
        
        // Lưu các ID đã xóa để gửi lên server khi submit
        setDeletedCustomerPhotoIds(prev => [...prev, ...selectedCustomerPhotoIdsToDelete]);
        
        // Xóa khỏi unified state
        if (setUnifiedCustomerPhotos) {
            setUnifiedCustomerPhotos(prev => prev.filter(img => 
                !(img.type === 'existing' && img.id && selectedCustomerPhotoIdsToDelete.includes(img.id))
            ));
        }
        
        // Xóa khỏi existing arrays
        const idsToKeep = existingCustomerPhotoIds.filter(id => !selectedCustomerPhotoIdsToDelete.includes(id));
        const urlsToKeep = existingCustomerPhotoUrls.filter((url, idx) => 
            existingCustomerPhotoIds[idx] && !selectedCustomerPhotoIdsToDelete.includes(existingCustomerPhotoIds[idx])
        );
        
        setExistingCustomerPhotoIds(idsToKeep);
        setExistingCustomerPhotoUrls(urlsToKeep);
        
        // Reset selection
        setSelectedCustomerPhotoIdsToDelete([]);
    };

    // Drag & Drop cho ảnh (unified - cả existing và new)
    const handleDragStart = (e, index) => {
        if (readOnly || !onReorderInvoiceImages) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        e.currentTarget.style.opacity = '0.5';
    };

    const handleDragEnd = (e) => {
        e.currentTarget.style.opacity = '1';
    };

    const handleDragOver = (e) => {
        if (readOnly || !onReorderInvoiceImages) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, dropIndex) => {
        if (readOnly || !onReorderInvoiceImages) return;
        e.preventDefault();
        
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (dragIndex === dropIndex || isNaN(dragIndex)) return;
        
        onReorderInvoiceImages(dragIndex, dropIndex);
    };

    // Drag & Drop cho ảnh khách hàng (unified)
    const handleCustomerPhotoDragStart = (e, index) => {
        if (readOnly || !onReorderCustomerPhotos) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        e.currentTarget.style.opacity = '0.5';
    };

    const handleCustomerPhotoDragEnd = (e) => {
        e.currentTarget.style.opacity = '1';
    };

    const handleCustomerPhotoDragOver = (e) => {
        if (readOnly || !onReorderCustomerPhotos) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleCustomerPhotoDrop = (e, dropIndex) => {
        if (readOnly || !onReorderCustomerPhotos) return;
        e.preventDefault();
        
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (dragIndex === dropIndex || isNaN(dragIndex)) return;
        
        onReorderCustomerPhotos(dragIndex, dropIndex);
    };

    // cập nhật cờ boolean cho Zod khi có ảnh cũ
    useEffect(() => {
        form.setValue('hasExistingInvoice', (existingImageUrls?.length ?? 0) > 0, { shouldValidate: true });
    }, [existingImageUrls, form]);

    // input file ẩn + ref kép để click từ tile
    const reg = fileReg || {};
    const { ref: rhfRef = () => { }, name = 'invoiceImage', onBlur = () => { }, onChange: rhfOnChange } = reg;
    const fileInputRef = useRef(null);
    const attachRef = (el) => { fileInputRef.current = el; try { rhfRef(el); } catch (_) { } };
    const openFileDialog = () => fileInputRef.current?.click();

    const handleFileChange = (e) => {
        onImageChange?.(e);

        // Cho phép chọn lại cùng file vẫn onChange
        e.target.value = '';
    };

    // ref cho ảnh khách hàng
    const regCustomerPhoto = customerPhotoFileReg || {};
    const { ref: customerPhotoRhfRef = () => { }, name: customerPhotoName = 'customerPhotos', onBlur: customerPhotoOnBlur = () => { } } = regCustomerPhoto;
    const customerPhotoFileInputRef = useRef(null);
    const attachCustomerPhotoRef = (el) => { customerPhotoFileInputRef.current = el; try { customerPhotoRhfRef(el); } catch (_) { } };
    const openCustomerPhotoDialog = () => customerPhotoFileInputRef.current?.click();

    const handleCustomerPhotoFileChange = (e) => {
        onCustomerPhotoChange?.(e);
        e.target.value = '';
    };

    return (
        <Form {...form}>
            <form
                id="close-service-form"
                className="space-y-6"
                onSubmit={(e) => {
                    if (readOnly) {
                        e.preventDefault();
                        return;
                    }
                    e.preventDefault(); // Prevent default để kiểm tra validation trước
                    
                    // Cập nhật deleted IDs trước khi submit
                    if (onGetDeletedIds) {
                        onGetDeletedIds({
                            deletedImageIds,
                            deletedCustomerPhotoIds,
                        });
                    }
                    
                    // Kiểm tra validation trước khi submit
                    form.handleSubmit(
                        (values) => {
                            console.log('✅ Form validation passed, submitting...', values);
                            onSubmit(values);
                        },
                        (errors) => {
                            console.error('❌ Form validation failed:', errors);
                        }
                    )(e);
                }}
            >
                {/* Hidden boolean cho zod (z.coerce.boolean) */}
                <input type="hidden" {...form.register('hasExistingInvoice')} />

                {/* -------- Trạng thái cuối -------- */}
                <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem className="space-y-3">
                        <FormLabel>Trạng thái cuối *</FormLabel>
                        <FormControl>
                            <RadioGroup
                                onValueChange={readOnly ? undefined : field.onChange}
                                value={field.value ?? 'completed'}
                                className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4"
                            >
                                <FormItem className="flex items-center space-x-2">
                                    <FormControl><RadioGroupItem value="completed" disabled={readOnly} /></FormControl>
                                    <FormLabel className="font-normal">Hoàn thành</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-2">
                                    <FormControl><RadioGroupItem value="in_progress" disabled={readOnly} /></FormControl>
                                    <FormLabel className="font-normal">Còn chương trình</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-2">
                                    <FormControl><RadioGroupItem value="rejected" disabled={readOnly} /></FormControl>
                                    <FormLabel className="font-normal">Từ chối sau khám</FormLabel>
                                </FormItem>
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />

                {/* -------- Ngành học -------- */}
                <FormField control={form.control} name="selectedService" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Ngành học chốt *</FormLabel>
                        <Select
                            onValueChange={readOnly ? undefined : (val) => field.onChange(String(val))}
                            value={field.value ? String(field.value) : undefined}
                            disabled={readOnly || status === 'rejected'}
                        >
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="-- Chọn ngành học --" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {services?.map((s) => (
                                    <SelectItem key={s._id} value={String(s._id)}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />

                {/* Chương trình của ngành học */}
                <FormField control={form.control} name="selectedCourseName" render={({ field }) => {
                    return (
                        <FormItem>
                            <FormLabel>Chương trình của ngành học đó *</FormLabel>
                            <Select
                                onValueChange={readOnly ? undefined : (val) => field.onChange(String(val))}
                                value={field.value ? String(field.value) : undefined}
                                disabled={readOnly || status === 'rejected' || !form.getValues('selectedService') || (availableCourses?.length || 0) === 0}
                            >
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="-- Chọn chương trình --" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {availableCourses?.map((c, idx) => (
                                        <SelectItem key={`${c.name}-${idx}`} value={String(c.name)}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )
                }} />

                {/* -------- Giá & điều chỉnh -------- */}
                <div className="space-y-3">
                    <FormLabel>Giá &amp; Giảm giá</FormLabel>
                    <div className="p-4 border rounded-md bg-muted/50 mt-3 space-y-4">
                        {/* Hàng 1: Giá gốc và Radio buttons */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormItem>
                                <FormLabel className="text-xs">Giá gốc (VND)</FormLabel>
                                <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
                                    {currencyVN(listPrice)}
                                </div>
                            </FormItem>

                            <FormField control={form.control} name="adjustmentType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Loại điều chỉnh</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={readOnly ? undefined : field.onChange}
                                            value={field.value ?? 'none'}
                                            className="flex gap-6"
                                            disabled={readOnly || status === 'rejected'}
                                        >
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="discount" id="discount" />
                                                <FormLabel htmlFor="discount" className="font-normal cursor-pointer">Giảm</FormLabel>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="increase" id="increase" />
                                                <FormLabel htmlFor="increase" className="font-normal cursor-pointer">Tăng</FormLabel>
                                            </div>
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        {/* Hàng 2: Giá trị giảm, Giá trị tăng, Đơn vị */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormField control={form.control} name="discountValue" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Giá trị giảm</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="text"
                                            value={field.value ?? '0'}
                                            onChange={(e) => {
                                                const digits = e.target.value.replace(/\D/g, '');
                                                field.onChange(currencyVN(digits));
                                            }}
                                            disabled={readOnly || status === 'rejected' || (form.getValues('adjustmentType') ?? 'none') !== 'discount'}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="adjustmentValue" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Giá trị tăng</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="text"
                                            value={field.value ?? '0'}
                                            onChange={(e) => {
                                                const digits = e.target.value.replace(/\D/g, '');
                                                field.onChange(currencyVN(digits));
                                            }}
                                            disabled={readOnly || status === 'rejected' || (form.getValues('adjustmentType') ?? 'none') !== 'increase'}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="discountType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Đơn vị giảm/tăng</FormLabel>
                                    <FormControl>
                                        <Select onValueChange={readOnly ? undefined : field.onChange} value={field.value ?? 'none'} disabled={readOnly || status === 'rejected'}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Loại" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none"><Tag className="w-4 h-4 mr-2 inline-block" />Không</SelectItem>
                                                <SelectItem value="amount"><DollarSign className="w-4 h-4 mr-2 inline-block" />VND</SelectItem>
                                                <SelectItem value="percent"><Percent className="w-4 h-4 mr-2 inline-block" />%</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        {/* Hàng 3: Thành tiền */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormItem>
                                <FormLabel className="text-xs font-semibold">Thành tiền (VND)</FormLabel>
                                <div className="flex h-10 w-full items-center rounded-md border border-input px-3 py-2 text-sm">
                                    {currencyVN(finalRevenue)}
                                </div>
                            </FormItem>
                        </div>
                    </div>
                </div>

                {/* -------- Ghi chú -------- */}
                <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Ghi chú</FormLabel>
                        <FormControl>
                            <Textarea
                                placeholder="Ghi chú thêm về hợp đồng, thanh toán..."
                                value={field.value ?? ''}
                                onChange={readOnly ? undefined : field.onChange}
                                onBlur={readOnly ? undefined : field.onBlur}
                                disabled={readOnly}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />

                {/* -------- Upload ảnh (gộp 1 chỗ) -------- */}
                <FormField control={form.control} name="invoiceImage" render={() => (
                    <FormItem>
                        <div className="flex items-center justify-between">
                            <FormLabel className="flex items-center">
                                <FileImage className="mr-1 h-4 w-4" />
                                Ảnh minh chứng (Hóa đơn/Hợp đồng)
                                {form.getValues('_id') && form.getValues('hasExistingInvoice')
                                    ? ' (đang có ảnh đã lưu, có thể thêm ảnh mới)'
                                    : ' *'}
                            </FormLabel>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setInvoiceImageErrorTokens({});
                                        setInvoiceReloadToken(Date.now());
                                    }}
                                    disabled={existingImageUrls.length === 0}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Tải lại ảnh
                                </Button>
                                {!readOnly && existingImageIds.length > 0 && selectedImageIdsToDelete.length > 0 && (
                                    <Button 
                                        type="button"
                                        size="sm"
                                        onClick={handleDeleteSelectedInvoiceImages}
                                        variant="destructive"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Xóa đã chọn ({selectedImageIdsToDelete.length})
                                    </Button>
                                )}
                                {readOnly && existingImageUrls.length > 0 && (
                                    <Button 
                                        type="button"
                                        size="sm"
                                        onClick={downloadSelectedImages}
                                        disabled={selectedImageIndices.length === 0}
                                        variant="outline"
                                        className="border-green-600 text-green-700 hover:bg-green-50"
                                    >
                                        <Download className="mr-2 h-4 w-4" />
                                        Tải ảnh đã chọn ({selectedImageIndices.length})
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* input file ẩn */}
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            name={name}
                            onBlur={onBlur}
                            ref={attachRef}
                            onChange={handleFileChange}
                            className="hidden"
                            disabled={readOnly}
                        />

                        {/* grid preview + tile Thêm ảnh */}
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-2">
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={openFileDialog}
                                    className="aspect-square border-2 border-dashed rounded-md flex flex-col items-center justify-center text-sm hover:bg-muted/40"
                                    aria-label="Thêm ảnh"
                                >
                                    <Plus className="w-6 h-6 mb-1" />
                                    Thêm ảnh
                                </button>
                            )}

                            {/* Hiển thị tất cả ảnh từ unified state (theo thứ tự đã sắp xếp) */}
                            {unifiedInvoiceImages.length > 0 ? (
                                unifiedInvoiceImages.map((img, unifiedIndex) => {
                                    const isExisting = img.type === 'existing';
                                    // Tìm index trong mảng riêng lẻ để xử lý checkbox và remove
                                    const existingIndex = isExisting 
                                        ? existingImageUrls.findIndex(url => url === img.url)
                                        : -1;
                                    const newIndex = !isExisting
                                        ? newImagePreviews.findIndex(p => p.url === img.url)
                                        : -1;
                                    const invoiceErrorKey = isExisting ? (img.id || `existing-${existingIndex}`) : null;
                                    const invoiceToken = invoiceErrorKey && invoiceImageErrorTokens[invoiceErrorKey]
                                        ? invoiceImageErrorTokens[invoiceErrorKey].token
                                        : invoiceReloadToken;
                                    const displayUrl = isExisting ? buildCacheBustedUrl(img.url, invoiceToken) : img.url;

                                    return (
                                        <div 
                                            key={isExisting ? `existing-${unifiedIndex}` : `new-${unifiedIndex}`} 
                                            className="relative aspect-square group"
                                            {...(!readOnly && onReorderInvoiceImages ? { draggable: true } : {})}
                                            onDragStart={(!readOnly && onReorderInvoiceImages) ? (e) => handleDragStart(e, unifiedIndex) : undefined}
                                            onDragEnd={(!readOnly && onReorderInvoiceImages) ? handleDragEnd : undefined}
                                            onDragOver={(!readOnly && onReorderInvoiceImages) ? handleDragOver : undefined}
                                            onDrop={(!readOnly && onReorderInvoiceImages) ? (e) => handleDrop(e, unifiedIndex) : undefined}
                                            style={{ cursor: readOnly ? 'pointer' : (onReorderInvoiceImages ? 'move' : 'default') }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {readOnly ? (
                                                <a href={displayUrl} target="_blank" rel="noopener noreferrer" download>
                                                    <img
                                                        src={displayUrl}
                                                        alt={`Ảnh ${unifiedIndex + 1}`}
                                                        className="h-full w-full object-cover rounded-md border hover:opacity-90 cursor-pointer"
                                                        referrerPolicy="no-referrer"
                                                        onError={() => invoiceErrorKey && handleInvoiceImageError(invoiceErrorKey)}
                                                    />
                                                </a>
                                            ) : (
                                                <img
                                                    src={displayUrl}
                                                    alt={`Ảnh ${unifiedIndex + 1}`}
                                                    className="h-full w-full object-cover rounded-md border"
                                                    referrerPolicy="no-referrer"
                                                    onError={() => invoiceErrorKey && handleInvoiceImageError(invoiceErrorKey)}
                                                />
                                            )}
                                            {isExisting && (
                                                <Badge variant="secondary" className="absolute top-1 left-1 text-xs">Đã lưu</Badge>
                                            )}
                                            {!readOnly && !isExisting && onRemoveNewImage && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRemoveNewImage(newIndex)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    aria-label="Xóa ảnh này"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                            {!readOnly && isExisting && img.id && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedImageIdsToDelete.includes(img.id)}
                                                            onCheckedChange={() => toggleImageSelectionForDelete(img.id)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            {readOnly && isExisting && existingIndex !== -1 && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedImageIndices.includes(existingIndex)}
                                                            onCheckedChange={() => toggleImageSelection(existingIndex)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                // Fallback: hiển thị theo cách cũ nếu chưa có unified state
                                <>
                                    {existingImageUrls.map((url, index) => {
                                        const invoiceErrorKey = `existing-${index}`;
                                        const invoiceToken = invoiceImageErrorTokens[invoiceErrorKey]
                                            ? invoiceImageErrorTokens[invoiceErrorKey].token
                                            : invoiceReloadToken;
                                        const displayUrl = buildCacheBustedUrl(url, invoiceToken);
                                        return (
                                            <div 
                                                key={`existing-${index}`} 
                                                className="relative aspect-square group"
                                                {...(!readOnly ? { draggable: true } : {})}
                                                onDragStart={!readOnly ? (e) => handleDragStart(e, index) : undefined}
                                                onDragEnd={!readOnly ? handleDragEnd : undefined}
                                                onDragOver={!readOnly ? handleDragOver : undefined}
                                                onDrop={!readOnly ? (e) => handleDrop(e, index) : undefined}
                                                style={{ cursor: readOnly ? 'pointer' : 'move' }}
                                            >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {readOnly ? (
                                                <a href={displayUrl} target="_blank" rel="noopener noreferrer" download>
                                                <img
                                                    src={displayUrl}
                                                    alt={`Ảnh đã lưu ${index + 1}`}
                                                    className="h-full w-full object-cover rounded-md border hover:opacity-90 cursor-pointer"
                                                    referrerPolicy="no-referrer"
                                                    onError={() => handleInvoiceImageError(invoiceErrorKey)}
                                                />
                                                </a>
                                            ) : (
                                                <img
                                                    src={displayUrl}
                                                    alt={`Ảnh đã lưu ${index + 1}`}
                                                    className="h-full w-full object-cover rounded-md border"
                                                    referrerPolicy="no-referrer"
                                                    onError={() => handleInvoiceImageError(invoiceErrorKey)}
                                                />
                                            )}
                                            <Badge variant="secondary" className="absolute top-1 left-1 text-xs">Đã lưu</Badge>
                                            {readOnly && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedImageIndices.includes(index)}
                                                            onCheckedChange={() => toggleImageSelection(index)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            </div>
                                        );
                                    })}
                                    {newImagePreviews.map((preview, index) => (
                                        <div key={`new-${index}`} className="relative aspect-square">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={preview.url} alt={`Xem trước ảnh ${index + 1}`} className="h-full w-full object-cover rounded-md border" />
                                            {!readOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRemoveNewImage(index)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    aria-label="Xóa ảnh này"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <FormMessage />
                    </FormItem>
                )} />

                {/* -------- Ảnh khách hàng minh chứng -------- */}
                <FormField control={form.control} name="customerPhotos" render={() => (
                    <FormItem>
                        <div className="flex items-center justify-between">
                            <FormLabel className="flex items-center">
                                <FileImage className="mr-1 h-4 w-4" />
                                Ảnh khách hàng minh chứng
                            </FormLabel>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setCustomerPhotoErrorTokens({});
                                        setCustomerPhotoReloadToken(Date.now());
                                    }}
                                    disabled={existingCustomerPhotoUrls.length === 0}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Tải lại ảnh
                                </Button>
                                {!readOnly && existingCustomerPhotoIds.length > 0 && selectedCustomerPhotoIdsToDelete.length > 0 && (
                                    <Button 
                                        type="button"
                                        size="sm"
                                        onClick={handleDeleteSelectedCustomerPhotos}
                                        variant="destructive"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Xóa đã chọn ({selectedCustomerPhotoIdsToDelete.length})
                                    </Button>
                                )}
                                {readOnly && existingCustomerPhotoUrls.length > 0 && (
                                    <Button 
                                        type="button"
                                        size="sm"
                                        onClick={downloadSelectedCustomerPhotos}
                                        disabled={selectedCustomerPhotoIndices.length === 0}
                                        variant="outline"
                                        className="border-green-600 text-green-700 hover:bg-green-50"
                                    >
                                        <Download className="mr-2 h-4 w-4" />
                                        Tải ảnh đã chọn ({selectedCustomerPhotoIndices.length})
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* input file ẩn */}
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            name={customerPhotoName}
                            onBlur={customerPhotoOnBlur}
                            ref={attachCustomerPhotoRef}
                            onChange={handleCustomerPhotoFileChange}
                            className="hidden"
                            disabled={readOnly}
                        />

                        {/* grid preview + tile Thêm ảnh */}
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-2">
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={openCustomerPhotoDialog}
                                    className="aspect-square border-2 border-dashed rounded-md flex flex-col items-center justify-center text-sm hover:bg-muted/40"
                                    aria-label="Thêm ảnh"
                                >
                                    <Plus className="w-6 h-6 mb-1" />
                                    Thêm ảnh
                                </button>
                            )}

                            {/* Hiển thị tất cả ảnh từ unified state (theo thứ tự đã sắp xếp) */}
                            {unifiedCustomerPhotos.length > 0 ? (
                                unifiedCustomerPhotos.map((img, unifiedIndex) => {
                                    const isExisting = img.type === 'existing';
                                    const existingIndex = isExisting 
                                        ? existingCustomerPhotoUrls.findIndex(url => url === img.url)
                                        : -1;
                                    const newIndex = !isExisting
                                        ? newCustomerPhotoPreviews.findIndex(p => p.url === img.url)
                                        : -1;
                                    const customerErrorKey = isExisting ? (img.id || `customer-existing-${existingIndex}`) : null;
                                    const customerToken = customerErrorKey && customerPhotoErrorTokens[customerErrorKey]
                                        ? customerPhotoErrorTokens[customerErrorKey].token
                                        : customerPhotoReloadToken;
                                    const displayUrl = isExisting ? buildCacheBustedUrl(img.url, customerToken) : img.url;

                                    return (
                                        <div 
                                            key={isExisting ? `customer-photo-existing-${unifiedIndex}` : `customer-photo-new-${unifiedIndex}`} 
                                            className="relative aspect-square group"
                                            {...(!readOnly && onReorderCustomerPhotos ? { draggable: true } : {})}
                                            onDragStart={(!readOnly && onReorderCustomerPhotos) ? (e) => handleCustomerPhotoDragStart(e, unifiedIndex) : undefined}
                                            onDragEnd={(!readOnly && onReorderCustomerPhotos) ? handleCustomerPhotoDragEnd : undefined}
                                            onDragOver={(!readOnly && onReorderCustomerPhotos) ? handleCustomerPhotoDragOver : undefined}
                                            onDrop={(!readOnly && onReorderCustomerPhotos) ? (e) => handleCustomerPhotoDrop(e, unifiedIndex) : undefined}
                                            style={{ cursor: readOnly ? 'pointer' : (onReorderCustomerPhotos ? 'move' : 'default') }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {readOnly ? (
                                                <a href={displayUrl} target="_blank" rel="noopener noreferrer" download>
                                                    <img
                                                        src={displayUrl}
                                                        alt={`Ảnh khách hàng ${unifiedIndex + 1}`}
                                                        className="h-full w-full object-cover rounded-md border hover:opacity-90 cursor-pointer"
                                                        referrerPolicy="no-referrer"
                                                        onError={() => customerErrorKey && handleCustomerPhotoError(customerErrorKey)}
                                                    />
                                                </a>
                                            ) : (
                                                <img
                                                    src={displayUrl}
                                                    alt={`Ảnh khách hàng ${unifiedIndex + 1}`}
                                                    className="h-full w-full object-cover rounded-md border"
                                                    referrerPolicy="no-referrer"
                                                    onError={() => customerErrorKey && handleCustomerPhotoError(customerErrorKey)}
                                                />
                                            )}
                                            {isExisting && (
                                                <Badge variant="secondary" className="absolute top-1 left-1 text-xs">Đã lưu</Badge>
                                            )}
                                            {!readOnly && !isExisting && onRemoveCustomerPhoto && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRemoveCustomerPhoto(newIndex)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    aria-label="Xóa ảnh này"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                            {!readOnly && isExisting && img.id && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedCustomerPhotoIdsToDelete.includes(img.id)}
                                                            onCheckedChange={() => toggleCustomerPhotoSelectionForDelete(img.id)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            {readOnly && isExisting && existingIndex !== -1 && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedCustomerPhotoIndices.includes(existingIndex)}
                                                            onCheckedChange={() => toggleCustomerPhotoSelection(existingIndex)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                // Fallback: hiển thị theo cách cũ nếu chưa có unified state
                                <>
                                    {existingCustomerPhotoUrls.map((url, index) => {
                                        const customerErrorKey = `customer-existing-${index}`;
                                        const customerToken = customerPhotoErrorTokens[customerErrorKey]
                                            ? customerPhotoErrorTokens[customerErrorKey].token
                                            : customerPhotoReloadToken;
                                        const displayUrl = buildCacheBustedUrl(url, customerToken);
                                        return (
                                            <div 
                                                key={`customer-photo-${index}`} 
                                                className="relative aspect-square group"
                                                {...(!readOnly ? { draggable: true } : {})}
                                                onDragStart={!readOnly ? (e) => handleCustomerPhotoDragStart(e, index) : undefined}
                                                onDragEnd={!readOnly ? handleCustomerPhotoDragEnd : undefined}
                                                onDragOver={!readOnly ? handleCustomerPhotoDragOver : undefined}
                                                onDrop={!readOnly ? (e) => handleCustomerPhotoDrop(e, index) : undefined}
                                                style={{ cursor: readOnly ? 'pointer' : 'move' }}
                                            >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {readOnly ? (
                                                <a href={displayUrl} target="_blank" rel="noopener noreferrer" download>
                                                    <img
                                                        src={displayUrl}
                                                        alt={`Ảnh khách hàng ${index + 1}`}
                                                        className="h-full w-full object-cover rounded-md border hover:opacity-90 cursor-pointer"
                                                        referrerPolicy="no-referrer"
                                                        onError={() => handleCustomerPhotoError(customerErrorKey)}
                                                    />
                                                </a>
                                            ) : (
                                                <img
                                                    src={displayUrl}
                                                    alt={`Ảnh khách hàng ${index + 1}`}
                                                    className="h-full w-full object-cover rounded-md border"
                                                    referrerPolicy="no-referrer"
                                                    onError={() => handleCustomerPhotoError(customerErrorKey)}
                                                />
                                            )}
                                            <Badge variant="secondary" className="absolute top-1 left-1 text-xs">Đã lưu</Badge>
                                            {readOnly && (
                                                <div className="absolute top-2 right-2 pointer-events-none">
                                                    <div className="pointer-events-auto" onClick={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={selectedCustomerPhotoIndices.includes(index)}
                                                            onCheckedChange={() => toggleCustomerPhotoSelection(index)}
                                                            className="border-2 border-white shadow-lg bg-white data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            </div>
                                        );
                                    })}
                                    {newCustomerPhotoPreviews.map((preview, index) => (
                                        <div key={`customer-photo-new-${index}`} className="relative aspect-square">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={preview.url} alt={`Xem trước ảnh ${index + 1}`} className="h-full w-full object-cover rounded-md border" />
                                            {!readOnly && onRemoveCustomerPhoto && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRemoveCustomerPhoto(index)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    aria-label="Xóa ảnh này"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <FormMessage />
                    </FormItem>
                )} />
            </form>
        </Form>
    );
}
