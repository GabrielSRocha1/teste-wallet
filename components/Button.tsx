import type { CSSProperties, DetailedHTMLProps, FC, ReactElement, ButtonHTMLAttributes } from 'react';
import React from 'react';

export interface ButtonProps extends DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
    startIcon?: ReactElement;
    endIcon?: ReactElement;
}

export const Button: FC<ButtonProps> = ({ children, startIcon, endIcon, onClick, className = '', ...props }) => {
    return (
        <button
            onClick={onClick}
            className={`wallet-adapter-button ${className}`}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(201,168,76,0.3)',
                backgroundColor: 'rgba(201,168,76,0.1)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                ...props.style
            }}
            {...props}
        >
            {startIcon && <i className="wallet-adapter-button-start-icon">{startIcon}</i>}
            {children}
            {endIcon && <i className="wallet-adapter-button-end-icon">{endIcon}</i>}
        </button>
    );
};
