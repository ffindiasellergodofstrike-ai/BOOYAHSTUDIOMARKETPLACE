import { authReturnSearch } from '../services/AuthNavigation';
import { hasLivePayment } from '../services/PaymentEnvironment';
import { isVerifiedPaidOrder } from '../services/PaymentVerification';

const itemHasAccess = (item: any): boolean => item.refunded !== true && item.accessStatus !== 'restricted' && item.downloadStatus !== 'REVOKED';
const orderStatusLabel = (order: Order): string => {
  const status = String(order.paymentStatus || order.status || '').toUpperCase();
  if (status === 'PAID') return hasLivePayment(order) ? 'Paid' : 'No purchase';
  if (status === 'PARTIALLY_REFUNDED') return 'Partly refunded';
  if (status === 'REFUNDED') return 'Refunded';
  if (status === 'FAILED') return 'Payment failed';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Awaiting payment';
};
const emailDeliveryLabel = (delivery: any): string => {
  if (delivery?.providerStatus === 'delivered') return 'Email delivered';
  if (['bounced', 'failed', 'complained'].includes(delivery?.providerStatus) || ['failed', 'not_configured', 'review_required'].includes(delivery?.status)) return 'We could not deliver your email. Your purchases are still available here.';
  return delivery?.status === 'sent' ? 'Email on its way' : 'Preparing your email';
};
import React, { useState, useEffect } from 'react';
import '../styles/purchase.css';
import {
  User as UserIcon,
  Package,
  Download,
  LogOut,
  ShieldCheck,
  FolderDown,
  Heart,
  Settings,
  CheckCircle2,
  Lock,
  Mail,
  Phone,
  ArrowRight,
  Eye,
  KeyRound,
  Calendar,
  Building,
  Globe,
  AlertCircle,
  Clock,
  Loader2,
  ArrowUpRight,
  ShoppingBag,
  LifeBuoy,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { OrderService } from '../services/OrderService';
import { DownloadService } from '../services/DownloadService';
import type { Order } from '../types';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';

const formatISTDate = (isoString?: string): string => {
  if (!isoString) return 'Not recorded';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (err) {
    return isoString;
  }
};

export const AccountPage: React.FC = () => {
  const {
    currentUser,
    isAuthenticated,
    signOut,
    updateProfile,
    wishlistCount,
    currentPath,
    navigate,
  } = useApp();
  const { showToast } = useToast();

  // Tab State synced with current path
  const getInitialTab = (): 'orders' | 'downloads' | 'settings' => {
    if (currentPath === '/account/downloads') return 'downloads';
    if (currentPath === '/account/settings') return 'settings';
    return 'orders';
  };

  const [activeTab, setActiveTab] = useState<'orders' | 'downloads' | 'settings'>(getInitialTab);

  useEffect(() => {
    if (currentPath === '/account/downloads') setActiveTab('downloads');
    else if (currentPath === '/account/settings') setActiveTab('settings');
    else if (currentPath === '/account/orders' || currentPath === '/account') setActiveTab('orders');
  }, [currentPath]);

  const switchTab = (tab: 'orders' | 'downloads' | 'settings') => {
    setActiveTab(tab);
    if (tab === 'orders') navigate('/account/orders');
    else if (tab === 'downloads') navigate('/account/downloads');
    else if (tab === 'settings') navigate('/account/settings');
  };

  // Profile Edit Inputs
  const [profileName, setProfileName] = useState(currentUser?.name || '');
  const [profileCompany, setProfileCompany] = useState(currentUser?.company || '');
  const [profileCountry, setProfileCountry] = useState(currentUser?.country || 'United States');
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setProfileName(currentUser.name || '');
      setProfileCompany(currentUser.company || '');
      setProfileCountry(currentUser.country || 'United States');
    }
  }, [currentUser]);

  // Receipt Modal State
  const [viewingOrder, setViewingOrder] = useState<any | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<Record<string, boolean>>({});
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const setDownloading = (key: string, busy: boolean) => setDownloadBusy(current => ({ ...current, [key]: busy }));

  const handleSecureDownload = async (productId: string, defaultName: string, orderId?: string) => {
    const key = `${orderId || ''}:${productId}`;
    if (downloadBusy[key]) return;
    setDownloading(key, true);
    try {
      const res = await OrderService.requestDownloadToken(productId, orderId);
      if (res.success && res.downloadUrl) {
        showToast('success', 'Download link ready', `Your browser can now download ${defaultName}.`);
        const a = document.createElement('a');
        a.href = res.downloadUrl;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        showToast('error', 'Download unavailable', 'We could not prepare your download. Please contact support with your order reference.');
      }
    } catch (err) {
      showToast('error', 'Download unavailable', 'We could not prepare your file. Please try again.');
    } finally { setDownloading(key, false); }
  };

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [ordersAttempt, setOrdersAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOrders([]);
    setOrdersError('');
    setOrdersLoading(Boolean(currentUser));
    if (currentUser) {
      void OrderService.fetchUserOrders({ throwOnError: true }).then((latestOrders) => {
        if (active) setOrders(latestOrders);
      }).catch(() => { if (active) setOrdersError('We couldn’t load your purchases. Please try again.'); }).finally(() => { if (active) setOrdersLoading(false); });
    }
    return () => { active = false; };
  }, [currentUser?.id, ordersAttempt]);

  const ordersErrorNotice = <div className="account-load-error" role="alert">{ordersError}<button onClick={() => setOrdersAttempt(value => value + 1)}>Try again</button></div>;

  const downloads = orders
    .filter(isVerifiedPaidOrder)
    .flatMap((order) => order.items.filter(itemHasAccess).map((item) => ({ ...item, orderId: order.id })));

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    try {
      const res = await updateProfile({
        name: profileName,
        company: profileCompany,
        country: profileCountry,
      });
      if (res.success) {
        showToast('success', 'Profile Updated', 'Your changes have been saved.');
      } else {
        showToast('error', 'Update Failed', 'Could not save profile changes.');
      }
    } catch {
      showToast('error', 'Could not save changes', 'Please try again in a moment.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleProtectedDownload = async (orderId: string, productId: string, fileName: string) => {
    const key = `${orderId}:${productId}`;
    if (downloadBusy[key]) return;
    setDownloading(key, true);
    try {
      const authResult = await DownloadService.getProtectedDownload(orderId, productId);
      if (authResult.success && authResult.downloadUrl) {
        showToast('success', 'Your file is ready', 'Your browser can now download your purchase.');
        const a = document.createElement('a');
        a.href = authResult.downloadUrl;
        a.download = fileName.endsWith('.zip') ? fileName : `${fileName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        showToast('error', 'Download unavailable', 'We could not confirm download access. Please contact support with your order reference.');
      }
    } catch {
      showToast('error', 'Download unavailable', 'We could not prepare your file. Please try again.');
    } finally { setDownloading(key, false); }
  };

  const handleReceiptDownload = async (order: Order) => {
    if (receiptBusy) return;
    setReceiptBusy(order.id);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/invoice`, {
        credentials: 'include', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Receipt is unavailable.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${order.invoiceNumber || `INV-${order.orderNumber}`}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      showToast('error', 'Receipt Unavailable', 'Could not download your receipt. Please retry.');
    } finally { setReceiptBusy(null); }
  };

  // UNAUTHENTICATED: A simple invitation to return to your purchases.
  if (!isAuthenticated || !currentUser) {
    return <section className="purchase-page account-welcome">
      <div className="account-welcome-copy">
        <span className="purchase-eyebrow">A PLACE FOR YOUR NEXT CHAPTER</span>
        <h1>Your ideas.<br />Your <em>collection.</em></h1>
        <p>Sign in to find your purchases, download your files, and pick up where you left off.</p>
        <div className="account-welcome-actions"><button onClick={() => navigate('/login', undefined, authReturnSearch(activeTab))} className="purchase-button purchase-button-primary">Sign in <ArrowUpRight size={18} /></button><button onClick={() => navigate('/register', undefined, authReturnSearch(activeTab))} className="purchase-button purchase-button-secondary">Create an account <ArrowRight size={17} /></button></div>
        <button onClick={() => navigate('/products')} className="purchase-text-link">Just browsing? Explore the collection <ArrowRight size={15} /></button>
      </div>
      <div className="account-welcome-art" aria-hidden="true">
        <span className="account-art-label">MADE YOURS, ALL IN ONE PLACE.</span>
        <div className="account-art-card"><span className="account-art-icon"><ShoppingBag size={27} /></span><div><strong>Your collection</strong><small>The good things you’ve picked up.</small></div><CheckCircle2 size={19} /></div>
        <div className="account-art-card"><span className="account-art-icon"><FolderDown size={27} /></span><div><strong>Ready when you are</strong><small>Come back to your files anytime.</small></div><Download size={19} /></div>
        <div className="account-art-card"><span className="account-art-icon"><LifeBuoy size={27} /></span><div><strong>A little help, if you need it</strong><small>Help with your order and downloads.</small></div><ArrowUpRight size={19} /></div>
        <span className="account-art-footer">YOUR WORK BEGINS HERE. ✳</span>
      </div>
    </section>;
  }

  // AUTHENTICATED: Dashboard View
  return (
    <div className="purchase-page account-page space-y-6 sm:space-y-8">
      <div className="purchase-page-heading"><div><span className="purchase-eyebrow">GOOD TO HAVE YOU BACK</span><h1>Your account<span>.</span></h1><p>Your purchases, downloads, and a few useful details.</p></div><button onClick={() => navigate('/products')} className="purchase-text-link">Find your next template <ArrowUpRight size={17} /></button></div>
      {/* User Header Profile Card */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-5 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 overflow-hidden">
        <div className="flex items-start sm:items-center gap-4 sm:gap-6 min-w-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-blue-600 text-white font-black text-2xl sm:text-3xl flex items-center justify-center shadow-md shadow-blue-500/20 border-2 border-white shrink-0">
            {(currentUser.name || 'You').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="account-name">{currentUser.name || 'Your account'}</h2>
              {currentUser.username && (
                <span className="text-[10px] sm:text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-200 truncate">
                  @{currentUser.username}
                </span>
              )}
              <span className="text-[9px] sm:text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" />
                <span>Member</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{currentUser.email}</span>
            </p>
            {currentUser.mobile && (
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5 flex items-center gap-2 min-w-0">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">+91 {currentUser.mobile}</span>
              </p>
            )}
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono mt-1 flex items-center gap-1.5 min-w-0">
              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">Member since {formatISTDate(currentUser.createdAt)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-center flex-wrap shrink-0">
          <button
            onClick={() => navigate('/wishlist')}
            className="px-4 py-2.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 border border-slate-200 min-h-[44px]"
          >
            <Heart className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="truncate">Wishlist ({wishlistCount})</span>
          </button>

          <button
            onClick={async () => { setSigningOut(true); try { await signOut(); } finally { setSigningOut(false); } }}
            disabled={signingOut}
            className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 border border-red-200/60 min-h-[44px]"
          >
            {signingOut ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <LogOut className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="account-tabs flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto scrollbar-hide">
        <button
          id="account-tab-orders" aria-current={activeTab === 'orders' ? 'page' : undefined}
          onClick={() => switchTab('orders')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'orders'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4 shrink-0" />
          <span>Orders{!ordersLoading && !ordersError ? ` (${orders.length})` : ''}</span>
        </button>

        <button
          id="account-tab-downloads" aria-current={activeTab === 'downloads' ? 'page' : undefined}
          onClick={() => switchTab('downloads')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'downloads'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <FolderDown className="w-4 h-4 shrink-0" />
          <span>Downloads{!ordersLoading && !ordersError ? ` (${downloads.length})` : ''}</span>
        </button>

        <button
          id="account-tab-settings" aria-current={activeTab === 'settings' ? 'page' : undefined}
          onClick={() => switchTab('settings')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'settings'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span>Settings</span>
        </button>
      </div>

      {/* Tab 1: Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {ordersLoading ? <AccountSkeleton /> : ordersError ? ordersErrorNotice : orders.length === 0 ? (
            <EmptyState
              type="orders"
              title="No orders yet"
              description="Your next great project starts with a little inspiration. Find a template you love."
              actionText="Explore the collection"
              actionPath="/products"
            />
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 sm:p-6 space-y-5 transition-all hover:border-slate-300"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
                  <div className="min-w-0">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-400 block">Reference</span>
                    <h3 className="text-sm sm:text-base font-black text-slate-900 font-mono truncate">
                      {order.orderNumber}
                    </h3>
                    <span className="text-[10px] sm:text-xs text-slate-500 block mt-0.5">{formatISTDate(order.createdAt)}</span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border tracking-wider ${
                      order.paymentStatus?.toUpperCase() === 'PAID'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {orderStatusLabel(order)}
                    </span>
                    <button
                      onClick={() => setViewingOrder(order)}
                      className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 border border-slate-200 min-h-[44px] min-w-[44px] sm:min-w-0"
                    >
                      <Eye className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Details</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {order.items.map((item, iIdx) => (
                    <div key={iIdx} className="flex items-start justify-between gap-4 text-xs">
                      <div className="min-w-0">
                        <p className="font-extrabold text-slate-900 truncate">{item.product?.title || item.productTitle}</p>
                        <p className="text-slate-500 mt-0.5 truncate">
                          Qty: {item.quantity || 1}
                        </p>
                      </div>
                      <span className="font-mono font-black text-slate-900 shrink-0 text-right">
                        ₹{(item.price * (item.quantity || 1)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-widest min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="truncate">Payment: Online</span>
                  </div>
                  <div className="flex items-baseline justify-end gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</span>
                    <span className="text-lg sm:text-xl font-black text-emerald-600 font-mono">
                      ₹{order.total.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: Downloads */}
      {activeTab === 'downloads' && (
        <div className="space-y-4">
          {ordersLoading ? <AccountSkeleton /> : ordersError ? ordersErrorNotice : downloads.length === 0 ? (
            <EmptyState
              type="orders"
              title="Your files will feel at home here"
              description="Once you purchase a template, you’ll find its downloadable files right here."
              actionText="Find your next template"
              actionPath="/products"
            />
          ) : (
            downloads.map((item, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 sm:p-6 space-y-5 transition-all hover:border-slate-300"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 block">
                      {item.product?.categoryLabel || 'Your purchase'}
                    </span>
                    <h3 className="text-base sm:text-lg font-black text-slate-900 mt-1 truncate">{item.product?.title || item.productTitle}</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1 line-clamp-1">
                      Version: <strong className="text-slate-800">v{item.product?.version || item.version || '1.0.0'}</strong> · File size: {item.product?.fileSize || 'Size varies'}
                    </p>
                  </div>

                  <button
                    disabled={Boolean(downloadBusy[`${(item as any).orderId}:${item.productId}`])}
                    aria-busy={Boolean(downloadBusy[`${(item as any).orderId}:${item.productId}`])}
                    aria-label={`Download ${item.product?.title || item.productTitle || 'your file'}`}
                    onClick={() =>
                      handleProtectedDownload(
                        (item as any).orderId || 'ord_direct',
                        item.productId,
                        `${item.product?.slug || item.productSlug || item.productId}-v${item.product?.version || item.version || '1.0.0'}.zip`
                      )
                    }
                    className="p-2 sm:px-5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl text-xs transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] sm:min-w-0 shrink-0"
                  >
                    {downloadBusy[`${(item as any).orderId}:${item.productId}`] ? <Loader2 className="w-5 h-5 sm:w-4 sm:h-4 shrink-0 animate-spin" /> : <Download className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" />}
                    <span>{downloadBusy[`${(item as any).orderId}:${item.productId}`] ? 'Preparing…' : 'Download'}</span>
                  </button>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                      <FolderDown className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-widest block">
                        Ready to download
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 3: Account Settings */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 space-y-6">
            <h3 className="text-lg font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              <span>Your details</span>
            </h3>

            <form onSubmit={handleUpdateProfile} className="space-y-4" aria-busy={isUpdating}>
              <fieldset disabled={isUpdating} className="space-y-4">
              <div>
                <label htmlFor="account-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Full name</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    id="account-name" value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    required
                    className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="account-username" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Username</label>
                  <input
                    type="text"
                    disabled
                    id="account-username" value={`@${currentUser.username || 'user'}`}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-mono cursor-not-allowed"
                  />
                </div>

                <div>
                  <label htmlFor="account-email" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Account Email</label>
                  <input
                    type="email"
                    disabled
                    id="account-email" value={currentUser.email}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="account-company" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Company / Organization</label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      id="account-company" value={profileCompany}
                      onChange={(e) => setProfileCompany(e.target.value)}
                      placeholder="e.g. Acme Labs"
                      className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="account-country" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Country</label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      id="account-country" value={profileCountry}
                      onChange={(e) => setProfileCountry(e.target.value)}
                      placeholder="e.g. United States"
                      className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isUpdating}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
              >
                {isUpdating && <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />}{isUpdating ? 'Saving changes…' : 'Save changes'}
              </button>
              </fieldset>
            </form>
          </div>

          <aside className="account-help-panel">
            <span className="account-help-icon"><KeyRound size={23} /></span>
            <h3>Make yourself at home.</h3>
            <p>Need a new password? We’ll email you a link so you can choose one.</p>
            <button type="button" onClick={() => navigate('/forgot-password')} className="purchase-button purchase-button-secondary">Reset password <ArrowRight size={16} /></button>
            <div className="account-help-divider" />
            <LifeBuoy size={23} /><h4>Something we can help with?</h4><p>If you have a question about an order or your files, we’re here.</p>
            <button onClick={() => navigate('/contact')} className="purchase-text-link">Get in touch <ArrowUpRight size={16} /></button>
          </aside>
        </div>
      )}

      {/* Receipt Modal */}
      {viewingOrder && (() => {
        const isPartial = String(viewingOrder.paymentStatus || '').toUpperCase() === 'PARTIALLY_REFUNDED';
        const isPaid = hasLivePayment(viewingOrder) && ['PAID', 'PARTIALLY_REFUNDED'].includes(String(viewingOrder.paymentStatus || '').toUpperCase()) && ['cashfree', 'razorpay', 'easebuzz'].includes(String(viewingOrder.paymentProvider || '').toLowerCase()) && Boolean(viewingOrder.transactionId);
        const isRefunded = String(viewingOrder.paymentStatus || '').toUpperCase() === 'REFUNDED';
        const hasReceipt = isPaid || (isRefunded && hasLivePayment(viewingOrder) && ['cashfree', 'razorpay', 'easebuzz'].includes(String(viewingOrder.paymentProvider || '').toLowerCase()) && Boolean(viewingOrder.transactionId));
        const isDelivered = isVerifiedPaidOrder(viewingOrder);
        const isTest = !hasLivePayment(viewingOrder) && viewingOrder.paymentStatus === 'PAID';
        const isFailed =
          String(viewingOrder.paymentStatus || '').toUpperCase() === 'FAILED' ||
          String(viewingOrder.status || '').toUpperCase() === 'FAILED';

        return (
          <Modal
            isOpen={!!viewingOrder}
            onClose={() => setViewingOrder(null)}
            title={`Order #${viewingOrder.orderNumber}`}
            maxWidth="md"
          >
            <div className="space-y-6">
              {isPaid ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Payment Status</p>
                    <p className="text-sm font-black text-emerald-900 truncate">{isPartial ? 'PARTIALLY REFUNDED' : 'COMPLETED & VERIFIED'}</p>
                  </div>
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-emerald-200 shrink-0 self-start sm:self-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-[10px] font-black text-emerald-700">{isPartial ? 'PARTIAL REFUND RECORDED' : 'PAID IN FULL'}</span>
                  </div>
                </div>
              ) : isFailed ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-600">Payment Status</p>
                    <p className="text-sm font-black text-rose-900 truncate">PAYMENT FAILED</p>
                  </div>
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-rose-200 shrink-0 self-start sm:self-center">
                    <AlertCircle className="w-4 h-4 text-rose-500" />
                    <span className="text-[10px] font-black text-rose-700">NOT PAID</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Payment Status</p>
                    <p className="text-sm font-black text-amber-900 truncate">{isRefunded ? 'REFUND CONFIRMED' : isTest ? 'NO PURCHASE CREATED' : 'PAYMENT PENDING'}</p>
                  </div>
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-amber-200 shrink-0 self-start sm:self-center">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span className="text-[10px] font-black text-amber-700">{isRefunded ? 'FURTHER DOWNLOADS RESTRICTED' : isTest ? 'NO PRODUCT DELIVERY' : 'AWAITING PAYMENT'}</span>
                  </div>
                </div>
              )}

              {!isPaid && !isFailed && !isRefunded && (
                <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-2xl flex items-center gap-3 text-xs text-amber-800">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="font-medium">{isTest ? 'This transaction did not create a purchase. No files or payment receipt will be issued.' : 'Downloads and your receipt become available after payment confirmation.'}</span>
                </div>
              )}
              {isPaid && <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 space-y-1">
                <p>{hasLivePayment(viewingOrder) ? `Receipt: ${viewingOrder.invoiceNumber || `INV-${viewingOrder.orderNumber}`}` : 'No completed purchase — no files or receipt.'}</p>
                <p>Payment verified: {formatISTDate(viewingOrder.paymentVerifiedAt)}</p>
                <p>Digital access: {isDelivered ? `Available since ${formatISTDate(viewingOrder.deliveredAt)}` : viewingOrder.deliveryStatus === 'REVOKED' ? 'Restricted — contact support' : 'Preparing delivery'}</p>
                <p>Email: {emailDeliveryLabel(viewingOrder.emailDelivery)}</p>
              </div>}

              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Order Items
                </h4>
                <div className="divide-y divide-slate-100 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  {viewingOrder.items.map((i: any, idx: number) => (
                    <div key={idx} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group hover:bg-slate-50 transition-colors">
                      <div className="min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{i.product?.title || i.productTitle}</p>
                        <p className="text-[10px] font-bold text-slate-500 mt-0.5 truncate">
                          Qty: {i.quantity || 1}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {isPaid && isDelivered && itemHasAccess(i) && (
                          <button
                            disabled={Boolean(downloadBusy[`${viewingOrder.id}:${i.productId}`])}
                            aria-busy={Boolean(downloadBusy[`${viewingOrder.id}:${i.productId}`])}
                            onClick={() => handleSecureDownload(i.productId, `${i.productSlug || 'product'}-v${i.version || '1.0'}.zip`, viewingOrder.id)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all active:scale-95 flex items-center gap-2"
                          >
                            {downloadBusy[`${viewingOrder.id}:${i.productId}`] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            {downloadBusy[`${viewingOrder.id}:${i.productId}`] ? 'Preparing…' : 'Download'}
                          </button>
                        )}
                        <span className="font-mono font-black text-slate-900 shrink-0 text-right text-sm">
                          ₹{(i.price * (i.quantity || 1)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <span>Subtotal</span>
                  <span className="font-mono text-slate-900">₹{Number(viewingOrder.subtotal ?? viewingOrder.total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <span>Tax documentation</span>
                  <span className="text-slate-900">Contact support</span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                  <span className="text-sm font-black text-slate-900">Total Amount</span>
                  <span className="text-xl font-black text-emerald-600 font-mono">₹{viewingOrder.total.toFixed(2)}</span>
                </div>
              </div>

              {hasReceipt && (
                <button
                  disabled={receiptBusy !== null}
                  aria-busy={receiptBusy === viewingOrder.id}
                  onClick={() => { void handleReceiptDownload(viewingOrder); }}
                  className="w-full py-4 bg-slate-900 hover:bg-black text-white font-black rounded-2xl text-xs sm:text-sm transition-all shadow-xl active:scale-95 min-h-[44px]"
                >
                  {receiptBusy === viewingOrder.id && <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />}{receiptBusy === viewingOrder.id ? 'Preparing receipt…' : 'Download receipt'}
                </button>
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};

const AccountSkeleton = () => <div className="account-order-skeletons" role="status" aria-label="Loading your purchases"><span className="sr-only">Loading your purchases…</span>{[0, 1, 2].map(item => <div className="account-order-skeleton" key={item}><span /><span /><span /></div>)}</div>;
