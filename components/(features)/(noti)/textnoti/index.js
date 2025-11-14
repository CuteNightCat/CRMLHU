import { colorText_noti } from '@/data/style/color';
import styles from './index.module.css';

export default function TextNoti({ mes, title, color }) {
    color = colorText_noti({ key: color ? color : 'default' });

    return (
        <div className={styles.scheduleBox} style={{ borderColor: color.color, background: color.background }}>
            <p className='text_4' style={{ color: color.color, marginBottom: 4 }}>{title}</p>
            <div className='text_6_400' style={{ color: color.color }}>  {mes}  </div>
        </div>
    )
}