'use client';

import { useState, useEffect } from 'react';
import styles from './index.module.css';

export default function Switch({
  checked,
  onChange,
  size = 'medium',
  activeColor = '#4caf50',
  inactiveColor = '#ccc',
}) {
  // Sử dụng state nội bộ nếu không phải controlled component
  const [internalChecked, setInternalChecked] = useState(checked !== undefined ? checked : false);

  // Nếu là controlled, cập nhật state khi prop checked thay đổi
  useEffect(() => {
    if (checked !== undefined) {
      setInternalChecked(checked);
    }
  }, [checked]);

  const handleToggle = () => {
    const newChecked = !internalChecked;
    if (onChange) onChange(newChecked);
    if (checked === undefined) {
      setInternalChecked(newChecked);
    }
  };

  // Tính toán kích thước dựa theo prop size
  let switchWidth, switchHeight, circleSize;
  if (typeof size === 'number') {
    switchWidth = size * 2;
    switchHeight = size;
    circleSize = size - 2;
  } else {
    switch (size) {
      case 'small':
        switchWidth = 32;
        switchHeight = 16;
        circleSize = 12.5;
        break;
      case 'large':
        switchWidth = 80;
        switchHeight = 40;
        circleSize = 36;
        break;
      case 'medium':
      default:
        switchWidth = 60;
        switchHeight = 30;
        circleSize = 26;
        break;
    }
  }

  // Style cho container switch (các giá trị động)
  const containerStyle = {
    width: switchWidth,
    height: switchHeight,
    backgroundColor: internalChecked ? activeColor : inactiveColor,
  };

  // Style cho nút chuyển (circle)
  const circleStyle = {
    width: circleSize,
    height: circleSize,
    top: (switchHeight - circleSize) / 2,
    left: internalChecked ? switchWidth - circleSize - 2 : 2,
  };

  return (
    <div className={styles.container} style={containerStyle} onClick={handleToggle}>
      <div className={styles.circle} style={circleStyle} />
    </div>
  );
}
