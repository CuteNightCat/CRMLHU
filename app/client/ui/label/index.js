'use client';
import React, { useState, useEffect, useActionState, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createLabelAction, updateLabelAction, deleteLabelAction } from '@/app/actions/label.actions';
import AlertPopup from '@/components/(features)/(noti)/alert';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import CenterPopup from '@/components/(features)/(popup)/popup_center';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import { Svg_Add, Svg_Label } from '@/components/(icon)/svg';
import styles from './index.module.css';
import Title from '@/components/(features)/(popup)/title';
import { formatDate } from '@/function';

function SubmitButton({ text = 'Thực hiện' }) {
    const { pending } = useFormStatus();
    return (
        <button type="submit" disabled={pending} className='btn' style={{ transform: 'none', margin: 0 }}>
            {text}
        </button>
    );
}

function LabelForm({ formAction, formState, initialData = null, submitText }) {
    const [title, setTitle] = useState(initialData?.title || '');
    const [desc, setDesc] = useState(initialData?.desc || '');
    const [content, setContent] = useState(initialData?.content || '');
    useEffect(() => {
        if (formState.status === true && !initialData) {
            setTitle('');
            setDesc('');
            setContent('');
        }
    }, [formState, initialData]);
    useEffect(() => {
        setTitle(initialData?.title || '');
        setDesc(initialData?.desc || '');
        setContent(initialData?.content || '');
    }, [initialData]);
    return (
        <form action={formAction} className={styles.createForm}>
            {initialData?._id && <input type="hidden" name="id" value={initialData._id} />}
            <div className={styles.inputGroup}>
                <label htmlFor="title">Tên chiến dịch</label>
                <input
                    className='input' type="text" id="title" name="title"
                    placeholder="Ví dụ: Chiến dịch Marketing tháng 8"
                    required value={title} onChange={(e) => setTitle(e.target.value)}
                />
            </div>
            <div className={styles.inputGroup}>
                <label htmlFor="desc">Mô tả chiến dịch</label>
                <textarea
                    style={{ resize: 'none', height: 50 }} className='input' id="desc" name="desc"
                    rows={3} placeholder="Mô tả ngắn về chiến dịch này"
                    value={desc} onChange={(e) => setDesc(e.target.value)}
                />
            </div>
            <div className={styles.inputGroup}>
                <label htmlFor="content">Nội dung</label>
                <textarea
                    style={{ resize: 'vertical', height: 150 }} className='input' id="content" name="content"
                    rows={5} placeholder="Nội dung chi tiết cho chiến dịch (nếu có)"
                    value={content} onChange={(e) => setContent(e.target.value)}
                />
            </div>
            <SubmitButton text={submitText} />
        </form>
    );
}

export default function SettingLabel({ data }) {
    const router = useRouter();
    const [isListOpen, setIsListOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isUpdateOpen, setIsUpdateOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [itemToDelete, setItemToDelete] = useState(null);
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });
    const [createState, createAction, isCreatePending] = useActionState(createLabelAction, { message: null, status: null });
    const [updateState, updateAction, isUpdatePending] = useActionState(updateLabelAction, { message: null, status: null });
    const [deleteState, deleteAction, isDeletePending] = useActionState(deleteLabelAction, { message: null, status: null });
    const isActionPending = isCreatePending || isUpdatePending || isDeletePending;
    const handleActionComplete = useCallback((state, callback) => {
        if (state.message) {
            setNotification({ open: true, status: state.status, mes: state.message });
            if (state.status) {
                router.refresh();
                if (callback) callback();
            }
        }
    }, [router]);
    useEffect(() => { handleActionComplete(createState, () => setIsCreateOpen(false)) }, [createState, handleActionComplete]);
    useEffect(() => { handleActionComplete(updateState, () => setIsUpdateOpen(false)) }, [updateState, handleActionComplete]);
    useEffect(() => {
        handleActionComplete(deleteState, () => {
            setIsDeleteConfirmOpen(false);
            setIsUpdateOpen(false);
        })
    }, [deleteState, handleActionComplete]);
    const handleOpenUpdate = (item) => {
        setEditingItem(item);
        setIsUpdateOpen(true);
    };
    const handleOpenDeleteConfirm = (item) => {
        setItemToDelete(item);
        setIsDeleteConfirmOpen(true);
    };
    return (
        <>
            <button className='btn_s' onClick={() => setIsListOpen(true)}>
                <Svg_Label w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                <h5 className='text_w_400'>Chiến dịch</h5>
            </button>
            <FlexiblePopup open={isListOpen} onClose={() => setIsListOpen(false)} title="Cài đặt Chiến dịch" width={'600px'}
                renderItemList={() => (
                    <div className={styles.popupContentWrapper}>
                        <div className={styles.actionsHeader} style={{ paddingBottom: 8, borderBottom: 'thin solid var(--border-color)' }}>
                            <button className='btn_s' onClick={() => setIsCreateOpen(true)}>
                                <Svg_Add w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                                <h5 className='text_w_400'>Tạo chiến dịch mới</h5>
                            </button>
                        </div>
                        <div className={styles.itemsContainer} >
                            {data.map((item) => (
                                <div key={item._id} className={styles.item} onClick={() => handleOpenUpdate(item)}>
                                    <h5 style={{ textTransform: 'uppercase' }}>{item.title}</h5>
                                    <div style={{ display: 'flex', gap: 16 }}>
                                        <h6>Ngày tạo: {formatDate(new Date(item.createdAt)) || 'Không rõ'}</h6>
                                    </div>
                                    <h5 className="text_w_400">{item.desc}</h5>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            />
            <CenterPopup open={isCreateOpen} onClose={() => setIsCreateOpen(false)} size="md">
                <Title content="Tạo chiến dịch mới" click={() => setIsCreateOpen(false)} />
                <div className={styles.mainform}>
                    <LabelForm formAction={createAction} formState={createState} submitText="Tạo chiến dịch mới" />
                </div>
            </CenterPopup>
            <CenterPopup key={editingItem?._id || 'update'} open={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} size="md">
                {editingItem && (
                    <>
                        <Title content="Chỉnh sửa chiến dịch" click={() => setIsUpdateOpen(false)} />
                        <div className={styles.mainform}>
                            <LabelForm formAction={updateAction} formState={updateState} initialData={editingItem} submitText="Cập nhật" />
                            <button className='btn_s' style={{ width: '100%', marginTop: 8 }} onClick={() => handleOpenDeleteConfirm(editingItem)}>
                                <h5>Xóa chiến dịch này</h5>
                            </button>
                        </div>
                    </>
                )}
            </CenterPopup>
            <AlertPopup open={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)} title="Bạn có chắc chắn muốn xóa chiến dịch này?" type="warning" width={600}
                content={
                    itemToDelete && (
                        <h5>Hành động này sẽ xóa vĩnh viễn chiến dịch <strong>&quot;{itemToDelete.title}&quot;</strong>. Bạn sẽ không thể hoàn tác.</h5>
                    )
                }
                actions={
                    <form action={deleteAction} className={styles.deleteConfirmForm}>
                        <input type="hidden" name="id" value={itemToDelete?._id || ''} />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" style={{ whiteSpace: 'nowrap' }} onClick={() => setIsDeleteConfirmOpen(false)} className='btn_s'>
                                <h5>Quay lại</h5>
                            </button>
                            <SubmitButton text="Tiếp tục xóa" />
                        </div>
                    </form>
                }
            />
            <Noti open={notification.open} onClose={() => setNotification(p => ({ ...p, open: false }))} status={notification.status} mes={notification.mes} button={<button onClick={() => setNotification(p => ({ ...p, open: false }))} className="btn">Tắt thông báo</button>} />
            {isActionPending && (
                <div className='loadingOverlay' style={{ zIndex: 9999 }}>
                    <Loading content={<h5>Đang xử lý...</h5>} />
                </div>
            )}
        </>
    );
}