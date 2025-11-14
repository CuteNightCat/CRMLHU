// File: app/components/features/AddManualCustomer.jsx
'use client';

// ... (Giải thích và imports giữ nguyên)
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { UserPlus, Calendar as CalendarIcon, Loader2, AlertCircle } from 'lucide-react';
import useActionUI from '@/hooks/useActionUI';
import { addRegistrationToAction } from '@/app/actions/data.actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert"


// THAY ĐỔI 1: Schema vẫn giữ nguyên, Zod sẽ xác thực rằng có một chuỗi được chọn.
const formSchema = z.object({
    fullName: z.string().min(2, { message: 'Vui lòng nhập họ và tên.' }),
    phone: z.string().min(10, { message: 'Vui lòng nhập số điện thoại hợp lệ.' }),
    email: z.string().email({ message: 'Email không đúng định dạng.' }).optional().or(z.literal('')),
    address: z.string().optional(),
    service: z.string({ required_error: "Vui lòng chọn một ngành học." }).min(1, { message: 'Vui lòng chọn một ngành học.' }), // Cập nhật để bắt buộc chọn
    dob: z.date().optional(),
});

/**
 * Component chính để hiển thị nút và popup thêm khách hàng.
 * @param {{ service: Array<{_id: string, name: string}> }} props - Prop chứa danh sách các ngành học.
 */
export default function Customer_add({ service }) {
    const [isOpen, setIsOpen] = useState(false);
    const actionUI = useActionUI();

    const form = useForm({
        resolver: zodResolver(formSchema),
        mode: 'onChange',
        defaultValues: {
            fullName: '', phone: '', email: '', address: '', service: '', dob: undefined,
        },
    });

    const { errors, isSubmitting } = form.formState; // Lấy isSubmitting trực tiếp từ formState
    const errorMessages = Object.values(errors).map(error => error.message);

    const onSubmit = async (values) => {
        // THAY ĐỔI 2: Dữ liệu 'values' lúc này đã chứa ID của service,
        // nên chúng ta có thể gửi thẳng đi mà không cần chỉnh sửa.
        await actionUI.run(() => addRegistrationToAction(null, values), {
            loadingText: 'Đang lưu...',
            silentOnSuccess: false,
            refreshOnSuccess: true,
            onSuccess: () => {
                form.reset();
                setTimeout(() => setIsOpen(false), 1200);
            },
        });
    };

    const handlePointerDownOutside = (event) => {
        const target = event.target;
        if (target.closest('[data-action-ui-container]')) {
            event.preventDefault();
        }
    };

    return (
        <>
            <actionUI.UI />
            {isOpen && (
                <div className="fixed inset-0 z-40 bg-black/50" />
            )}
            <Dialog open={isOpen} onOpenChange={setIsOpen} modal={false}>
                <DialogTrigger asChild>
                    <button className='btn_s'>
                        <UserPlus className='h-4 w-4 mr-2' />
                        <h5 className='text_w_400'>Thêm khách lẻ</h5>
                    </button>
                </DialogTrigger>
                <DialogContent onPointerDownOutside={handlePointerDownOutside} className="sm:max-w-[480px] w-[95vw] sm:max-h-[95vh] rounded-lg scroll">
                    <DialogHeader>
                        <h4>Thêm khách hàng mới</h4>
                        <DialogTitle style={{ borderBottom: '1px dashed var(--border-color)' }}>
                            <VisuallyHidden>Thêm khách hàng mới</VisuallyHidden>
                        </DialogTitle>
                        <h6>Điền thông tin. Các trường có dấu * là bắt buộc.</h6>
                    </DialogHeader>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField control={form.control} name="fullName" render={({ field }) => (
                                    <FormItem><FormLabel><h5>Họ và Tên *</h5></FormLabel><FormControl><Input placeholder="Nguyễn Văn A" {...field} /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name="phone" render={({ field }) => (
                                    <FormItem><FormLabel><h5>Số điện thoại *</h5></FormLabel><FormControl><Input placeholder="09xxxxxxxx" {...field} /></FormControl></FormItem>
                                )} />
                            </div>

                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem><FormLabel><h5>Email</h5></FormLabel><FormControl><Input placeholder="example@email.com" {...field} /></FormControl></FormItem>
                            )} />

                            <FormField control={form.control} name="address" render={({ field }) => (
                                <FormItem><FormLabel><h5>Địa chỉ</h5></FormLabel><FormControl><Input placeholder="123 Đường ABC, Phường X, Quận Y" {...field} /></FormControl></FormItem>
                            )} />

                            <FormField control={form.control} name="service" render={({ field }) => (
                                <FormItem>
                                    <FormLabel><h5>Ngành học quan tâm *</h5></FormLabel>
                                    <Select className={'flex-1'} onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Chọn một ngành học" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {/* THAY ĐỔI 3: Gán `value` của mỗi `SelectItem` là `item._id` */}
                                            {service?.map((item) => (
                                                <SelectItem key={item._id} value={item._id}>
                                                    {item.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )} />

                            {errorMessages.length > 0 && (
                                <Alert variant="destructive" className="mt-4">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        <ul className="list-disc pl-5 space-y-1">
                                            {errorMessages.map((message, index) => (
                                                <li key={index}><h6>{message}</h6></li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            <DialogFooter style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 16 }}>
                                <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
                                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    <h6 style={{ color: 'white' }}>{isSubmitting ? 'Đang lưu' : 'Lưu thông tin'}</h6>
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}