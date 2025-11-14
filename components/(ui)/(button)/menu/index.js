import React, { useState, useRef, useEffect, cloneElement } from 'react';
import air from './index.module.css';



export default function Menu({
    buttonContent,
    menuItems,
    menuPosition = 'bottom',
    isOpen: controlledIsOpen,
    onOpenChange,
    customButton,
    style
}) {
    if(style && typeof style !== 'object') {
        style = {};
    }

    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const isControlled = controlledIsOpen !== undefined;
    const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
    const toggleMenu = () => {

        if (isControlled) {

            onOpenChange && onOpenChange(!controlledIsOpen);

        } else {

            setInternalIsOpen(prev => !prev);

        }

    };



    const containerRef = useRef(null);

    useEffect(() => {

        const handleClickOutside = (event) => {

            if (containerRef.current && !containerRef.current.contains(event.target)) {

                if (isControlled) {

                    onOpenChange && onOpenChange(false);

                } else {

                    setInternalIsOpen(false);

                }

            }

        };



        document.addEventListener('mousedown', handleClickOutside);

        return () => document.removeEventListener('mousedown', handleClickOutside);

    }, [isControlled, onOpenChange]);



    const menuPositionClass = {

        bottom: air.menuBottom,

        top: air.menuTop,

        left: air.menuLeft,

        right: air.menuRight,

    }[menuPosition];



    const renderButton = customButton

        ? cloneElement(customButton, {

            onClick: (e) => {

                customButton.props.onClick && customButton.props.onClick(e);

                toggleMenu();

            }

        })

        : (

            <button className={air.menuButton} onClick={toggleMenu}>

                {buttonContent}

            </button>

        );



    return (

        <div className={air.menuButtonContainer} ref={containerRef} style={style}>

            {renderButton}

            <div className={`${air.menu} ${menuPositionClass} ${isOpen ? air.active : ''}`}>

                {menuItems}

            </div>

        </div>

    );

}