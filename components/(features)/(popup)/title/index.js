import styles from './index.module.css'

export default function Title({ content, click }) {
    return (
        <div className={styles.header}>
            <h4>{content}</h4>
            <button className={styles.closeBtn} onClick={click}>&times;</button>
        </div>
    )
}