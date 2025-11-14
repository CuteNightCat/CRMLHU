import React from 'react';
import air from './index.module.css';

export default function AnimatedButton({
  children,
  onClick,
  padding = '10px 20px',
  background = '#1677ff',
  hoverColor = '#4096ff',
  border = 'null',
  borderRadius = '8px',
  disabled = false,
}) {
  return (
    <button
      className={air.animatedButton}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding,
        backgroundColor: background,
        '--hover-color': hoverColor,
        border: border,
        borderRadius: borderRadius
      }}
    >
      {children}
    </button>
  );
}
