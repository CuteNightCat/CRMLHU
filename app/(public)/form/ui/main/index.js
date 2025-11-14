"use client";

import { useEffect, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import styles from './index.module.css';
import { addRegistrationToAction } from '@/app/actions/data.actions';

const INITIAL_ACTION_STATE = { message: null, type: null };

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" className={styles.button} disabled={pending}>{pending ? 'Đang xử lý...' : 'Đăng ký ngay'}</button>;
}

export default function RegistrationForm({ id, service }) {
    const [state, formAction] = useActionState(addRegistrationToAction, INITIAL_ACTION_STATE);
    const formRef = useRef(null);

    const allPossibleFields = {
        1: { id: 'name', name: 'name', label: 'Họ và tên', type: 'text', required: true },
        2: { id: 'address', name: 'address', label: 'Địa chỉ', type: 'text', required: true },
        3: { id: 'phone', name: 'phone', label: 'Số điện thoại liên lạc', type: 'tel', required: true, note: 'Lưu ý: Vui lòng sử dụng SĐT có đăng ký Zalo để nhận thông tin.' },
        4: { id: 'email', name: 'email', label: 'Email', type: 'email', required: false },
        5: { id: 'bd', name: 'bd', label: 'Ngày sinh', type: 'date', required: false },
        6: { id: 'service', name: 'service', label: 'Ngành học quan tâm', type: 'select', required: true, options: service },
    };

    useEffect(() => {
        if (state.type === 'success') {
            formRef.current?.reset();
        }
        // Không reset khi type === 'error', giữ nguyên giá trị input
    }, [state.type]);

    const fieldsToRender = id?.formInput || [];

    return (
        <div className={styles.container}>
            <div className={styles.banner}></div>
            <div className={styles.header}>
                <h1 className={styles.title}>{id?.name || 'Đăng ký khóa học'}</h1>
                <p className={styles.subtitle}>{id?.describe || 'Khai phá tiềm năng và chuẩn bị cho tương lai ngay từ hôm nay!'}</p>
            </div>
            <form ref={formRef} action={formAction} className={styles.form}>
                <input type="hidden" name="source" value={id?._id} />
                <input type="hidden" name="sourceName" value={id?.name} />
                {fieldsToRender.map((fieldId) => {
                    const field = allPossibleFields[fieldId];
                    if (!field) return null;
                    if (field.type === 'select') {
                        return (
                            <div key={field.id} className={styles.formGroup}>
                                <label htmlFor={field.id} className={styles.label}>
                                    {field.label} {field.required && <span>*</span>}
                                </label>
                                <select id={field.id} name={field.name} className={styles.input} required={field.required} defaultValue="">
                                    <option value="" disabled>-- Chọn {field.label.toLowerCase()} --</option>
                                    {field.options.map((option) => (
                                        <option key={option._id || option} value={option._id}>{option.name}</option>
                                    ))}
                                </select>
                            </div>
                        );
                    }
                    return (
                        <div key={field.id} className={styles.formGroup}>
                            <label htmlFor={field.id} className={styles.label}>
                                {field.label} {field.required && <span>*</span>}
                            </label>
                            <input type={field.type} id={field.id} name={field.name} className={styles.input} required={field.required} />
                            {field.note && <p className={styles.note}>{field.note}</p>}
                        </div>
                    );
                })}
                <SubmitButton />
                {state.message && (
                    <div className={`${styles.message} ${state.ok === true ? styles.success : styles.error}`}>
                        <h5 style={{ color: 'inherit' }}>{state.message}</h5>
                    </div>
                )}
            </form>
        </div>
    );
}