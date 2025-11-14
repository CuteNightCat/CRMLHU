'use client';
import React, { useState, useEffect, useActionState, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createVariantAction, updateVariantAction } from '@/app/actions/variant.actions';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import CenterPopup from '@/components/(features)/(popup)/popup_center';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import { Svg_Add, Svg_Variant } from '@/components/(icon)/svg';
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
function VariantForm({ formAction, formState, initialData = null, submitText }) {
    const [name, setName] = useState(initialData?.name || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [phrases, setPhrases] = useState(initialData?.phrases?.join('\n') || '');
    useEffect(() => {
        if (formState.status === true && !initialData) {
            setName('');
            setDescription('');
            setPhrases('');
        }
    }, [formState, initialData]);
    useEffect(() => {
        setName(initialData?.name || '');
        setDescription(initialData?.description || '');
        setPhrases(initialData?.phrases?.join('\n') || '');
    }, [initialData]);
    return (
        <form action={formAction} className={styles.createForm}>
            {initialData?._id && <input type="hidden" name="id" value={initialData._id} />}
            <div className={styles.inputGroup}>
                <label htmlFor="name">Tên biến thể</label>
                <input className='input' type="text" id="name" name="name" placeholder="Ví dụ: Lời chào hỏi" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className={styles.inputGroup}>
                <label htmlFor="description">Mô tả biến thể</label>
                <textarea style={{ resize: 'none', height: 50 }} className='input' id="description" name="description" rows={3} placeholder="Mô tả ngắn về mục đích của biến thể này" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className={styles.inputGroup}>
                <label htmlFor="phrases">Các cụm từ (mỗi cụm từ một dòng)</label>
                <textarea style={{ resize: 'vertical', height: 150 }} className='input' id="phrases" name="phrases" rows={5} placeholder={'Ví dụ:\nXin chào\nChào bạn\nHello'} value={phrases} onChange={(e) => setPhrases(e.target.value)} />
            </div>
            <SubmitButton text={submitText} />
        </form>
    );
}
export default function SettingVariant({ data }) {
    const router = useRouter();
    const [isListOpen, setIsListOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isUpdateOpen, setIsUpdateOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });
    const [createState, createAction] = useActionState(createVariantAction, { message: null, status: null });
    const [updateState, updateAction] = useActionState(updateVariantAction, { message: null, status: null });
    const isActionPending = createState.pending || updateState.pending;
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
    const handleOpenUpdate = (item) => {
        setEditingItem(item);
        setIsUpdateOpen(true);
    };
    return (
        <>
            <button className='btn_s' onClick={() => setIsListOpen(true)}>
                <Svg_Variant w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                <h5 className='text_w_400'>Biến thể</h5>
            </button>
            <FlexiblePopup open={isListOpen} onClose={() => setIsListOpen(false)} title="Cài đặt Biến thể" width={'600px'}
                renderItemList={() => (
                    <div className={styles.popupContentWrapper}>
                        <div className={styles.actionsHeader} style={{ paddingBottom: 8, borderBottom: 'thin solid var(--border-color)' }}>
                            <button className='btn_s' onClick={() => setIsCreateOpen(true)}>
                                <Svg_Add w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                                <h5 className='text_w_400'>Tạo biến thể mới</h5>
                            </button>
                        </div>
                        <div className={styles.itemsContainer} >
                            {data.map((item) => (
                                <div key={item._id} className={styles.item} onClick={() => handleOpenUpdate(item)}>
                                    <h5 style={{ textTransform: 'uppercase' }}>{item.name}</h5>
                                    <div style={{ display: 'flex', gap: 16 }}>
                                        <h6>Ngày tạo: {formatDate(new Date(item.createdAt)) || 'Không rõ'}</h6>
                                    </div>
                                    <h5 className="text_w_400">{item.description}</h5>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            />
            <CenterPopup open={isCreateOpen} onClose={() => setIsCreateOpen(false)} size="md">
                <Title content="Tạo biến thể mới" click={() => setIsCreateOpen(false)} />
                <div className={styles.mainform}>
                    <VariantForm formAction={createAction} formState={createState} submitText="Tạo biến thể" />
                </div>
            </CenterPopup>
            <CenterPopup key={editingItem?._id || 'update'} open={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} size="md">
                {editingItem && (
                    <>
                        <Title content="Chỉnh sửa biến thể" click={() => setIsUpdateOpen(false)} />
                        <div className={styles.mainform}>
                            <VariantForm formAction={updateAction} formState={updateState} initialData={editingItem} submitText="Cập nhật" />
                        </div>
                    </>
                )}
            </CenterPopup>
            <Noti open={notification.open} onClose={() => setNotification(p => ({ ...p, open: false }))} status={notification.status} mes={notification.mes} />
            {isActionPending && (
                <div className='loadingOverlay' style={{ zIndex: 9999 }}>
                    <Loading content={<h5>Đang xử lý...</h5>} />
                </div>
            )}
        </>
    );
}