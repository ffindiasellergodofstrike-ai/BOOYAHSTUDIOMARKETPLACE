import React from 'react';
import { Spinner } from './Spinner';
interface AsyncButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { busy?: boolean; busyLabel?: string; }
export const AsyncButton: React.FC<AsyncButtonProps> = ({ busy = false, busyLabel, disabled, children, className = 'btn-primary', ...props }) => <button {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`btn ${className}`}>{busy && <Spinner />}<span>{busy && busyLabel ? busyLabel : children}</span></button>;
