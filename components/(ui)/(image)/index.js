'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import styles from './index.module.css';
import WrapIcon from '@/components/(ui)/(button)/hoveIcon';
import { Svg_Delete, Svg_Pen, Svg_Download } from '@/components/(icon)/svg';
import Loading from '@/components/(ui)/(loading)/loading';
import Noti from '@/components/(features)/(noti)/noti';
import AlertPopup from '@/components/(features)/(noti)/alert';
import TextNoti from '@/components/(features)/(noti)/textnoti';
import { Re_lesson } from '@/data/course';
import Image from 'next/image';

const FileUploadModal = ({ isOpen, onClose, onFileSelect, imageId }) => {
    const fileInputRef = useRef(null);
    if (!isOpen) return null;

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            onFileSelect(file, imageId);
            onClose();
        }
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <h3 className={styles.modalTitle}>Chọn ảnh mới để thay thế</h3>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className={styles.fileInput}
                />
                <div className={styles.modalActions}>
                    <button onClick={onClose} className={styles.modalCancelButton}>
                        Hủy
                    </button>
                </div>
            </div>
        </div>
    );
};

const ImageComponent = ({ width, imageInfo, refreshData, width2 }) => {
    const imageSrc = `https://lh3.googleusercontent.com/d/${imageInfo.id}`;
    const videoThumbSrc = `https://drive.google.com/thumbnail?id=${imageInfo.id}`;
    const videoEmbedSrc = `https://drive.google.com/file/d/${imageInfo.id}/preview`;

    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingContent, setLoadingContent] = useState('');
    const [noti, setNoti] = useState({ open: false, status: false, mes: '', button: null });
    const [alertPopup, setAlertPopup] = useState({ open: false, title: '', content: '', type: 'warning', actions: null });

    const hiddenFileInput = useRef(null);

    const handleImageClick = useCallback(() => setIsPopupOpen(true), []);
    const handleClosePopup = useCallback(() => setIsPopupOpen(false), []);

    const showLoading = useCallback((content) => {
        setLoadingContent(content);
        setIsLoading(true);
    }, []);

    const hideLoading = useCallback(() => {
        setIsLoading(false);
        setLoadingContent('');
    }, []);

    const closeNoti = useCallback(() => {
        setNoti(prev => ({ ...prev, open: false }));
    }, []);

    const showNoti = useCallback((status, mes) => {
        setNoti({
            open: true,
            status: status,
            mes: mes,
            button: <div className='btn' style={{ background: 'var(--main_d)', width: 'calc(100% - 24px)', justifyContent: 'center' }} onClick={closeNoti}>Tắt thông báo</div>,
        });
    }, [closeNoti]);

    const closeAlertPopup = useCallback(() => {
        setAlertPopup(prev => ({ ...prev, open: false }));
    }, []);

    const showAlertPopup = useCallback((title, content, onConfirm) => {
        setAlertPopup({
            open: true,
            title: title,
            content: content,
            type: 'warning',
            actions: (
                <>
                    <div onClick={closeAlertPopup} style={{ background: 'gray', color: 'white' }} className='btn'>Hủy</div>
                    <div className='btn' style={{ background: 'var(--red)', color: 'white' }} onClick={() => { onConfirm(); closeAlertPopup(); }}>Xác nhận</div>
                </>
            ),
        });
    }, [closeAlertPopup]);

    const handleReplaceImage = useCallback(async (newImageFile, idToUpdate) => {
        showLoading('Đang cập nhật hình ảnh...');
        try {
            const formData = new FormData();
            formData.append('id', idToUpdate);
            formData.append('newImage', newImageFile);

            const response = await fetch('/api/image', { method: 'PUT', body: formData });
            const result = await response.json();

            result.data.forEach(element => Re_lesson(element));

            if (response.ok && result.status === 2) {
                showNoti(true, result.mes);
            } else {
                showNoti(false, result.mes);
            }
        } catch (error) {
            console.error('Lỗi khi gọi API PUT:', error);
            showNoti(false, 'Đã xảy ra lỗi khi cập nhật ảnh. Vui lòng thử lại.');
        } finally {
            await refreshData();
            hideLoading();
        }
    }, [refreshData, showLoading, hideLoading, showNoti]);

    const handleFileChangeForUpdate = useCallback(async (event) => {
        const file = event.target.files[0];
        if (file) {
            await handleReplaceImage(file, imageInfo.id);
            event.target.value = '';
        }
        handleClosePopup();
    }, [handleReplaceImage, imageInfo.id, handleClosePopup]);

    const handleEdit = useCallback(() => {
        hiddenFileInput.current?.click();
    }, []);

    const handleDelete = useCallback(() => {
        showAlertPopup(
            'Xác nhận xóa',
            <>
                <TextNoti mes='Việc xóa hình ảnh lớp học cũng sẽ đồng thời xóa hình ảnh này khỏi phần hình ảnh riêng cho các học sinh.' title='Xóa hình ảnh lớp học' color={'yellow'} />
                <p className='text_6_400' style={{ marginTop: 8 }}>Bạn có chắc chắn muốn xóa hình ảnh này không? Hành động này không thể hoàn tác.</p>
            </>,
            async () => {
                showLoading('Đang xóa hình ảnh...');
                try {
                    const response = await fetch(`/api/image?id=${imageInfo.id}`, { method: 'DELETE' });
                    const result = await response.json();

                    result.data.forEach(element => Re_lesson(element));

                    if (response.ok && result.status === 2) {
                        showNoti(true, result.mes);
                    } else {
                        showNoti(false, result.mes);
                    }
                } catch (error) {
                    console.error('Lỗi khi gọi API DELETE:', error);
                    showNoti(false, 'Đã xảy ra lỗi khi xóa ảnh. Vui lòng thử lại.');
                } finally {
                    await refreshData();
                    hideLoading();
                    handleClosePopup();
                }
            }
        );
    }, [imageInfo.id, refreshData, showAlertPopup, showLoading, hideLoading, showNoti, handleClosePopup]);

    const handleDownload = useCallback(() => {
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${imageInfo.id}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `file_${imageInfo.id}.${imageInfo.type === 'image' ? 'png' : imageInfo.type === 'video' ? 'mp4' : 'bin'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [imageInfo.id, imageInfo.type]);

    const containerStyle = useMemo(() => ({
        width: typeof width === 'number' ? `${width}px` : width,
        aspectRatio: '1 / 1',
        cursor: 'pointer'
    }), [width]);

    return (
        <>
            <div className={styles.imageContainer} style={containerStyle} onClick={handleImageClick}>
                {imageInfo.type === 'image' ? (
                    <Image
                        src={imageSrc}
                        alt={`Image ${imageInfo.id}`}
                        width={100}
                        height={100}
                        className={styles.image}
                        objectFit="cover"
                    />
                ) : imageInfo.type === 'video' ? (
                    <Image
                        src={videoThumbSrc}
                        alt={`Video thumbnail ${imageInfo.id}`}
                        width={100}
                        height={100}
                        className={styles.image}
                        objectFit="cover"
                    />
                ) : (
                    <div className={styles.filePlaceholder}>
                        File: {imageInfo.type} (ID: {imageInfo.id})
                    </div>
                )}
            </div>

            {isPopupOpen && (
                <div className={styles.popupOverlay} style={{ left: width ? `-${width2}px` : 0 }} onClick={handleClosePopup}>
                    <div className={imageInfo.type === 'image' ? styles.popupContent : styles.popupImages} onClick={(e) => e.stopPropagation()}>
                        {imageInfo.type === 'image' ? (
                            <Image
                                src={imageSrc}
                                alt={`Detail ${imageInfo.id}`}
                                width={100}
                                height={100}
                                className={styles.popupImage}
                                objectFit="cover"
                            />
                        ) : imageInfo.type === 'video' ? (
                            <iframe
                                src={videoEmbedSrc}
                                className={styles.popupImage}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                title={`Video ${imageInfo.id}`}
                            ></iframe>
                        ) : (
                            <div className={styles.popupFileContent}>
                                <h3>File: {imageInfo.type}</h3>
                                <p>ID: {imageInfo.id}</p>
                                <a href={videoEmbedSrc} target="_blank" rel="noopener noreferrer" className={styles.downloadLink}>Mở File</a>
                            </div>
                        )}

                        <div className={styles.popupActions}>
                            <WrapIcon icon={<Svg_Pen w={17} h={17} c="white" />} content={'Cập nhật'} placement={'right'} style={{ background: 'var(--yellow)', color: 'white', cursor: 'pointer' }} click={handleEdit} />
                            <WrapIcon icon={<Svg_Delete w={16} h={16} c="white" />} content={'Xóa'} placement={'right'} style={{ background: 'var(--red)', color: 'white', cursor: 'pointer' }} click={handleDelete} />
                            {(imageInfo.type === 'image' || imageInfo.type === 'video') && (
                                <WrapIcon icon={<Svg_Download w={16} h={16} c="white" />} content={'Tải xuống'} placement={'right'} style={{ background: 'var(--green)', color: 'white', cursor: 'pointer' }} click={handleDownload} />
                            )}
                        </div>
                        <button className={styles.closeButton} onClick={handleClosePopup}>×</button>
                    </div>
                </div>
            )}

            <input type="file" ref={hiddenFileInput} onChange={handleFileChangeForUpdate} accept="image/*" style={{ display: 'none' }} />

            {isLoading && (
                <div className={styles.fullscreenOverlay}>
                    <Loading content={loadingContent} />
                </div>
            )}

            <Noti open={noti.open} onClose={closeNoti} status={noti.status} mes={noti.mes} button={noti.button} />

            <AlertPopup open={alertPopup.open} onClose={closeAlertPopup} title={alertPopup.title} content={alertPopup.content} type={alertPopup.type} actions={alertPopup.actions} />
        </>
    );
};

export default ImageComponent;