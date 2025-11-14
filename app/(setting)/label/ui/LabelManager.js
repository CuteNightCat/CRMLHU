'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';

// B1: Import các Server Actions thật sự
import { createLabel, updateLabel, deleteLabel } from '../actions';

// --- Helper: cn (Class Names) ---
const cn = (...classes) => classes.filter(Boolean).join(' ');

// --- Helper: Chuyển đổi màu HEX sang RGBA ---
const hexToRgba = (hex, alpha = 1) => {
    if (!hex.startsWith('#')) return 'rgba(0,0,0,0.1)';
    const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};


// --- UI Components (Không thay đổi) ---
const Button = ({ children, className, variant = 'default', size = 'default', ...props }) => {
    const base = "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 disabled:opacity-60 disabled:pointer-events-none";
    const variants = {
        default: "bg-gray-800 text-white hover:bg-gray-700 shadow-sm",
        destructive: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
        outline: "border border-gray-300 bg-transparent hover:bg-gray-100 text-gray-700",
        ghost: "hover:bg-gray-100 text-gray-600",
    };
    const sizes = {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        icon: "h-10 w-10",
    }
    return <button className={cn(base, variants[variant], sizes[size], className)} {...props}>{children}</button>;
};

const Input = ({ className, ...props }) => (
    <input className={cn("flex h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />
);

const AlertDialog = ({ open, onOpenChange, onConfirm, title, description }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-sm p-6 bg-white rounded-xl shadow-2xl m-4">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-gray-600">{description}</p>
                <div className="mt-6 flex justify-end space-x-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
                    <Button variant="destructive" onClick={() => { onConfirm(); onOpenChange(false); }}>Xóa</Button>
                </div>
            </div>
        </div>
    );
};


// --- Color Palette ---
const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#78716c'];

// --- Main Component ---
export default function LabelManager({ initialLabels = [] }) {
    const [labels, setLabels] = useState(initialLabels);
    const [selectedLabel, setSelectedLabel] = useState(null);
    const [deletingLabel, setDeletingLabel] = useState(null);
    const [labelName, setLabelName] = useState('');
    const [labelColor, setLabelColor] = useState(COLORS[0]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isPending, startTransition] = useTransition();

    const isEditing = !!selectedLabel;

    const filteredLabels = labels.filter(label =>
        label.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const resetForm = () => {
        setSelectedLabel(null);
        setLabelName('');
        setLabelColor(COLORS[0]);
    };

    const handleSelectLabel = (label) => {
        if (selectedLabel?._id === label._id) {
            resetForm();
        } else {
            setSelectedLabel(label);
            setLabelName(label.name);
            setLabelColor(label.color);
        }
    };

    // B2: Cập nhật hàm handleSubmit để xử lý lỗi từ server
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!labelName.trim()) {
            toast.error("Tên nhãn không được để trống.");
            return;
        }
        startTransition(async () => {
            const formData = new FormData();
            formData.append('name', labelName);
            formData.append('color', labelColor);

            let result;
            if (isEditing) {
                formData.append('id', selectedLabel._id);
                result = await updateLabel(formData);
            } else {
                result = await createLabel(formData);
            }

            if (result.success) {
                toast.success(`Nhãn đã được ${isEditing ? 'cập nhật' : 'tạo'}!`);
                // Logic cập nhật state không đổi
                setLabels(prev => isEditing ? prev.map(l => l._id === result.label._id ? result.label : l) : [result.label, ...prev]);
                resetForm();
            } else {
                // Hiển thị lỗi cụ thể trả về từ server action
                toast.error(result.error || "Đã có lỗi xảy ra.");
            }
        });
    };

    // B3: Cập nhật hàm handleDelete để xử lý lỗi từ server
    const handleDelete = () => {
        if (!deletingLabel) return;
        startTransition(async () => {
            // Server action deleteLabel chỉ cần id
            const result = await deleteLabel(deletingLabel._id);
            if (result.success) {
                toast.success("Đã xóa nhãn!");
                // Logic cập nhật state không đổi
                setLabels(prev => prev.filter(l => l._id !== deletingLabel._id));
                if (selectedLabel?._id === deletingLabel._id) {
                    resetForm();
                }
                setDeletingLabel(null);
            } else {
                // Hiển thị lỗi cụ thể trả về từ server action
                toast.error(result.error || "Xóa nhãn thất bại.");
            }
        });
    };

    return (
        <>
            <Toaster position="top-right" richColors />

            <main className="w-full h-full flex items-center justify-center">
                <div className="w-full h-full grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* Left Panel: Management (Không thay đổi) */}
                    <div className="flex flex-col bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="text-lg font-semibold">{isEditing ? 'Chỉnh sửa nhãn' : 'Tạo nhãn mới'}</h4>
                            {isEditing && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetForm}>
                                    <Plus className="h-4 w-4 transform rotate-45" />
                                    <span className="sr-only">Hủy và tạo nhãn mới</span>
                                </Button>
                            )}
                        </div>
                        <form onSubmit={handleSubmit} className="flex flex-col flex-grow space-y-5">
                            <div>
                                <label htmlFor="labelName" className="text-sm font-medium mb-1.5 block">Tên nhãn</label>
                                <Input id="labelName" placeholder="Nhập tên nhãn..." value={labelName} onChange={(e) => setLabelName(e.target.value)} disabled={isPending} />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Màu sắc</label>
                                <div className="grid grid-cols-6 gap-2">
                                    {COLORS.map(color => (
                                        <button key={color} type="button" onClick={() => setLabelColor(color)} style={{ backgroundColor: color }} className={cn("h-8 w-8 rounded-full transition-transform transform hover:scale-110 focus:outline-none", labelColor === color ? 'ring-2 ring-offset-2 ring-blue-500' : 'ring-1 ring-inset ring-black/10')} aria-label={`Select color ${color}`} />
                                    ))}
                                </div>
                            </div>
                            <div className="mt-auto pt-4 space-y-2">
                                <Button type="submit" className="w-full" disabled={isPending}>{isPending ? 'Đang lưu...' : (isEditing ? 'Lưu thay đổi' : 'Tạo nhãn')}</Button>
                                {isEditing && <Button type="button" variant="outline" className="w-full" onClick={() => setDeletingLabel(selectedLabel)} disabled={isPending}> <Trash2 className="mr-2 h-4 w-4" /> Xóa nhãn</Button>}
                            </div>
                        </form>
                    </div>

                    {/* Right Panel: Display (Không thay đổi) */}
                    <div className="md:col-span-2 bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
                        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-4">
                            <div className="relative w-full sm:w-auto sm:flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                <Input
                                    placeholder="Tìm kiếm nhãn..."
                                    className="pl-10"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Button onClick={resetForm} className="w-full sm:w-auto flex-shrink-0">
                                <Plus className="mr-2 h-4 w-4" />
                                Nhãn mới
                            </Button>
                        </div>

                        <h5 className="text-sm text-gray-500 " style={{ marginBottom: 5 }}>Có {filteredLabels.length} nhãn.</h5>

                        <div className="flex-grow overflow-y-auto -mr-3 pr-3">
                            {labels.length > 0 ? (
                                filteredLabels.length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                        {filteredLabels.map(label => {
                                            const isSelected = selectedLabel?._id === label._id;
                                            return (
                                                <button
                                                    key={label._id}
                                                    onClick={() => handleSelectLabel(label)}
                                                    style={{
                                                        backgroundColor: hexToRgba(label.color, isSelected ? 0.2 : 0.1),
                                                        color: label.color,
                                                        borderColor: isSelected ? label.color : hexToRgba(label.color, 0.5),
                                                    }}
                                                    className="font-medium border text-center px-3 py-2 rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                                >
                                                    <h5 style={{ color: 'inherit' }}> {label.name}</h5>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center text-gray-500 h-full flex items-center justify-center">
                                        <p>Không tìm thấy nhãn nào khớp.</p>
                                    </div>
                                )
                            ) : (
                                <div className="text-center text-gray-500 h-full flex items-center justify-center">
                                    <p>Chưa có nhãn nào. Hãy tạo một nhãn mới!</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            <AlertDialog open={!!deletingLabel} onOpenChange={(isOpen) => !isOpen && setDeletingLabel(null)} onConfirm={handleDelete} title="Xóa nhãn này?" description={`Hành động này sẽ xóa vĩnh viễn nhãn "${deletingLabel?.name}". Bạn không thể hoàn tác.`} />
        </>
    );
}