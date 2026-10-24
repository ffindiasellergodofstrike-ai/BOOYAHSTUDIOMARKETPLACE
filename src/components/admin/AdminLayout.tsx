import React, { useState, useEffect, useRef } from 'react';
import {
  Command, Package, ShoppingCart, Users, Tag, FileText,
  ShieldAlert, Settings, LogOut, Menu, X, Sun, Moon, Search, Download, MessageSquare, Mail, RefreshCw, Globe2
} from 'lucide-react';
import { CommandPalette } from './CommandPalette';

interface AdminLayoutProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  adminUser: any;
  onLogout: () => void;
  products: any[];
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  lastUpdated?: string | null;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeTab,
  onTabChange,
  adminUser,
  onLogout,
  products,
  children,
  refreshing = false,
  onRefresh,
  lastUpdated,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const originalDark = useRef(document.documentElement.classList.contains('dark'));
  const [isDark, setIsDark] = useState(originalDark.current);
  useEffect(() => () => { document.documentElement.classList.toggle('dark', originalDark.current); }, []);

  const toggleDarkMode = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Command },
    { id: 'marketplace', label: 'Marketplace', icon: Globe2 },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'coupons', label: 'Coupons', icon: Tag },
    { id: 'downloads', label: 'Downloads & Access', icon: FileText },
    { id: 'support', label: 'Support Requests', icon: MessageSquare },
    { id: 'subscribers', label: 'Subscribers', icon: Mail },
    { id: 'audit', label: 'Audit Logs', icon: ShieldAlert },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row">
      <CommandPalette isOpen={isCmdOpen} onClose={() => setIsCmdOpen(false)} onNavigate={onTabChange} products={products} />

      {/* Sidebar for Desktop */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-200 ease-in-out md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800">
          <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Admin Console
          </span>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100vh-8rem)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onTabChange(item.id); setIsSidebarOpen(false); }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 truncate">
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm shrink-0">
                {adminUser?.name?.[0]?.toUpperCase() || 'A'}
              </div>
              <div className="truncate">
                <p className="text-sm font-semibold truncate">{adminUser?.name || 'Administrator'}</p>
                <p className="text-xs text-slate-400 truncate">{adminUser?.email || ''}</p>
              </div>
            </div>
            <button onClick={onLogout} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center space-x-4">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsCmdOpen(true)}
              className="hidden sm:flex items-center space-x-2 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-4 py-2 rounded-xl text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <Search className="w-4 h-4" />
              <span>Quick Search (Cmd + K)</span>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            {onRefresh && <button type="button" disabled={refreshing} onClick={() => void onRefresh()} title={lastUpdated ? `Last refreshed ${new Date(lastUpdated).toLocaleTimeString()}` : 'Refresh store records'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-950 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span></button>}
            <button
              onClick={() => window.open('/api/admin/export/orders', '_blank')}
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button onClick={toggleDarkMode} className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition">
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {onRefresh && <p role="status" className="mb-4 text-xs text-slate-500">{refreshing ? 'Refreshing store records…' : lastUpdated ? `Last refreshed ${new Date(lastUpdated).toLocaleTimeString()} · Updates every 30 seconds while visible` : 'Waiting for store records'}</p>}
          {children}
        </main>
      </div>
    </div>
  );
};
