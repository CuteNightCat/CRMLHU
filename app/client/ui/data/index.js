'use client';

import React, { useState, useEffect, useActionState, useMemo, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
// Bỏ syncCustomersFromSheetAction ra khỏi import
import { createAreaAction, updateAreaAction, deleteAreaAction } from '@/app/actions/data.actions';
import AlertPopup from '@/components/(features)/(noti)/alert';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import CenterPopup from '@/components/(features)/(popup)/popup_center';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import { Svg_Add, Svg_Data, Svg_Area, Svg_Delete, Svg_Coppy } from '@/components/(icon)/svg'; // Bỏ Svg_Download
import styles from './index.module.css';
import Title from '@/components/(features)/(popup)/title';
import WrapIcon from '@/components/(ui)/(button)/hoveIcon';
import { formatDate } from '@/function';
import { revalidateData } from '@/app/actions/customer.actions';
import Customer_add from './addcustomer';

function SubmitButton({ text = 'Thực hiện' }) {
    const { pending } = useFormStatus();
    return (
        <button type="submit" disabled={pending} className='btn' style={{ transform: 'none', margin: 0 }}>
            {pending ? 'Đang xử lý...' : text}
        </button>
    );
}

// Component chọn trường hiển thị
const fieldOptions = [
    { id: 1, label: 'Họ và Tên' },
    { id: 2, label: 'Địa chỉ' },
    { id: 3, label: 'Số điện thoại' },
    { id: 4, label: 'Email' },
    { id: 5, label: 'Ngày sinh' },
    { id: 6, label: 'Ngành học quan tâm' },
];

function FieldSelector({ selectedFields, setSelectedFields }) {
    const handleToggleField = (fieldId) => {
        setSelectedFields(prev =>
            prev.includes(fieldId) ? prev.filter(id => id !== fieldId) : [...prev, fieldId]
        );
    };

    return (
        <div className={styles.inputGroup}>
            <label>Các trường hiển thị trên form</label>
            <div className={styles.fieldSelector}>
                {fieldOptions.map(field => (
                    <button
                        key={field.id}
                        type="button"
                        className={`${styles.fieldButton} ${selectedFields.includes(field.id) ? styles.selected : ''}`}
                        onClick={() => handleToggleField(field.id)}
                    >
                        {field.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function AreaForm({ formAction, formState, initialData = null, submitText }) {
    const [name, setName] = useState('');
    const [describe, setDescribe] = useState('');
    const defaultFields = useMemo(() => [1, 2, 3, 4, 5, 6], []);
    const [selectedFields, setSelectedFields] = useState(defaultFields);

    useEffect(() => {
        if (formState.status === true && !initialData) {
            setName('');
            setDescribe('');
            setSelectedFields(defaultFields);
        }
    }, [formState, initialData]);

    useEffect(() => {
        setName(initialData?.name || '');
        setDescribe(initialData?.describe || '');
        setSelectedFields(
            initialData?.formInput && initialData.formInput.length > 0
                ? initialData.formInput
                : defaultFields
        );
    }, [initialData, defaultFields]);

    return (
        <form action={formAction} className={styles.createForm}>
            {initialData?._id && <input type="hidden" name="id" value={initialData._id} />}

            {selectedFields.map(fieldId => (
                <input type="hidden" name="formInput" key={fieldId} value={fieldId} />
            ))}

            <div className={styles.inputGroup}>
                <label htmlFor="name">Tên nguồn</label>
                <input
                    className='input'
                    type="text"
                    id="name"
                    name="name"
                    placeholder="Ví dụ: Dữ liệu Marketing"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
            <div className={styles.inputGroup}>
                <label htmlFor="describe">Mô tả nguồn nhận dữ liệu</label>
                <textarea
                    style={{ resize: 'none', height: 100 }}
                    className='input'
                    id="describe"
                    name="describe"
                    rows={3}
                    placeholder="Mô tả ngắn về nguồn dữ liệu này"
                    value={describe}
                    onChange={(e) => setDescribe(e.target.value)}
                />
            </div>

            <FieldSelector selectedFields={selectedFields} setSelectedFields={setSelectedFields} />

            <SubmitButton text={submitText} />
        </form>
    );
}

export default function SettingData({ data, service, customer }) {
    const router = useRouter();
    const [isRightPopupOpen, setIsRightPopupOpen] = useState(false);
    const [isCreatePopupOpen, setIsCreatePopupOpen] = useState(false);
    const [isUpdatePopupOpen, setIsUpdatePopupOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [itemToDelete, setItemToDelete] = useState(null);
    const [copyStatus, setCopyStatus] = useState('idle');
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });

    const [createState, createAction, isCreatePending] = useActionState(createAreaAction, { message: null, status: null });
    const [updateState, updateAction, isUpdatePending] = useActionState(updateAreaAction, { message: null, status: null });
    const [deleteState, deleteAction, isDeletePending] = useActionState(deleteAreaAction, { message: null, status: null });
    // Bỏ useActionState cho sync action
    // const [syncState, syncAction, isSyncPending] = useActionState(syncCustomersFromSheetAction, { message: null, status: null });

    // First, wrap handleActionComplete in useCallback to prevent it from changing on every render
    const handleActionComplete = useCallback((state, callback) => {
        if (state.message) {
            setNotification({ open: true, status: state.status, mes: state.message });
            if (state.status) {
                router.refresh();
                if (callback) callback();
            }
        }
    }, [router]);

    useEffect(() => handleActionComplete(createState, () => setIsCreatePopupOpen(false)), [createState]);
    useEffect(() => {
        handleActionComplete(updateState, () => {
            if (updateState.status) {
                setIsUpdatePopupOpen(false);
                setEditingItem(null);
            }
        });
    }, [updateState, handleActionComplete]);
    useEffect(() => {
        handleActionComplete(deleteState, () => {
            setIsDeleteConfirmOpen(false);
            if (deleteState.status) {
                setIsUpdatePopupOpen(false);
                setItemToDelete(null);
            }
        });
    }, [deleteState, handleActionComplete]);
    // Bỏ useEffect cho sync state
    // useEffect(() => handleActionComplete(syncState, null), [syncState]);

    const handleOpenUpdatePopup = (item) => {
        setEditingItem(item);
        setIsUpdatePopupOpen(true);
    };

    const handleOpenDeleteConfirm = (item) => {
        setItemToDelete(item);
        setIsDeleteConfirmOpen(true);
    };

    const handleCloseDeleteConfirm = () => setIsDeleteConfirmOpen(false);
    const handleCloseNoti = () => setNotification(prev => ({ ...prev, open: false }));

    const handleCopyToClipboard = async (textToCopy) => {
        if (!navigator.clipboard) {
            setCopyStatus('error');
            setTimeout(() => setCopyStatus('idle'), 2000);
            return;
        }
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopyStatus('copied');
        } catch (err) {
            setCopyStatus('error');
        } finally {
            setTimeout(() => setCopyStatus('idle'), 2000);
        }
    };

    return (
        <>
            <button className='btn_s' onClick={() => setIsRightPopupOpen(true)}>
                <Svg_Data w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                <h5 className='text_w_400'>Dữ liệu</h5>
            </button>

            <FlexiblePopup
                globalZIndex={9}
                open={isRightPopupOpen}
                onClose={() => setIsRightPopupOpen(false)}
                title="Cài đặt nguồn dữ liệu"
                width={'600px'}
                renderItemList={() => (
                    <div className={styles.popupContentWrapper}>
                        <div className={styles.actionsHeader}>
                            <button className='btn_s' onClick={() => setIsCreatePopupOpen(true)}>
                                <Svg_Add w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                                <h5 className='text_w_400'>Tạo Form mới</h5>
                            </button>
                            <Customer_add service={service} />
                        </div>
                        <div className={styles.wraplistForms}>
                            <div className={styles.title}>
                                <Svg_Area w={'var(--font-size-xs)'} h={'var(--font-size-xs)'} c={'var(--text-primary)'} />
                                <h4>Danh sách sự kiện - nguồn dữ liệu</h4>
                            </div>
                            <div className={styles.itemsContainer}>
                                {data.map((item) => {
                                    let sum = customer.filter(c => c.source?._id === item._id).length
                                    return (
                                        <div key={item._id} className={styles.item} onClick={() => handleOpenUpdatePopup(item)}>
                                            <h5 style={{ textTransform: 'uppercase' }}>{item.name}</h5>
                                            <div style={{ display: 'flex', gap: 16 }}>
                                                <h6>Ngày tạo: {formatDate(new Date(item.createdAt)) || 'Không rõ'}</h6>
                                                <h6>Được tạo bởi: {item.createdBy?.name || 'Không rõ'}</h6>
                                                <h6>Số khách hàng: {sum}</h6>
                                            </div>
                                            <h5 className="text_w_400">{item.describe}</h5>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
            />

            <CenterPopup open={isCreatePopupOpen} onClose={() => setIsCreatePopupOpen(false)} size="md">
                <Title content="Tạo Form mới" click={() => setIsCreatePopupOpen(false)} />
                <div className={styles.mainform}>
                    <AreaForm
                        formAction={createAction}
                        formState={createState}
                        submitText="Tạo form mới"
                    />
                </div>
            </CenterPopup>

            <CenterPopup
                key={editingItem?._id || 'update-popup'}
                open={isUpdatePopupOpen}
                onClose={() => { setIsUpdatePopupOpen(false) }}
                size="md"
            >
                {editingItem && (
                    <>
                        <Title content="Chỉnh sửa Form" click={() => { setIsUpdatePopupOpen(false) }} />
                        <div className={styles.mainform}>
                            <div className={styles.inputGroup}>
                                <h5>Đường dẫn tới form</h5>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderRadius: 3, border: ' thin solid var(--border-color)', alignItems: 'center', padding: 3, paddingLeft: 8 }}>
                                    <h5> {`http://116.118.50.179:4200/form?id=${editingItem._id}`}</h5>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <WrapIcon
                                            icon={<Svg_Coppy w={'var(--font-size-base)'} h={'var(--font-size-base)'} c={'var(--text-primary)'} />}
                                            click={() => handleCopyToClipboard(`http://116.118.50.179:4200/form?id=${editingItem._id}`)}
                                            className='mainIcon'
                                            content={copyStatus === 'copied' ? 'Đã sao chép!' : copyStatus === 'error' ? 'Sao chép lỗi!' : 'Sao chép đường dẫn'}
                                        />
                                        <WrapIcon
                                            icon={<Svg_Delete w={'var(--font-size-base)'} h={'var(--font-size-base)'} c={'white'} />}
                                            click={() => handleOpenDeleteConfirm(editingItem)}
                                            className='deleteIcon'
                                            content="Xóa form này"
                                        />
                                    </div>
                                </div>
                            </div>
                            <AreaForm
                                formAction={updateAction}
                                formState={updateState}
                                initialData={editingItem}
                                submitText="Cập nhật"
                            />
                        </div>
                    </>
                )}
            </CenterPopup>

            <AlertPopup
                open={isDeleteConfirmOpen}
                onClose={handleCloseDeleteConfirm}
                title="Bạn có chắc chắn muốn xóa form này?"
                type="warning"
                width={600}
                content={
                    itemToDelete && (
                        <h5>
                            Hành động này sẽ xóa vĩnh viễn form <strong>&quot;{itemToDelete.name}&quot;</strong>.
                            Bạn sẽ không thể hoàn tác hành động này.
                        </h5>
                    )
                }
                actions={
                    <form action={deleteAction}>
                        <input type="hidden" name="id" value={itemToDelete?._id || ''} />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" style={{ whiteSpace: 'nowrap' }} onClick={handleCloseDeleteConfirm} className='btn_s'>
                                <h5>Quay lại</h5>
                            </button>
                            <SubmitButton text="Tiếp tục xóa" />
                        </div>
                    </form>
                }
            />

            {/* Bỏ isSyncPending khỏi điều kiện loading */}
            {(isCreatePending || isUpdatePending || isDeletePending) && (
                <div className='loadingOverlay'>
                    <Loading content={<h5>Đang xử lý...</h5>} />
                </div>
            )}

            <Noti
                open={notification.open}
                onClose={handleCloseNoti}
                status={notification.status}
                mes={notification.mes}
                button={<button onClick={handleCloseNoti} className="btn" style={{ width: '100%' }}>Tắt thông báo</button>}
            />
        </>
    );
}