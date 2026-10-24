import React from 'react';
import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
export const Notice: React.FC<{ tone?: 'success' | 'error' | 'info'; children: React.ReactNode; className?: string }> = ({ tone = 'info', children, className = '' }) => { const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : Info; return <div className={`studio-notice studio-notice-${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={19} aria-hidden="true" /><div>{children}</div></div>; };
