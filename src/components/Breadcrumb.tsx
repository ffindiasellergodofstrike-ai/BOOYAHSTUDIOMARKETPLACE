import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import '../styles/content.css';
export interface BreadcrumbItem { label: string; path?: string; params?: Record<string, string>; search?: Record<string, string>; }
interface BreadcrumbProps { items: BreadcrumbItem[]; className?: string; }
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className = '' }) => {
  const { navigate } = useApp();
  return <nav aria-label="Breadcrumb" className={'content-breadcrumb ' + className}><ol><li><button type="button" onClick={() => navigate('/')}>Home</button></li>{items.map((item, index) => <li key={item.path || item.label}><ChevronRight size={13} aria-hidden="true" />{index === items.length - 1 || !item.path ? <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span> : <button type="button" onClick={() => navigate(item.path!, item.params, item.search)}>{item.label}</button>}</li>)}</ol></nav>;
};
