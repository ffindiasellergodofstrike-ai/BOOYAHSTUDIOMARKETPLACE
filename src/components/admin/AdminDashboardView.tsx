import React from 'react';
import { adminAccessStatus, adminEmailStatus, adminOrderMoney } from '../../services/AdminOrderStatus';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, ShoppingBag, Users, DollarSign, CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';

interface AdminDashboardViewProps {
  stats: any;
  recentOrders: any[];
  recentAuditLogs: any[];
  health: any;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ stats, recentOrders, recentAuditLogs, health }) => {
  const metrics = stats?.stats || stats;
  const chartData = metrics?.revenue?.daily || [];
  const supabaseConnected = health?.supabase?.connected === true;
  const razorpayConfigured = health?.razorpay?.status === 'configured';
  const cashfreeConfigured = health?.cashfree?.status === 'configured';
  const resendConfigured = health?.resend?.status === 'configured';

  return (
    <div className="space-y-6">
      {/* Live Health Badges */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${supabaseConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Supabase: <strong>{supabaseConnected ? 'Reachable' : 'Check connection'}</strong></span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
          <span className="flex items-center"><ShieldCheck className="w-4 h-4 mr-1" /> Supabase: {supabaseConnected ? 'Reachable' : 'Unavailable'}</span>
          <span className="flex items-center"><CheckCircle2 className="w-4 h-4 mr-1" /> Cashfree: {cashfreeConfigured ? 'Configured' : 'Not configured'} ({health?.cashfree?.environment || 'unset'})</span>
          <span className="flex items-center"><CheckCircle2 className="w-4 h-4 mr-1" /> Resend: {resendConfigured ? 'Configured' : 'Not configured'}</span>
          {razorpayConfigured && <span className="flex items-center">Razorpay: historical payments ({health?.razorpay?.environment || 'unset'})</span>}
        </div>
      </div>

      <p className="text-xs text-slate-500">Configured means the server settings are present. It does not confirm gateway activation, a completed live payment or inbox delivery.</p>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Today's Revenue</span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">₹{metrics?.revenue?.today?.toLocaleString() || '0'}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Orders</span>
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <ShoppingBag className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{metrics?.orders?.total || 0}</span>
            <span className="text-xs font-medium text-slate-500">{metrics?.orders?.paid || 0} Paid</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active Customers</span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{metrics?.customersCount || 0}</span>
            <span className="text-xs font-semibold text-indigo-600">Registered</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">30-Day Revenue</span>
            <div className="p-2 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">₹{metrics?.revenue?.last30d?.toLocaleString() || '0'}</span>
            <span className="text-xs font-semibold text-purple-600">Revenue</span>
          </div>
        </div>
      </div>

      {(metrics?.delivery || metrics?.orderEmails) && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {metrics?.delivery && <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3"><h3 className="font-semibold text-sm text-slate-900 dark:text-white">Account delivery</h3><div className="grid grid-cols-2 gap-3 text-xs">{[['Available', metrics.delivery.available], ['Partly available', metrics.delivery.partial], ['Not delivered / pending', metrics.delivery.pending], ['Revoked', metrics.delivery.revoked], ['Test only', metrics.delivery.testOnly]].map(([label, value]) => <p key={label} className="text-slate-500">{label}<strong className="block mt-1 text-lg text-slate-900 dark:text-white">{Number(value || 0)}</strong></p>)}</div><p className="text-[11px] text-slate-500">Account access is separate from completed file downloads.</p></div>}
        {metrics?.orderEmails && <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3"><h3 className="font-semibold text-sm text-slate-900 dark:text-white">Order email delivery</h3><div className="grid grid-cols-2 gap-3 text-xs">{[['Delivered to mail server', metrics.orderEmails.delivered], ['Accepted by Resend', metrics.orderEmails.accepted], ['Delayed', metrics.orderEmails.delayed], ['Failed / bounced', metrics.orderEmails.failed], ['Not configured', metrics.orderEmails.notConfigured], ['Pending / not queued', metrics.orderEmails.pending]].map(([label, value]) => <p key={label} className="text-slate-500">{label}<strong className="block mt-1 text-lg text-slate-900 dark:text-white">{Number(value || 0)}</strong></p>)}</div><p className="text-[11px] text-slate-500">Delivered means the recipient mail server accepted the message, not that the customer read it.</p></div>}
      </div>}

      {/* Revenue Chart */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Daily Revenue (Last 30 Days)</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
              <Tooltip />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Orders & Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Recent Orders</h3>
          <div className="space-y-3">
            {recentOrders?.slice(0, 5).map((o: any) => (
              <div key={o.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{o.orderNumber}</p>
                  <p className="text-xs text-slate-500">{o.customerEmail || o.customer?.email}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{adminOrderMoney(o.total)}</span>
                  <div className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block mt-0.5 ${
                    o.paymentStatus?.toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {o.paymentStatus || 'PENDING'}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{adminAccessStatus(o).label}</p><p className="text-[10px] text-slate-500">{adminEmailStatus(o).label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Recent Security Audit Logs</h3>
          <div className="space-y-3">
            {recentAuditLogs?.slice(0, 5).map((log: any) => (
              <div key={log.logId} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs">
                <div>
                  <span className="font-semibold text-blue-600 dark:text-blue-400 mr-2">{log.eventType}</span>
                  <span className="text-slate-500">({log.source})</span>
                </div>
                <span className="text-slate-400 font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
