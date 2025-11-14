import styles from './index.module.css';

export default function WrapIcon({
    icon,
    content,
    placement = 'top',
    style = {},
    click,
    className = ''
}) {
    const tooltipClass = `${styles.tooltip} ${styles[placement]}`;

    return (

        <div className={styles.wrapIcon} onClick={click}>
            <div className={`wrapicon ${className}`} style={style}>
                {icon}
            </div>
            <span className={tooltipClass}>{content}</span>
        </div>
    );
}
