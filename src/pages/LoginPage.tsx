import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { authDestination, authReturnSearch } from '../services/AuthNavigation';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { AuthShell } from '../components/auth/AuthShell';
import { AsyncButton } from '../components/ui/AsyncButton';
import { Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';

export const LoginPage: React.FC = () => {
  const { signIn, isAuthenticated, currentUser, navigate, searchParams } = useApp();
  const { showToast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState(searchParams.reset === 'success'
    ? 'Password updated. Sign in with your new password.'
    : searchParams.confirmation === 'sent' ? 'Check your email to confirm your account, then sign in.' : '');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error') || searchParams.error) setErrorMessage('This confirmation link has expired or is no longer valid. Request a new email below.');
    else if (hash.get('type') === 'signup') setConfirmationMessage('Your email link has been confirmed. Sign in to get started.');
    // Confirmation does not create the website's signed-in session.
    if (window.location.hash) window.history.replaceState({}, '', window.location.pathname + window.location.search);
  }, []);
  useEffect(() => {
    if (!resendCooldown) return;
    const timer = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);
  useEffect(() => {
    if (isAuthenticated && currentUser) navigate(authDestination(searchParams?.redirect));
  }, [isAuthenticated, currentUser, navigate, searchParams]);

  async function resendConfirmation() {
    setErrorMessage(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      setErrorMessage('Enter your email address above so we can send your confirmation link.'); return;
    }
    setResendBusy(true);
    try {
      const response = await fetch('/api/auth/resend-confirmation', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier.trim().toLowerCase() }) });
      const result = await response.json();
      if (response.status === 429 || result.success) setResendCooldown(Number(result.retryAfter) || 60);
      if (result.success) setConfirmationMessage(result.message);
      else setErrorMessage(result.message || 'We could not send that email just now. Please try again shortly.');
    } catch { setErrorMessage('We could not send that email just now. Please try again shortly.'); }
    finally { setResendBusy(false); }
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErrorMessage(null);
    if (!identifier.trim()) { setErrorMessage('Please enter your email address.'); return; }
    if (!password) { setErrorMessage('Please enter your password.'); return; }
    setIsLoading(true);
    try {
      const res = await signIn(identifier.trim(), password);
      if (res.success) {
        showToast('success', 'Welcome back', 'You’re signed in and ready to go.');
        navigate(authDestination(searchParams?.redirect));
      } else {
        setErrorMessage(res.message || 'That email and password do not match. Please try again.');
        showToast('error', 'Could not sign in', res.message || 'Please check your email and password.');
      }
    } catch { setErrorMessage('We could not sign you in just now. Please try again.'); }
    finally { setIsLoading(false); }
  }

  return <AuthShell eyebrow="WELCOME BACK" title="Good to see you again." description="Sign in to find your purchases, downloads, and a little inspiration for what’s next." onBack={() => navigate('/products')}
    footer={<>New around here? <button type="button" onClick={() => navigate('/register', undefined, authReturnSearch(searchParams?.redirect))}>Create an account <ArrowRight size={13} aria-hidden="true" /></button></>}>
    <form onSubmit={handleSubmit} className="auth-form" aria-busy={isLoading || resendBusy}>
      {confirmationMessage && <Notice tone="success" className="auth-note"><p>{confirmationMessage}</p></Notice>}
      {errorMessage && <Notice tone="error" className="auth-note auth-note-error"><p id="login-error">{errorMessage}</p></Notice>}
      <fieldset disabled={isLoading || resendBusy}>
        <div><label htmlFor="login-identifier">Email address</label><div className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="login-identifier" type="email" value={identifier} onChange={e => { setIdentifier(e.target.value); setErrorMessage(null); }} placeholder="you@example.com" autoComplete="email" maxLength={254} required className="auth-input" /></div></div>
        <div><div className="auth-label-row"><label htmlFor="login-password">Password</label><button type="button" className="auth-inline-link" onClick={() => navigate('/forgot-password', undefined, authReturnSearch(searchParams?.redirect))}>Forgot password?</button></div><div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setErrorMessage(null); }} placeholder="Your password" autoComplete="current-password" maxLength={128} required className="auth-input auth-password" /><button type="button" className="auth-visibility" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
      </fieldset>
      <AsyncButton id="btn-login-submit" type="submit" busy={isLoading} busyLabel="Signing you in…" disabled={resendBusy} className="auth-submit">Sign in <ArrowRight size={17} aria-hidden="true" /></AsyncButton>
      <button type="button" disabled={isLoading || resendBusy || resendCooldown > 0} onClick={resendConfirmation} className="auth-secondary-action">{resendBusy && <Spinner size={14} />}{resendBusy ? 'Sending your confirmation…' : resendCooldown > 0 ? `Send another confirmation in ${resendCooldown}s` : 'Need another confirmation email?'}</button>
    </form>
  </AuthShell>;
};
