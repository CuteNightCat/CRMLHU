// app/components/services/ServiceEditorForm.client.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Headset, Upload, Plus, Trash2, Package, MessageSquare } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Helper function để tạo URL hiển thị ảnh từ nhiều định dạng input:
// - Nếu là URL trực tiếp (http, https) hoặc data URL -> dùng trực tiếp
// - Nếu là Google Drive fileId -> chuyển sang định dạng uc?export=view
const viewUrlFromId = (cover) => {
    if (!cover) return null;
    if (typeof cover === 'string' && (cover.startsWith('http') || cover.startsWith('data:'))) {
        return cover;
    }
    return `https://drive.google.com/uc?export=view&id=${cover}`;
};

// Cùng logic với bảng ngành học để đảm bảo đồng nhất cách build URL cover
const coverUrlOf = (cover) => {
    if (!cover) return null;
    if (typeof cover === 'string' && (cover.startsWith('http') || cover.startsWith('data:'))) {
        return cover;
    }
    return `https://drive.google.com/uc?export=view&id=${cover}`;
};

const TYPES = [
    { value: 'dai_hoc', label: 'Đại học' },
    { value: 'lien_thong', label: 'Liên thông' },
    { value: 'dao_tao_tu_xa', label: 'Đào tạo từ xa' },
    { value: 'duoc_si_chuyen_khoa_i', label: 'Dược sĩ chuyên khoa I' },
    { value: 'thac_si', label: 'Thạc sĩ' },
    { value: 'tien_si', label: 'Tiến sĩ' },
    { value: 'tu_xa', label: 'Từ xa' },
];

const SALE_GROUPS = [
    { value: 'telesale', label: 'Nhóm Telesale' },
    { value: 'care', label: 'Nhóm Care' },
];

const newEmptyCourse = () => ({
    name: '',
    description: '',
    costs: { basePrice: 0, otherFees: 0 },
});
const newEmptyMessage = () => ({ appliesToCourse: '', content: '' });
export default function ServiceEditorForm({ mode = 'create', initial, onSubmit }) {
    const [name, setName] = useState(initial?.name || '');
    const [type, setType] = useState(initial?.type || 'dai_hoc');
    const [saleGroup, setSaleGroup] = useState(initial?.saleGroup || '');
    const [defaultSale, setDefaultSale] = useState(initial?.defaultSale || '');
    const [description, setDescription] = useState(initial?.description || '');
    const [coverPreview, setCoverPreview] = useState(coverUrlOf(initial?.cover) || '');
    const [originalCover, setOriginalCover] = useState(initial?.cover || '');
    const [coverDataUrl, setCoverDataUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [courses, setCourses] = useState(initial?.treatmentCourses || []);
    const [preMessages, setPreMessages] = useState(initial?.preSurgeryMessages || []);

    const canSubmit = useMemo(() => name.trim().length > 0 && TYPES.some(t => t.value === type), [name, type]);

    const onPickFile = (file) => {
        if (!file) return;
        setUploading(true);
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result?.toString() || '';
            setCoverPreview(dataUrl);
            setOriginalCover(dataUrl);
            setCoverDataUrl(dataUrl);
            setUploading(false);
        };
        reader.readAsDataURL(file);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;

        const payload = {
            name,
            type,
            saleGroup: saleGroup || null,
            defaultSale: defaultSale || null,
            description,
            cover: coverDataUrl || initial?.cover || '',
            treatmentCourses: courses,
            preSurgeryMessages: preMessages,
        };
        await onSubmit?.(payload);
    };

    const courseNames = useMemo(() => courses.map(c => c.name).filter(Boolean), [courses]);

    return (
        <div className="max-h-[80vh] overflow-y-auto p-1 pr-4 custom-scrollbar">
            <form id="service-editor-form" onSubmit={submit} className="space-y-6">
                <Section title="Thông tin cơ bản">
                    <div className="rounded-[6px] border" style={{ borderColor: 'var(--border)' }}>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px]">
                            <div className="p-3">
                                <div
                                    className="relative rounded-[6px] overflow-hidden bg-[var(--surface-2)] border"
                                    style={{ borderColor: 'var(--border)' }}
                                >
                                    <div className="aspect-[16/9]">
                                        {coverPreview ? (
                                            <img
                                                src={coverPreview}
                                                alt="cover"
                                                className="h-full w-full object-cover"
                                                onError={(e) => {
                                                    // Thử URL format khác cho Google Drive nếu đang dùng fileId hoặc uc?export=view
                                                    if (typeof originalCover === 'string' && !originalCover.startsWith('data:')) {
                                                        const isId = !(originalCover.startsWith('http'));
                                                        const id = isId
                                                            ? originalCover
                                                            : (originalCover.match(/\/d\/([^/]+)/)?.[1] || originalCover.match(/id=([^&]+)/)?.[1]);
                                                        if (id) {
                                                            const altUrl = `https://lh3.googleusercontent.com/d/${id}`;
                                                            if (e.currentTarget.src !== altUrl) {
                                                                setCoverPreview(altUrl);
                                                            }
                                                        }
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center">
                                                <div
                                                    className="w-16 h-16 rounded-full flex items-center justify-center"
                                                    style={{ background: 'var(--primary-100)', border: '1px solid var(--border)' }}
                                                >
                                                    <Headset className="w-8 h-8 text-[var(--primary-700)]" />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 space-y-2">
                                <label className="text-xs font-medium text-[var(--muted)]">Ảnh nền</label>
                                <label
                                    className="flex items-center gap-2 rounded-[6px] border px-3 py-2 cursor-pointer hover:bg-[var(--primary-50)]"
                                    style={{ borderColor: 'var(--border)' }}
                                >
                                    <Upload className="w-4 h-4" />
                                    <span className="text-sm">{uploading ? 'Đang xử lý...' : 'Chọn ảnh'}</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => onPickFile(e.target.files?.[0])}
                                    />
                                </label>
                                <h6 className="text-xs text-[var(--muted)]">Định dạng .png, .jpg, .jpeg</h6>
                            </div>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 mt-5">
                        <FormRow label="Tên ngành học">
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="VD: Công nghệ thông tin"
                                required
                            />
                        </FormRow>
                        <FormRow label="Loại">
                            <select
                                className="w-full rounded-[6px] border px-3 py-2 outline-none focus:ring text-sm"
                                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                                value={type}
                                onChange={(e) => setType(e.target.value)}
                            >
                                {TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </FormRow>
                        <FormRow label="Nhóm phụ trách">
                            <Select value={saleGroup || 'none'} onValueChange={(v) => setSaleGroup(v === 'none' ? '' : v)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Chọn nhóm phụ trách" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Không chọn</SelectItem>
                                    {SALE_GROUPS.map((group) => (
                                        <SelectItem key={group.value} value={group.value}>
                                            {group.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormRow>
                        <FormRow label="Nhân sự phụ trách mặc định">
                            <Input
                                value={defaultSale}
                                onChange={(e) => setDefaultSale(e.target.value)}
                                placeholder="ID hoặc email người phụ trách (để trống nếu dùng round-robin)"
                            />
                        </FormRow>
                    </div>

                    <div className="space-y-1.5 mt-4">
                        <FormRow label="Mô tả">
                            <textarea
                                rows={4}
                                className="w-full rounded-[6px] border px-3 py-2 outline-none focus:ring text-sm"
                                style={{ borderColor: 'var(--border)', background: 'var(--surface)', resize: 'vertical' }}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Mô tả ngắn gọn về ngành học"
                            />
                        </FormRow>
                    </div>
                </Section>

                <Section title="Chương trình của ngành học & Chi phí" icon={<Package className="w-5 h-5" />}>
                    <TreatmentCoursesEditor courses={courses} setCourses={setCourses} />
                </Section>

                <Section title="Tin nhắn trước tuyển sinh" icon={<MessageSquare className="w-5 h-5" />}>
                    <MessagesEditor
                        messages={preMessages}
                        setMessages={setPreMessages}
                        courseNames={courseNames}
                    />
                </Section>
            </form>
        </div>
    );
}

// === CÁC COMPONENT CON HỖ TRỢ CHO FORM ===

const Section = ({ title, icon, children }) => (
    <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            {icon}
            {title}
        </h4>
        <div className="space-y-4 pt-2">{children}</div>
    </div>
);

const FormRow = ({ label, children }) => (
    <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted)]">{label}</label>
        {children}
    </div>
);

const Input = (props) => (
    <input
        className="w-full rounded-[6px] border px-3 py-2 outline-none focus:ring text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        {...props}
    />
);

function TreatmentCoursesEditor({ courses, setCourses }) {
    const addCourse = () => setCourses([...courses, newEmptyCourse()]);
    const removeCourse = (index) => setCourses(courses.filter((_, i) => i !== index));

    const handleUpdate = (index, field, value) => {
        const newCourses = JSON.parse(JSON.stringify(courses));
        const keys = field.split('.');
        if (keys.length === 2) {
            newCourses[index][keys[0]][keys[1]] = value;
        } else {
            newCourses[index][field] = value;
        }
        setCourses(newCourses);
    };

    return (
        <div className="space-y-4">
            {courses.map((course, index) => (
                <div key={index} className="rounded-[6px] border p-4 bg-[var(--surface-2)] relative" style={{ borderColor: 'var(--border)' }}>
                    <button type="button" onClick={() => removeCourse(index)} className="absolute top-2 right-2 p-1 hover:bg-red-100 rounded-full text-red-500">
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="grid md:grid-cols-2 gap-4">
                        <FormRow label="Tên chương trình">
                            <Input value={course.name} onChange={e => handleUpdate(index, 'name', e.target.value)} placeholder="VD: Chương trình chất lượng cao" />
                        </FormRow>
                        <FormRow label="Chi phí cơ bản (VND)">
                            <Input type="number" value={course.costs.basePrice} onChange={e => handleUpdate(index, 'costs.basePrice', Number(e.target.value))} />
                        </FormRow>
                        <FormRow label="Chi phí khác (VND)">
                            <Input type="number" value={course.costs.otherFees} onChange={e => handleUpdate(index, 'costs.otherFees', Number(e.target.value))} />
                        </FormRow>
                        <FormRow label="Mô tả chi phí khác">
                            <Input value={course.description} onChange={e => handleUpdate(index, 'description', e.target.value)} placeholder="Mô tả ngắn" />
                        </FormRow>
                    </div>
                </div>
            ))}
            <button
                type="button"
                onClick={addCourse}
                className="inline-flex items-center gap-2 cursor-pointer rounded-[6px] px-3 py-2 text-sm font-medium border hover:bg-[var(--primary-50)]"
                style={{ borderColor: 'var(--border)' }}
            >
                <Plus className="w-4 h-4" /> Thêm chương trình
            </button>
        </div>
    );
}

function MessagesEditor({ messages, setMessages, courseNames }) {
    const addMessage = () => {
        setMessages([...messages, newEmptyMessage()]);
    };

    const removeMessage = (index) => setMessages(messages.filter((_, i) => i !== index));

    const handleUpdate = (index, field, value) => {
        const newMessages = JSON.parse(JSON.stringify(messages));
        const keys = field.split('.');
        if (keys.length === 2) {
            newMessages[index][keys[0]][keys[1]] = value;
        } else {
            newMessages[index][field] = value;
        }
        setMessages(newMessages);
    };

    return (
        <div className="space-y-4">
            {messages.map((msg, index) => (
                <div key={index} className="rounded-[6px] border p-4 bg-[var(--surface-2)] relative" style={{ borderColor: 'var(--border)' }}>
                    <button type="button" onClick={() => removeMessage(index)} className="absolute top-2 right-2 p-1 hover:bg-red-100 rounded-full text-red-500">
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="space-y-3">
                        <FormRow label="Áp dụng cho chương trình">
                            <select
                                className="w-full rounded-[6px] border px-3 py-2 outline-none focus:ring text-sm"
                                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                                value={msg.appliesToCourse}
                                onChange={e => handleUpdate(index, 'appliesToCourse', e.target.value)}
                            >
                                <option value="">-- Chọn chương trình --</option>
                                {courseNames.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </FormRow>
                        <FormRow label="Nội dung tin nhắn">
                            <textarea
                                rows={4}
                                className="w-full rounded-[6px] border px-3 py-2 outline-none focus:ring text-sm"
                                style={{ borderColor: 'var(--border)', background: 'var(--surface)', resize: 'vertical' }}
                                value={msg.content}
                                onChange={e => handleUpdate(index, 'content', e.target.value)}
                                placeholder="Nhập nội dung tin nhắn..."
                            />
                        </FormRow>
                    </div>
                </div>
            ))}
            <button
                type="button"
                onClick={addMessage}
                className="inline-flex items-center gap-2 cursor-pointer rounded-[6px] px-3 py-2 text-sm font-medium border hover:bg-[var(--primary-50)]"
                style={{ borderColor: 'var(--border)' }}
            >
                <Plus className="w-4 h-4" /> Thêm tin nhắn
            </button>
        </div>
    );
}