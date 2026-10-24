import React, { useState } from 'react';
import { LockKeyhole, Mail, Loader2, ShieldAlert, RefreshCw } from 'lucide-react';

export type AdminAccessState = 'checking' | 'login' | 'denied' | 'error' | 'ready';
interface Props {
  state: AdminAccessState;
  message: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onRetry: () => Promise<void>;
}
/** The form authenticates with Supabase; only the server's admin endpoint grants this console. */
export const AdminAccessPanel: React.FC<Props> = ({ state, message, onSignIn, onRetry }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await onSignIn(email.trim().toLowerCase(), password); }
    finally { setPassword(''); setBusy(false); }
  }
  return <section className="min-h-[70vh] bg-slate-50 dark:bg-slate-950 px-4 py-12 flex items-center justify-center">
    <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-7 text-white">
        <LockKeyhole className="h-9 w-9 mb-3" />
        <h1 className="text-2xl font-extrabold">Admin Sign In</h1>
        <p className="text-sm text-blue-100 mt-2">Use your administrator email and password to manage your store.</p>
      </div>
      <div className="p-6 sm:p-8 space-y-5">
        {message && <div role="alert" className={`p-4 rounded-xl border text-sm flex gap-3 ${state === 'error' || state === 'denied' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
          <ShieldAlert className="w-5 h-5 shrink-0" /><p>{message}</p>
        </div>}
        <form className="space-y-5" onSubmit={submit}>
          <div><label htmlFor="admin-email" className="text-xs font-bold uppercase tracking-wider text-slate-500">Admin email</label>
            <div className="relative mt-2"><Mail className="absolute left-3.5 top-3.5 w-5 h-5 text-slate-400" /><input id="admin-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="w-full pl-11 pr-4 py-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm" placeholder="owner@example.com" /></div>
          </div>
          <div><div className="flex justify-between gap-3"><label htmlFor="admin-password" className="text-xs font-bold uppercase tracking-wider text-slate-500">Password</label><a href="/forgot-password" className="text-xs font-semibold text-blue-600 hover:underline">Forgot password?</a></div>
            <input id="admin-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm" />
          </div>
          <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Checking access…' : 'Sign in to Admin'}</button>
        </form>
        <div className="flex items-center justify-between gap-4 text-xs"><a href="/" className="text-slate-500 hover:text-blue-600">Back to store</a><button type="button" disabled={busy} onClick={() => { setBusy(true); void onRetry().finally(() => setBusy(false)); }} className="inline-flex gap-1 items-center font-semibold text-blue-600 disabled:opacity-60"><RefreshCw className="h-3.5 w-3.5" />Retry access check</button></div>
        <p className="text-xs text-slate-500">An existing customer account does not automatically have administrator access. No mobile OTP is required.</p>
      </div>
    </div>
  </section>;
};
