import React from 'react';
import { type LucideIcon, Search, ShoppingCart, Heart, FileQuestion, ArrowRight, PackageOpen } from 'lucide-react';
import { useApp } from '../context/AppContext';
import '../styles/content.css';
interface EmptyStateProps {
  type?: 'search' | 'cart' | 'wishlist' | 'orders' | 'generic';
  title: string; description: string; actionText?: string; actionPath?: string; onAction?: () => void; customIcon?: LucideIcon;
}
export const EmptyState: React.FC<EmptyStateProps> = ({ type = 'generic', title, description, actionText = 'Explore the collection', actionPath = '/products', onAction, customIcon }) => {
  const { navigate } = useApp();
  const icons = { search: Search, cart: ShoppingCart, wishlist: Heart, orders: PackageOpen, generic: FileQuestion };
  const Icon = customIcon || icons[type];
  return <div className="content-empty-state"><div className="content-empty-icon"><Icon size={30} strokeWidth={1.5} aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p><button type="button" onClick={() => onAction ? onAction() : actionPath && navigate(actionPath)} className="content-button">{actionText}<ArrowRight size={17} /></button></div>;
};
