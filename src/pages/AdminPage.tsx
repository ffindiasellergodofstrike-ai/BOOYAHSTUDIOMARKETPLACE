import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '../components/admin/AdminLayout';
import { AdminMarketplaceView } from '../components/admin/AdminMarketplaceView';
import { AdminDashboardView } from '../components/admin/AdminDashboardView';
import { AdminProductsView } from '../components/admin/AdminProductsView';
import { AdminOrdersView } from '../components/admin/AdminOrdersView';
import { AdminCustomersView } from '../components/admin/AdminCustomersView';
import { AdminCouponsView } from '../components/admin/AdminCouponsView';
import { AdminDownloadsView } from '../components/admin/AdminDownloadsView';
import { AdminSupportView } from '../components/admin/AdminSupportView';
import { AdminSubscribersView } from '../components/admin/AdminSubscribersView';
import { AdminSettingsView } from '../components/admin/AdminSettingsView';
import { AdminAccessPanel, type AdminAccessState } from '../components/admin/AdminAccessPanel';
import { AdminService } from '../services/AdminService';
import { AuthService } from '../services/AuthService';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [access, setAccess] = useState<AdminAccessState>('checking');
  const [accessMessage, setAccessMessage] = useState('');
  const [adminUser, setAdminUser] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const loading = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);

  const clearPrivateData = useCallback(() => {
    setAdminUser(null); setHealth(null); setStats(null); setProducts([]); setOrders([]); setCustomers([]); setAuditLogs([]); setSectionErrors({}); setLastUpdated(null);
  }, []);

  const loadAdminData = useCallback(async () => {
    if (loading.current || !mounted.current) return;
    loading.current = true; setRefreshing(true);
    const version = ++requestVersion.current;
    try {
      const authRes: any = await AdminService.verifyAdminMe();
      if (!mounted.current || version !== requestVersion.current) return;
      if (!authRes.success || !authRes.admin || authRes.admin.role !== 'admin') {
        clearPrivateData();
        if (authRes.httpStatus === 401) { setAccess('login'); setAccessMessage('Sign in with your administrator account. If your session expired, sign in again.'); }
        else if (authRes.httpStatus === 403 || (authRes.success && authRes.admin?.role !== 'admin')) { setAccess('denied'); setAccessMessage('This account does not have administrator access. Sign in with an authorized administrator account.'); }
        else { setAccess('error'); setAccessMessage(authRes.message || 'The server could not verify administrative access. Check your connection and retry.'); }
        return;
      }
      setAdminUser(authRes.admin); setHealth(authRes.health); setAccess('ready'); setAccessMessage('');
      const results = await Promise.allSettled([
        AdminService.getDashboardStats(), AdminService.getProducts(), AdminService.getOrders(), AdminService.getCustomers(), AdminService.getAuditLogs(),
      ]);
      if (!mounted.current || version !== requestVersion.current) return;
      const failedAuth = results.find(result => result.status === 'rejected' && [401,403].includes(Number((result.reason as any)?.httpStatus || (result.reason as any)?.status)));
      if (failedAuth?.status === 'rejected') {
        clearPrivateData();
        const denied = Number((failedAuth.reason as any)?.httpStatus || (failedAuth.reason as any)?.status) === 403;
        setAccess(denied ? 'denied' : 'login'); setAccessMessage(denied ? 'Administrative access is no longer available for this account.' : 'Your session expired. Sign in again to continue.'); return;
      }
      const names = ['Dashboard', 'Products', 'Orders', 'Customers', 'Audit logs'];
      const nextErrors: Record<string, string> = {};
      results.forEach((result, index) => {
        if (result.status === 'rejected') { nextErrors[names[index]] = result.reason instanceof Error ? result.reason.message : 'Temporarily unavailable. Retry to refresh this section.'; return; }
        if (index === 0) {
          if (result.value?.success === false) { nextErrors.Dashboard = result.value.message || 'Dashboard temporarily unavailable.'; return; }
          setStats(result.value);
        } else if (index === 1) setProducts(result.value);
        else if (index === 2) setOrders(result.value);
        else if (index === 3) setCustomers(result.value);
        else setAuditLogs(result.value);
      });
      setSectionErrors(nextErrors);
      if (results.some(result => result.status === 'fulfilled')) setLastUpdated(new Date().toISOString());
      setRefreshKey(key => key + 1);
    } catch (error) {
      if (!mounted.current || version !== requestVersion.current) return;
      clearPrivateData(); setAccess('error'); setAccessMessage(error instanceof Error ? error.message : 'Administrative access could not be checked. Please retry.');
    } finally {
      loading.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [clearPrivateData]);

  useEffect(() => {
    mounted.current = true; void loadAdminData();
    return () => { mounted.current = false; };
  }, [loadAdminData]);

  useEffect(() => {
    if (access !== 'ready') return;
    const refreshVisible = () => { if (document.visibilityState === 'visible') void loadAdminData(); };
    const timer = window.setInterval(refreshVisible, 30000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [access, loadAdminData]);

  async function handleSignIn(email: string, password: string) {
    setAccessMessage('');
    try {
      const result = await AuthService.signIn(email, password);
      if (!mounted.current) return;
      if (!result.success) { setAccess('login'); setAccessMessage(result.message || 'Sign in failed. Check your email and password.'); return; }
      // A successful customer login alone must never unlock this console.
      await loadAdminData();
    } catch { setAccess('error'); setAccessMessage('Sign in is temporarily unavailable. Please retry.'); }
  }

  async function handleLogout() {
    if (!await AuthService.signOut()) { setSectionErrors(errors => ({ ...errors, Session: 'Sign out could not be completed. Please retry.' })); return; }
    requestVersion.current += 1;
    clearPrivateData(); setAccess('login'); setAccessMessage('You have been signed out.');
  }

  if (access === 'checking') return <div className="min-h-[70vh] flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="flex flex-col items-center space-y-4"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /><p className="text-sm font-medium text-slate-500">Verifying administrative access...</p></div></div>;
  if (access !== 'ready') return <AdminAccessPanel state={access} message={accessMessage} onSignIn={handleSignIn} onRetry={loadAdminData} />;

  return <AdminLayout activeTab={activeTab} onTabChange={setActiveTab} adminUser={adminUser} onLogout={handleLogout} products={products}
    refreshing={refreshing} onRefresh={loadAdminData} lastUpdated={lastUpdated}>
    {Object.keys(sectionErrors).length > 0 && <div role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-center justify-between gap-4"><p className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Some sections could not be refreshed</p><button disabled={refreshing} onClick={() => void loadAdminData()} className="inline-flex items-center gap-1 text-xs font-bold disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Retry</button></div>
      {Object.entries(sectionErrors).map(([section, message]) => <p key={section} className="mt-2"><strong>{section}:</strong> {message}</p>)}
      <p className="mt-2 text-xs">Previously loaded records remain visible. Check the refresh status before taking action.</p>
    </div>}
    {activeTab === 'dashboard' && (stats ? <AdminDashboardView stats={stats?.stats || stats} recentOrders={stats?.recentOrders || orders} recentAuditLogs={auditLogs} health={health} /> : <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800"><h3 className="text-lg font-bold mb-2">Dashboard</h3><p className="text-sm text-slate-500">{refreshing ? 'Loading current store totals…' : 'Dashboard totals are temporarily unavailable. Retry refresh or use the other management sections.'}</p></div>)}
    {activeTab === 'marketplace' && <AdminMarketplaceView refreshKey={refreshKey} />}
    {activeTab === 'products' && <AdminProductsView products={products} onRefresh={loadAdminData} onSaveProduct={AdminService.saveProduct} onDeleteProduct={AdminService.deleteProduct} onCloneProduct={AdminService.cloneProduct} />}
    {activeTab === 'orders' && <AdminOrdersView orders={orders} onRefresh={loadAdminData} />}
    {activeTab === 'customers' && <AdminCustomersView customers={customers} onRefresh={loadAdminData} />}
    {activeTab === 'coupons' && <AdminCouponsView refreshKey={refreshKey} />}
    {activeTab === 'downloads' && <AdminDownloadsView refreshKey={refreshKey} />}
    {activeTab === 'support' && <AdminSupportView refreshKey={refreshKey} />}
    {activeTab === 'subscribers' && <AdminSubscribersView refreshKey={refreshKey} />}
    {activeTab === 'settings' && <AdminSettingsView refreshKey={refreshKey} health={health} />}
    {activeTab === 'audit' && <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
      <h3 className="text-lg font-bold mb-4">Security Audit Logs</h3>
      {!auditLogs.length && <p className="text-sm text-slate-500">{sectionErrors['Audit logs'] ? 'Audit records are temporarily unavailable.' : 'No audit records yet.'}</p>}
      <div className="space-y-3">{auditLogs.map((log: any) => <div key={log.logId} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex flex-wrap gap-2 justify-between items-center text-xs"><div><span className="font-semibold text-blue-600 mr-2">{log.eventType}</span><span className="text-slate-400 font-mono">{log.requestId}</span>{log.orderId && <span className="ml-2 text-slate-500">{log.orderId}</span>}</div><span className="text-slate-400">{new Date(log.timestamp).toLocaleString()}</span></div>)}</div>
    </div>}
  </AdminLayout>;
};
