// app/components/ResponsiveGrid/ResponsiveGrid.jsx

"use client";

import React, { useState } from 'react';
import styles from './index.module.css';

const ResponsiveGrid = ({ items = [], columns, type = 'grid', style = {}, width }) => {
    const [isPopupOpen, setPopupOpen] = useState(false);
    const isListMode = type === 'list';
    const maxItemsOnList = columns.desktop;

    const shouldShowMoreButton = isListMode && items.length > maxItemsOnList;
    const itemsToRender = shouldShowMoreButton
        ? items.slice(0, maxItemsOnList - 1)
        : items;

    const hiddenItemsCount = items.length - (maxItemsOnList - 1);
    const gridStyles = {
        '--mobile-cols': columns.mobile,
        '--tablet-cols': columns.tablet,
        '--desktop-cols': columns.desktop,
    };
    const handleOpenPopup = () => setPopupOpen(true);
    const handleClosePopup = () => setPopupOpen(false);
    return (
        <>
            <div className={styles.gridContainer} style={gridStyles}>
                {itemsToRender.map((item, index) => (
                    <div key={`grid-item-${index}`} className={styles.gridItem}>
                        {item}
                    </div>
                ))}
                {shouldShowMoreButton && (
                    <div className={styles.showMore} onClick={handleOpenPopup}>
                        <div className={styles.showMoreContent}>
                            +{hiddenItemsCount}
                            <span>Xem thêm</span>
                        </div>
                    </div>
                )}
            </div >
            {isPopupOpen && (
                <div className={styles.popupOverlay} style={{ left: width ? `-${width}px` : '0' }} onClick={handleClosePopup}>
                    <div className={styles.popupContent} onClick={(e) => e.stopPropagation()}>
                        <div style={{ width: '100%', height: '100%', overflow: 'hidden', overflowY: 'auto' }}>
                            <div className={styles.gridContainer} style={gridStyles}>
                                {items.map((item, index) => (
                                    <div key={`popup-item-${index}`} className={styles.gridItem}>
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )
            }
        </>
    );
};

export default ResponsiveGrid;