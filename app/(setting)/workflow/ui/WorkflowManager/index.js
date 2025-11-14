'use client';

import React, { useState, useEffect } from 'react';

// Components
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import WorkflowForm from '../WorkflowForm';
import { workflow_data, reloadWorkflow, deleteWorkflow } from '@/data/workflow/wraperdata.db';
// Utils & Icons
import { formatDelay } from '@/function/index';
import { Pencil, Plus, Eye, MessageSquare, UserPlus, CheckCircle2, FolderSearch, Tag, ArrowRight, Trash2, Bell, UserRoundCog } from 'lucide-react';

const actionDetails = {
    message: { icon: MessageSquare, name: "Gửi Tin Nhắn", color: "bg-blue-100 text-blue-700" },
    friendRequest: { icon: UserPlus, name: "Gửi Kết Bạn", color: "bg-green-100 text-green-700" },
    checkFriend: { icon: CheckCircle2, name: "Kiểm Tra Bạn Bè", color: "bg-yellow-100 text-yellow-700" },
    tag: { icon: Tag, name: "Gắn Thẻ", color: "bg-purple-100 text-purple-700" },
    allocation: { icon: UserRoundCog, name: "Phân bổ", color: "bg-yellow-100 text-yellow-700" },
    bell: { icon: Bell, name: "Thông báo", color: "bg-purple-100 text-purple-700" },
    findUid: { icon: FolderSearch, name: "Tìm Uid", color: "bg-purple-100 text-purple-700" },
};

const WorkflowViewer = ({ workflow }) => {
    if (!workflow) return null;
    return (
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle></DialogTitle>
                <h4>Xem Luồng Công Việc: {workflow.name}</h4>
            </DialogHeader>
            <div className="p-4 overflow-hidden overflow-x-auto">
                <div className="flex items-center gap-4">
                    {workflow.steps.sort((a, b) => a.delay - b.delay).map((step, index) => {
                        const details = actionDetails[step.action] || { icon: ArrowRight, name: step.action, color: "bg-gray-100 text-gray-700" };
                        const Icon = details.icon;
                        return (
                            <React.Fragment key={index}>
                                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                                    <div className={`w-20 h-20 rounded-lg flex items-center justify-center ${details.color}`}>
                                        <Icon className="h-8 w-8" />
                                    </div>
                                    <h4 className="font-semibold text-center w-32 text-sm">{details.name}</h4>
                                    <h5 className="text-xs text-gray-500">{formatDelay(step.delay)}</h5>
                                </div>
                                {index < workflow.steps.length - 1 && (
                                    <div className="flex-shrink-0 text-gray-300">
                                        <ArrowRight className="h-10 w-10" />
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </DialogContent>
    );
};

export default function WorkflowManager({ initialWorkflows, forms }) {
    const [workflows, setWorkflows] = useState(initialWorkflows || []);
    const [selectedWorkflow, setSelectedWorkflow] = useState(null);
    const [filter, setFilter] = useState('all');
    const [isFormOpen, setFormOpen] = useState(false);
    const [isViewerOpen, setViewerOpen] = useState(false);

    useEffect(() => {
        async function fetchFiltered() {
            const filtered = await workflow_data(null, filter);
            setWorkflows(filtered);
        }
        fetchFiltered();
    }, [filter]);

    const handleSuccess = async () => {
        await reloadWorkflow();
        const updatedData = await workflow_data(null, filter);
        setWorkflows(updatedData);
        setFormOpen(false);
    };

    const handleDelete = async (id) => {
        await deleteWorkflow(id);
        await handleSuccess();
    };

    const handleOpenForm = (workflow = null) => {
        setSelectedWorkflow(workflow);
        setFormOpen(true);
    };
    const handleOpenViewer = (workflow) => {
        setSelectedWorkflow(workflow);
        setViewerOpen(true);
    };

    return (
        <div className="">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
                <div>
                    <p className='text_w_600'>Quản lý Workflow</p>
                    <h4>Tạo, chỉnh sửa và quản lý các luồng công việc.</h4>
                </div>
                <div className='flex items-center gap-2'>
                    {/* <Tabs value={filter} onValueChange={(value) => value && setFilter(value)}>
                        <TabsList>
                            <TabsTrigger value="all">Tất cả</TabsTrigger>
                            <TabsTrigger value="fixed">Cố định</TabsTrigger>
                            <TabsTrigger value="custom">Tùy biến</TabsTrigger>
                        </TabsList>
                    </Tabs> */}
                    <Button onClick={() => handleOpenForm()}><Plus className="mr-2 h-4 w-4" /> Tạo Mới</Button>
                </div>
            </header>
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead className="w-2/5">Tên</TableHead>
                            <TableHead>Loại</TableHead>
                            <TableHead>Số Bước</TableHead>
                            <TableHead className="text-right">Hành Động</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {workflows.map(workflow => (
                                <TableRow key={workflow._id}>
                                    <TableCell className="font-medium">{workflow.name}</TableCell>
                                    <TableCell>{workflow.type}</TableCell>
                                    <TableCell>{workflow.steps.length}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="outline" size="icon" onClick={() => handleOpenViewer(workflow)}><Eye className="h-4 w-4" /></Button>
                                            <Button variant="outline" size="icon" onClick={() => handleOpenForm(workflow)}><Pencil className="h-4 w-4" /></Button>
                                            {workflow.type === 'custom' && (
                                                <Button variant="outline" size="icon" onClick={() => handleDelete(workflow._id)}><Trash2 className="h-4 w-4" /></Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isFormOpen} onOpenChange={setFormOpen}>
                <DialogContent className="w-full sm:max-w-[1200px] p-0">
                    <DialogTitle></DialogTitle>
                    <WorkflowForm workflow={selectedWorkflow} forms={forms} onSuccess={handleSuccess} onCancel={() => setFormOpen(false)} />
                </DialogContent>
            </Dialog>

            <Dialog open={isViewerOpen} onOpenChange={setViewerOpen}>
                <WorkflowViewer workflow={selectedWorkflow} />
            </Dialog>
        </div>
    );
}