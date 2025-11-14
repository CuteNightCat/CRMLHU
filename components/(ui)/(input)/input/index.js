import React, { forwardRef } from 'react';
import styles from './index.module.css';

const Input = forwardRef(function Input(
    { label, type = "text", placeholder, value, onChange, name, error, padding, ...props },
    ref
) {
    return (
        <div className={styles.inputContainer}>
            {label && (
                <label htmlFor={name} className={styles.label}>
                    {label}
                </label>
            )}
            <input
                ref={ref}
                type={type}
                name={name}
                style={{ padding: padding }}
                id={name}
                className={`${styles.input} ${error ? styles.errorInput : ''}`}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                {...props}
            />
            {error && <p className={styles.errorMessage}>{error}</p>}
        </div>
    );
});

export default Input;
