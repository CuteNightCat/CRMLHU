import styles from './index.module.css'

export default function Loading({ content }) {
  return (
    <div className={styles.loadingContainer}>
      <div className={styles.spinner} />
      <div className='text_6'>{content}</div>
    </div>
  );
}
