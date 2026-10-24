import React, { useState, useEffect } from 'react';
import { Search, Package, ShoppingCart, Users, Tag, Settings, FileText, ShieldAlert, X, Command } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  products: any[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onNavigate, products }) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Open
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredProducts = products.filter(p => p.title?.toLowerCase().includes(query.toLowerCase()));

  const navigationItems = [
    { name: 'Dashboard Overview', tab: 'dashboard', icon: Command },
    { name: 'Manage Products', tab: 'products', icon: Package },
    { name: 'Orders Management', tab: 'orders', icon: ShoppingCart },
    { name: 'Customers & Users', tab: 'customers', icon: Users },
    { name: 'Coupons & Discounts', tab: 'coupons', icon: Tag },
    { name: 'Downloads & Access', tab: 'downloads', icon: FileText },
    { name: 'Audit Logs & Security', tab: 'audit', icon: ShieldAlert },
    { name: 'Store Settings', tab: 'settings', icon: Settings },
  ].filter(item => item.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-5 h-5 text-slate-400 mr-3" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search products..."
            className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none text-sm"
          />
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {navigationItems.length > 0 && (
            <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Navigation</div>
          )}
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                onClick={() => { onNavigate(item.tab); onClose(); }}
                className="w-full flex items-center px-3 py-2.5 rounded-xl text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400 transition"
              >
                <Icon className="w-4 h-4 mr-3 text-slate-400" />
                {item.name}
              </button>
            );
          })}

          {filteredProducts.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Products</div>
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onNavigate('products'); onClose(); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <div className="flex items-center space-x-3">
                    <img src={p.image} alt={p.title} className="w-8 h-8 rounded-lg object-cover" />
                    <span className="font-medium truncate max-w-xs">{p.title}</span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">₹{p.price}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
