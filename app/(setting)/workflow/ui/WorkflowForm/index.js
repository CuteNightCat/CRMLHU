'use client';

import React, { useState, useEffect } from 'react';

// === Import component từ shadcn/ui ===
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { PlusCircle, Pencil, Trash2, MessageSquare, UserPlus, CheckCircle2, Tag, ArrowRight } from 'lucide-react';
import { createWorkflow, updateWorkflow } from '@/data/workflow/wraperdata.db';

function formatDelay(ms) {
    const min = ms / 60000;
    if (min === 0) return 'Ngay lập tức';
    if (min >= 1440) return `${(min / 1440).toFixed(1)} ngày`;
    if (min >= 60) return `${(min / 60).toFixed(1)} giờ`;
    return `${min.toFixed(0)} phút`;
}

const actionIcons = {
    message: MessageSquare,
    friendRequest: UserPlus,
    checkFriend: CheckCircle2,
    tag: Tag,
};

const actionLabels = {
    message: 'Nhắn Tin',
    friendRequest: 'Kết Bạn',
    checkFriend: 'Kiểm Tra Kết Bạn',
    tag: 'Gắn Tag/Đổi Tên',
};

// --- Component con cho từng bước, với logic chỉnh sửa tại chỗ ---
const WorkflowStep = ({ step, index, onRemove, onUpdateDelay, onUpdateParam, isFixed }) => {
    const Icon = actionIcons[step.action] || ArrowRight;
    const [isEditing, setIsEditing] = useState(false);

    // State cục bộ để chỉnh sửa mà không ảnh hưởng ngay lập tức đến state cha
    const [editableDelay, setEditableDelay] = useState(step.delay / 60000);
    const [editableMessage, setEditableMessage] = useState(step?.params?.message || '');

    const handleSave = () => {
        if (!isFixed) {
            onUpdateDelay(index, editableDelay);
        }
        if (['message', 'tag'].includes(step.action)) {
            onUpdateParam(index, 'message', editableMessage);
        }
        setIsEditing(false);
    };

    const canEditMessage = ['message', 'tag'].includes(step.action);

    return (
        <Card className="transition-shadow duration-300 hover:shadow-lg">
            <div className="p-4 flex justify-between items-start gap-4">
                <div className="flex items-start gap-4 flex-grow">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-blue-600 flex-shrink-0">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div>
                        <h5 className="font-semibold capitalize text-gray-800">{actionLabels[step.action] || step.action.replace(/([A-Z])/g, ' $1')}</h5>
                        <h5 className="text-sm text-gray-500">Delay: {formatDelay(step.delay)}</h5>
                        {step?.params?.message &&
                            <h6 className="text-sm text-gray-600 mt-1 italic break-all">&quot;{step.params.message}&quot;</h6>}
                    </div>
                </div>
                {(!isFixed || canEditMessage) && (
                    <div className="flex gap-2 flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setIsEditing(!isEditing)}>
                            <Pencil className="h-4 w-4 text-gray-500" />
                        </Button>
                        {!isFixed && (
                            <Button variant="ghost" size="icon" onClick={() => onRemove(index)}>
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {isEditing && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="border-t p-4 space-y-4 bg-gray-50/50">
                            {!isFixed && (
                                <div className='grid grid-cols-2 gap-4'>
                                    <div>
                                        <Label>Delay (phút)</Label>
                                        <Input type="number" value={editableDelay} onChange={e => setEditableDelay(parseFloat(e.target.value) || 0)} />
                                    </div>
                                </div>
                            )}

                            {canEditMessage && (
                                <div>
                                    <Label>{step.action === 'tag' ? 'Tag/Tên' : 'Tin nhắn'}</Label>
                                    <Textarea value={editableMessage} onChange={e => setEditableMessage(e.target.value)} rows={3} />
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => setIsEditing(false)}>Hủy</Button>
                                <Button onClick={handleSave}>Lưu</Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
};


// Danh sách các bước pipeline (từ CustomerPipeline.js)
const PIPELINE_STAGES = [
    { id: 1, title: 'Tiếp nhận & Xử lý' },
    { id: 2, title: 'Nhắn tin xác nhận' },
    { id: 3, title: 'Phân bổ Telesale' },
    { id: 4, title: 'Telesale Tư vấn' },
    { id: 5, title: 'Nhắc lịch & Xác nhận vào học' },
    { id: 6, title: 'Chốt đăng ký vào học' }
];

// --- Component chính ---
export default function WorkflowForm({ workflow, forms, onSuccess, onCancel }) {
    // === Toàn bộ State và Effect được giữ nguyên ===
    const [name, setName] = useState('');
    const [steps, setSteps] = useState([]);
    const [newStep, setNewStep] = useState({ action: '', delay: 0, params: {} });
    const [delayUnit, setDelayUnit] = useState('minutes');
    const [workflowPosition, setWorkflowPosition] = useState(null); // Step cha được chọn
    const [isSubWorkflow, setIsSubWorkflow] = useState(false);
    const [autoWorkflow, setAutoWorkflow] = useState(false); // Workflow con tự động
    const [isSubmitting, setIsSubmitting] = useState(false); // Loading state
    const isFixed = workflow?.type === 'fixed';

    useEffect(() => {
        if (workflow) {
            setName(workflow.name);
            setSteps(workflow.steps);
            setWorkflowPosition(workflow.workflow_position || null);
            setIsSubWorkflow(workflow.isSubWorkflow || false);
            setAutoWorkflow(workflow.autoWorkflow || false);
        } else {
            setName('');
            setSteps([]);
            setNewStep({ action: '', delay: 0, params: {} });
            setWorkflowPosition(null);
            setIsSubWorkflow(false);
            setAutoWorkflow(false);
        }
    }, [workflow]);

    // === Toàn bộ các hàm xử lý logic được giữ nguyên ===
    const handleActionChange = (value) => setNewStep({ ...newStep, action: value, params: {} });
    const handleAddStep = () => {
        if (newStep.action) {
            let ms = (parseFloat(newStep.delay) || 0) * 60000;
            if (delayUnit === 'hours') ms *= 60;
            if (delayUnit === 'days') ms *= 1440;
            setSteps(prev => [...prev, { ...newStep, delay: ms }]);
            setNewStep({ action: '', delay: 0, params: {} });
            setDelayUnit('minutes');
        }
    };
    const handleRemoveStep = (index) => setSteps(prev => prev.filter((_, i) => i !== index));
    const handleUpdateParam = (index, key, value) => {
        setSteps(prev => prev.map((s, i) => i === index ? { ...s, params: { ...s.params, [key]: value } } : s));
    };
    const handleUpdateDelay = (index, value) => {
        const ms = value * 60000;
        setSteps(prev => prev.map((s, i) => i === index ? { ...s, delay: ms } : s));
    };
    const handleSubmit = async () => {
        // Tránh double submit
        if (isSubmitting) {
            // console.log('[WorkflowForm] Đang submit, bỏ qua...');
            return;
        }
        
        // Validation
        if (!name || name.trim() === '') {
            alert('Vui lòng nhập tên workflow');
            return;
        }
        
        if (steps.length === 0) {
            alert('Vui lòng thêm ít nhất một bước cho workflow');
            return;
        }
        
        // Nếu là workflow con thì phải chọn bước cha
        if (isSubWorkflow && !workflowPosition) {
            alert('Vui lòng chọn bước cha (Pipeline Step) cho workflow con');
            return;
        }
        
        setIsSubmitting(true);
        
        try {
            const formData = { 
                name: name.trim(), 
                steps,
                workflow_position: workflowPosition || null,
                isSubWorkflow: isSubWorkflow,
                autoWorkflow: autoWorkflow || false
            };
            
            // console.log('[WorkflowForm] Submitting formData:', formData);
            
            let result;
            if (workflow && workflow._id) {
                result = await updateWorkflow(workflow._id, formData);
            } else {
                formData.type = isFixed ? 'fixed' : 'custom';
                result = await createWorkflow(formData);
            }
            
            // console.log('[WorkflowForm] Submit result:', result);
            
            if (result.success) {
                onSuccess(formData);
            } else {
                alert(result.error || 'Có lỗi xảy ra khi lưu workflow');
            }
        } catch (error) {
            console.error('[WorkflowForm] Error submitting:', error);
            alert('Có lỗi xảy ra: ' + (error.message || error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const sortedSteps = [...steps].sort((a, b) => a.delay - b.delay);

    return (
        <>
            <DialogHeader className="p-4 border-b bg-white flex-shrink-0">
                <DialogTitle><p>{workflow ? 'Chỉnh Sửa' : 'Tạo'} Workflow {isFixed ? '(Cố Định)' : ''}</p></DialogTitle>
                <h5>Điền thông tin và thêm các bước để cấu hình luồng công việc của bạn.</h5>
            </DialogHeader>

            <main className="flex-1 scroll p-4 md:p-6 space-y-6" style={{ maxHeight: '60vh', display: 'flex', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: '35%' }}>
                    <Card>
                        <CardHeader><CardTitle>Thông tin cơ bản</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="workflow-name">Tên Workflow</Label>
                                <Input id="workflow-name" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            
                                    {!isFixed && (
                                <>
                                    <div>
                                        <Label>Loại Workflow</Label>
                                        <div className="flex flex-col space-y-2 mt-2">
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id="isSubWorkflow"
                                                    checked={isSubWorkflow}
                                                    onChange={(e) => {
                                                        setIsSubWorkflow(e.target.checked);
                                                        if (!e.target.checked) {
                                                            setWorkflowPosition(null);
                                                            setAutoWorkflow(false);
                                                        }
                                                    }}
                                                    className="w-4 h-4"
                                                />
                                                <Label htmlFor="isSubWorkflow" className="cursor-pointer">
                                                    Đây là Workflow con
                                                </Label>
                                            </div>
                                            
                                            {isSubWorkflow && (
                                                <div className="flex items-center space-x-2 ml-6">
                                                    <input
                                                        type="checkbox"
                                                        id="autoWorkflow"
                                                        checked={autoWorkflow}
                                                        onChange={(e) => setAutoWorkflow(e.target.checked)}
                                                        className="w-4 h-4"
                                                    />
                                                    <Label htmlFor="autoWorkflow" className="cursor-pointer text-sm">
                                                        Đây là workflow auto
                                                    </Label>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {isSubWorkflow && (
                                        <div>
                                            <Label htmlFor="workflow-position">Chọn bước cha (Pipeline Step)</Label>
                                            <Select 
                                                value={workflowPosition?.toString() || ''} 
                                                onValueChange={(value) => setWorkflowPosition(parseInt(value))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Chọn bước cha..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PIPELINE_STAGES.map((stage) => (
                                                        <SelectItem key={stage.id} value={stage.id.toString()}>
                                                            Bước {stage.id}: {stage.title}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {autoWorkflow 
                                                    ? "Workflow con auto sẽ chạy ngay khi bước cha hoàn thành"
                                                    : "Workflow con sẽ chạy sau khi bước này hoàn thành"}
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {!isFixed && (
                        <Card>
                            <CardHeader><CardTitle>Thêm bước mới</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label>Hành động</Label>
                                    <Select value={newStep.action} onValueChange={handleActionChange}>
                                        <SelectTrigger><SelectValue placeholder="Chọn một hành động..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="message">Nhắn Tin</SelectItem>
                                            <SelectItem value="friendRequest">Kết Bạn</SelectItem>
                                            <SelectItem value="checkFriend">Kiểm Tra Kết Bạn</SelectItem>
                                            <SelectItem value="tag">Gắn Tag/Đổi Tên</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Delay</Label>
                                        <Input type="number" value={newStep.delay} onChange={e => setNewStep({ ...newStep, delay: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                    <div>
                                        <Label>Đơn vị</Label>
                                        <Select value={delayUnit} onValueChange={setDelayUnit}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="minutes">Phút</SelectItem>
                                                <SelectItem value="hours">Giờ</SelectItem>
                                                <SelectItem value="days">Ngày</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                {['message', 'tag'].includes(newStep.action) && (
                                    <div>
                                        <Label>{newStep.action === 'tag' ? 'Tag/Tên' : 'Tin nhắn'}</Label>
                                        <Textarea value={newStep.params.message || ''} onChange={e => setNewStep({ ...newStep, params: { message: e.target.value } })} />
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter>
                                <Button className="w-full" onClick={handleAddStep}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Thêm Bước
                                </Button>
                            </CardFooter>
                        </Card>
                    )}
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }} className='scroll'>
                    <h6 className="font-semibold text-gray-700 mb-3">Các Bước Workflow:</h6>
                    {sortedSteps.length > 0 ? (
                        <div className="space-y-4">
                            {sortedSteps.map((step, index) => (
                                <WorkflowStep
                                    key={index}
                                    index={index}
                                    step={step}
                                    onRemove={handleRemoveStep}
                                    onUpdateDelay={handleUpdateDelay}
                                    onUpdateParam={handleUpdateParam}
                                    isFixed={isFixed}
                                />
                            ))}
                        </div>
                    ) : (<div className="text-center text-gray-500 border-2 border-dashed rounded-lg p-8 h-full flex flex-col justify-center items-center bg-white"><p>Chưa có bước nào.</p></div>)}
                </div>
            </main>

            <footer className="p-4 border-t bg-white flex justify-end gap-3 flex-shrink-0">
                <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>Hủy</Button>
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? 'Đang lưu...' : 'Lưu'}
                </Button>
            </footer>
        </>
    );
}