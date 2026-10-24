import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { authReturnSearch } from '../services/AuthNavigation';
import { AuthService } from '../services/AuthService';
import { readRecoveryLink, type RecoveryCredentials } from '../services/RecoveryLink';
import { AuthShell } from '../components/auth/AuthShell';
import { AsyncButton } from '../components/ui/AsyncButton';
import { Notice } from '../components/ui/Notice';

export const ForgotPasswordPage: React.FC = () => {
  const { navigate, searchParams } = useApp();
  const [link] = useState(() => readRecoveryLink(window.location.search, window.location.hash));
  const [recovery, setRecovery] = useState<RecoveryCredentials | null>(link.credentials);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(link.message);
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>(link.message ? 'error' : 'info');
  const [busy, setBusy] = useState(false), [resetFailed, setResetFailed] = useState(false), [cooldown, setCooldown] = useState(0);
  useLayoutEffect(() => {
    // Keep recovery credentials out of the URL, navigation history and browser storage.
    window.history.replaceState({}, '', link.cleanUrl);
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    return () => meta.remove();
  }, [link.cleanUrl]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  function requestNewLink() {
    setRecovery(null); setPassword(''); setConfirm(''); setResetFailed(false); setMessageTone('info'); setMessage('Enter your email below and we’ll send you a fresh reset link.');
    window.history.replaceState({}, '', link.cleanUrl);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (recovery && password !== confirm) { setMessageTone('error'); setMessage('Passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(recovery ? '/api/auth/reset-password' : '/api/auth/forgot-password', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recovery ? { ...recovery, password, confirmPassword: confirm } : { email: email.trim().toLowerCase() }),
      });
      const result = await response.json();
      setMessageTone(result.success ? 'success' : 'error'); setMessage(result.message || 'Please try again or request a new reset link.');
      if (response.status === 429 || (result.success && !recovery)) setCooldown(Number(result.retryAfter) || 60);
      if (recovery && !result.success && ['RECOVERY_INVALID', 'RECOVERY_RESTART'].includes(result.code)) { setResetFailed(true); setPassword(''); setConfirm(''); }
      if (result.success && recovery) {
        window.history.replaceState({}, '', link.cleanUrl); setRecovery(null); setPassword(''); setConfirm('');
        await AuthService.verifySession();
        navigate('/login', undefined, { ...authReturnSearch(searchParams?.redirect), reset: 'success' });
      }
    } catch { setMessageTone('error'); setMessage('We could not complete that request just now. Please try again.'); }
    finally { setBusy(false); }
  }
  function backToSignIn() { window.history.replaceState({}, '', link.cleanUrl); navigate('/login', undefined, authReturnSearch(searchParams?.redirect)); }

  return <AuthShell mode="recovery" eyebrow={recovery ? 'A FRESH START' : 'LET’S GET YOU BACK IN'} title={recovery ? 'Choose a new password.' : 'Forgot your password?'} description={recovery ? 'Make it something new, just for you. Use at least 8 characters.' : 'It happens. Enter your email and we’ll send you a link to choose a new password.'} onBack={() => navigate('/products')}
    footer={<button type="button" disabled={busy} onClick={backToSignIn}><ArrowLeft size={13} aria-hidden="true" /> Back to sign in</button>}>
    <form onSubmit={submit} className="auth-form" aria-busy={busy}>
      {message && <Notice tone={messageTone} className={`auth-note ${messageTone === 'error' ? 'auth-note-error' : messageTone === 'info' ? 'auth-note-info' : ''}`}><p>{message}</p></Notice>}
      <fieldset disabled={busy || resetFailed}>
        {recovery ? <>
          <div><label htmlFor="reset-password">New password</label><div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="reset-password" autoComplete="new-password" type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" className="auth-input auth-password" /><button type="button" className="auth-visibility" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
          <div><label htmlFor="reset-confirm-password">Confirm password</label><div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="reset-confirm-password" autoComplete="new-password" type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Enter your new password again" className="auth-input" /></div></div>
        </> : <div><label htmlFor="recovery-email">Email address</label><div className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="recovery-email" autoComplete="email" type="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="auth-input" /></div></div>}
      </fieldset>
      <AsyncButton type="submit" busy={busy} busyLabel={recovery ? 'Updating your password…' : 'Sending your reset link…'} disabled={resetFailed || (!recovery && cooldown > 0)} className="auth-submit">{recovery ? 'Update password' : cooldown > 0 ? `Send again in ${cooldown}s` : 'Send reset link'} {!cooldown && <ArrowRight size={17} aria-hidden="true" />}</AsyncButton>
      {recovery ? <button type="button" disabled={busy} className="auth-secondary-action" onClick={requestNewLink}>Request a new reset link</button> : <p className="auth-helper auth-center">Check your inbox and spam folder after requesting a link.</p>}
    </form>
  </AuthShell>;
};
