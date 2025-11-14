'use client';
import React, { useState, useEffect, useActionState, useMemo, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { updateZaloRolesAction, addZaloAccountAction, deleteZaloAccountAction } from '@/app/actions/zalo.actions';
import FlexiblePopup from '@/components/(features)/(popup)/popup_right';
import CenterPopup from '@/components/(features)/(popup)/popup_center';
import Noti from '@/components/(features)/(noti)/noti';
import Loading from '@/components/(ui)/(loading)/loading';
import Menu from '@/components/(ui)/(button)/menu';
import Title from '@/components/(features)/(popup)/title';
import { Svg_Add, Svg_Delete, Svg_Mode } from '@/components/(icon)/svg';
import styles from './index.module.css';
import Image from 'next/image';
function RoleSubmitButton({ text = 'Lưu thay đổi' }) {
    const { pending } = useFormStatus();
    return (<button type="submit" disabled={pending} className='btn'><h5>{pending ? 'Đang lưu...' : text}</h5></button>);
}
function AddAccountSubmitButton({ text = 'Thêm tài khoản' }) {
    const { pending } = useFormStatus();
    return (<button type="submit" disabled={pending} className='btn' style={{ transform: 'none', margin: 0, width: '100%' }}>{pending ? 'Đang xử lý...' : text}</button>);
}
function TokenForm({ formAction, formState }) {
    const [token, setToken] = useState('');
    useEffect(() => { if (formState.status === true) setToken(''); }, [formState]);
    return (
        <form action={formAction} className={styles.createForm}>
            <div className={styles.inputGroup}>
                <label htmlFor="token">Zalo Access Token</label>
                <textarea className='input' id="token" name="token" placeholder="Dán Access Token của bạn vào đây" required value={token} style={{ height: 250, resize: 'none', width: 'calc(100% - 24px)' }} onChange={(e) => setToken(e.target.value)} />
            </div>
            <AddAccountSubmitButton />
        </form>
    );
}
function RoleManager({ zaloAccount, allUsers, formAction, deleteAction, onClose, onDeleteComplete }) {
    const [assignedUserIds, setAssignedUserIds] = useState(() => new Set(zaloAccount.roles?.map(role => role._id) || []));
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const availableUsers = useMemo(() => allUsers.filter(user => !assignedUserIds.has(user._id)), [allUsers, assignedUserIds]);
    const assignedUsers = useMemo(() => allUsers.filter(user => assignedUserIds.has(user._id)), [allUsers, assignedUserIds]);
    const handleAddUser = (user) => {
        setAssignedUserIds(prev => new Set(prev).add(user._id));
        setIsMenuOpen(false);
    };
    const handleRemoveUser = (userId) => {
        setAssignedUserIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(userId);
            return newSet;
        });
    };
    return (
        <>
            <form action={formAction} className={styles.roleManagerForm}>
                <input type="hidden" name="zaloAccountId" value={zaloAccount._id} />
                <input type="hidden" name="userIds" value={JSON.stringify(Array.from(assignedUserIds))} />
                <Title content={`Phân quyền cho ${zaloAccount.name}`} click={onClose} />
                <div className={`${styles.assignedUsersList} scroll`}>
                    <h6>Người dùng được cấp quyền:</h6>
                    {assignedUsers.length > 0 ? (
                        assignedUsers.map(user => (
                            <div key={user._id} className={styles.assignedUserItem}>
                                <div className={styles.userInfo}>
                                    <Image src={user.avt || 'https://lh3.googleusercontent.com/d/1iq7y8VE0OyFIiHmpnV_ueunNsTeHK1bG'} alt={user.name} width={40} height={40} className={styles.userAvatar} />
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <h5>{user.name}</h5>
                                        <h6 className="text_sm">{user.phone || 'Chưa có SĐT'}</h6>
                                    </div>
                                </div>
                                <button type="button" onClick={() => handleRemoveUser(user._id)} className={styles.removeButton}>
                                    <Svg_Delete w='16' h='16' c='var(--text-secondary)' />
                                </button>
                            </div>
                        ))
                    ) : <p className={styles.noUserText}>Chưa có người dùng nào được cấp quyền.</p>}
                </div>
                <div className={styles.formActions}>
                    <Menu isOpen={isMenuOpen} onOpenChange={setIsMenuOpen} customButton={<button type="button" className='btn_s'><Svg_Add w='14' h='14' c='var(--text-primary)' /><h5>Thêm người dùng</h5></button>} menuItems={<div className={`${styles.menulist} scroll`}>{availableUsers.length > 0 ? availableUsers.map(user => (<h5 key={user._id} onClick={() => handleAddUser(user)}>{user.name}</h5>)) : <p className={styles.noUserText}>Đã gán hết người dùng</p>}</div>} menuPosition="top" />
                    <RoleSubmitButton />
                </div>
            </form>
            
            <div style={{ marginTop: '16px', padding: '16px', borderTop: '1px solid var(--border)' }}>
                <button 
                    type="button" 
                    onClick={() => setShowDeleteConfirm(true)}
                    className='btn_s' 
                    style={{ width: '100%', background: 'var(--destructive)', color: 'white' }}
                >
                    <Svg_Delete w='14' h='14' c='white' />
                    <h5>Xóa tài khoản này</h5>
                </button>
            </div>
            
            {showDeleteConfirm && (
                <form action={deleteAction}>
                    <input type="hidden" name="zaloAccountId" value={zaloAccount._id} />
                    <div style={{ padding: '16px', background: 'var(--destructive/10)', borderRadius: '8px', marginTop: '16px' }}>
                        <h6 style={{ marginBottom: '8px', color: 'var(--destructive)' }}>Xác nhận xóa?</h6>
                        <p style={{ fontSize: '14px', marginBottom: '16px' }}>
                            Bạn có chắc chắn muốn xóa tài khoản "{zaloAccount.name}"? Hành động này không thể hoàn tác.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                                type="submit" 
                                className='btn' 
                                style={{ flex: 1, background: 'var(--destructive)', color: 'white' }}
                            >
                                <h5>Xóa</h5>
                            </button>
                            <button 
                                type="button" 
                                onClick={() => setShowDeleteConfirm(false)}
                                className='btn' 
                                style={{ flex: 1 }}
                            >
                                <h5>Hủy</h5>
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </>
    );
}
export default function SettingZaloRoles({ data, allUsers = [] }) {
    const router = useRouter();
    const [isListOpen, setIsListOpen] = useState(false);
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedZalo, setSelectedZalo] = useState(null);
    const [notification, setNotification] = useState({ open: false, status: true, mes: '' });
    const [updateState, updateAction, isUpdatePending] = useActionState(updateZaloRolesAction, { message: null, status: null });
    const [addState, addAction, isAddPending] = useActionState(addZaloAccountAction, { message: null, status: null });
    const [deleteState, deleteAction, isDeletePending] = useActionState(deleteZaloAccountAction, { message: null, status: null });
    const handleActionComplete = useCallback((state, callback) => {
        if (state.message) {
            setNotification({ open: true, status: state.status, mes: state.message });
            if (state.status) {
                router.refresh();
                if (callback) callback();
            }
        }
    }, [router]);
    useEffect(() => { handleActionComplete(updateState, () => { if (updateState.status) { setIsManagerOpen(false); setSelectedZalo(null); } }); }, [updateState, handleActionComplete]);
    useEffect(() => { handleActionComplete(addState, () => { if (addState.status) setIsCreateOpen(false); }); }, [addState, handleActionComplete]);
    useEffect(() => { handleActionComplete(deleteState, () => { if (deleteState.status) { setIsManagerOpen(false); setSelectedZalo(null); setIsListOpen(false); } }); }, [deleteState, handleActionComplete]);
    const handleOpenManager = (zaloAccount) => {
        const populatedRoles = zaloAccount.roles?.map(roleId => allUsers.find(u => u._id === roleId)).filter(Boolean) || [];
        setSelectedZalo({ ...zaloAccount, roles: populatedRoles });
        setIsManagerOpen(true);
    };
    const handleCloseNoti = () => setNotification(p => ({ ...p, open: false }));
    return (
        <>
            <button className='btn_s' onClick={() => setIsListOpen(true)}>
                <Svg_Mode w={'var(--font-size-sm)'} h={'var(--font-size-sm)'} c={'var(--text-primary)'} />
                <h5 className='text_w_400'>Quản lý Zalo</h5>
            </button>
            <FlexiblePopup open={isListOpen} onClose={() => setIsListOpen(false)} title="Danh sách tài khoản Zalo" width={'500px'}
                renderItemList={() => (
                    <div className={`${styles.popupContentWrapper} scroll`}>
                        {data.map((item) => (
                            <div key={item._id} className={styles.item} onClick={() => handleOpenManager(item)}>
                                <Image src={item.avt} alt={item.name} width={40} height={40} className={styles.zaloAvatar} />
                                <div className={styles.zaloInfo}>
                                    <h5>{item.name}</h5>
                                    <p>{item.phone}</p>
                                </div>
                            </div>
                        ))}
                        <div className={styles.item} style={{}} onClick={() => setIsCreateOpen(true)}>
                            <div className={styles.addIconWrapper} style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background-secondary)', borderRadius: '50%' }}>
                                <Svg_Add w={'var(--font-size-base)'} h={'var(--font-size-base)'} c={'var(--text-primary)'} />
                            </div>
                            <div className={styles.zaloInfo}>
                                <h5>Thêm tài khoản Zalo mới</h5>
                            </div>
                        </div>
                    </div>
                )}
            />
            <CenterPopup key={selectedZalo?._id || 'manager'} open={isManagerOpen} onClose={() => setIsManagerOpen(false)}>
                {selectedZalo && (<RoleManager zaloAccount={selectedZalo} allUsers={allUsers} formAction={updateAction} deleteAction={deleteAction} onClose={() => setIsManagerOpen(false)} />)}
            </CenterPopup>
            <CenterPopup open={isCreateOpen} onClose={() => setIsCreateOpen(false)} size="md">
                <Title content="Thêm tài khoản & cập nhập Zalo" click={() => setIsCreateOpen(false)} />
                <div className={styles.mainform}>
                    <TokenForm formAction={addAction} formState={addState} />
                </div>
            </CenterPopup>
            <Noti open={notification.open} onClose={handleCloseNoti} status={notification.status} mes={notification.mes} />
            {(isUpdatePending || isAddPending || isDeletePending) && (<div className='loadingOverlay' style={{ zIndex: 9999 }}><Loading content={<h5>Đang xử lý...</h5>} /></div>)}
        </>
    );
}