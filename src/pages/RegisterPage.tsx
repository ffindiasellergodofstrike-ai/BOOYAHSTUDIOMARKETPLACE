import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react';
import { authDestination, authReturnSearch } from '../services/AuthNavigation';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { AuthShell } from '../components/auth/AuthShell';
import { AsyncButton } from '../components/ui/AsyncButton';
import { Notice } from '../components/ui/Notice';

export const RegisterPage: React.FC = () => {
  const { register, isAuthenticated, currentUser, navigate, searchParams } = useApp();
  const { showToast } = useToast();
  const [name, setName] = useState(''), [mobile, setMobile] = useState(''), [email, setEmail] = useState('');
  const [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false), [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    if (isAuthenticated && currentUser) navigate(authDestination(searchParams?.redirect));
  }, [isAuthenticated, currentUser, navigate, searchParams]);
  function handleMobileChange(e: React.ChangeEvent<HTMLInputElement>) { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); setErrorMessage(null); }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErrorMessage(null);
    if (!name.trim() || name.trim().length < 2) { setErrorMessage('Please enter your full name (at least 2 characters).'); return; }
    if (!/^[6-9][0-9]{9}$/.test(mobile)) { setErrorMessage('Please enter a valid 10-digit Indian mobile number.'); return; }
    if (!email.trim() || !email.includes('@') || !email.includes('.')) { setErrorMessage('Please enter a valid email address.'); return; }
    if (!password || password.length < 8) { setErrorMessage('Choose a password with at least 8 characters.'); return; }
    if (password !== confirmPassword) { setErrorMessage('Your passwords do not match. Please check them and try again.'); return; }
    setIsLoading(true);
    try {
      const res = await register({ name: name.trim(), mobile: mobile.trim(), email: email.trim().toLowerCase(), password, confirmPassword });
      if (res.success) {
        showToast('success', 'Check your email', res.message || 'Confirm your email, then sign in.');
        navigate('/login', undefined, { ...authReturnSearch(searchParams?.redirect), confirmation: 'sent' });
      } else {
        setErrorMessage(res.message || 'We could not create your account. Please check your details.');
        showToast('error', 'Could not create your account', res.message || 'Please check your details and try again.');
      }
    } catch { setErrorMessage('We could not create your account just now. Please try again.'); }
    finally { setIsLoading(false); }
  }
  return <AuthShell mode="register" eyebrow="LET’S MAKE SOMETHING GOOD" title="Create your account." description="Create your account to keep your favorite finds and purchases in one place." onBack={() => navigate('/products')}
    footer={<>Already have an account? <button type="button" onClick={() => navigate('/login', undefined, authReturnSearch(searchParams?.redirect))}>Sign in <ArrowRight size={13} aria-hidden="true" /></button></>}>
    <form onSubmit={handleSubmit} className="auth-form" aria-busy={isLoading}>
      {errorMessage && <Notice tone="error" className="auth-note auth-note-error"><p>{errorMessage}</p></Notice>}
      <fieldset disabled={isLoading}>
        <div><label htmlFor="reg-name">Full name</label><div className="auth-input-wrap"><UserRound size={17} aria-hidden="true" /><input id="reg-name" type="text" autoComplete="name" value={name} onChange={e => { setName(e.target.value); setErrorMessage(null); }} placeholder="Your name" minLength={2} maxLength={100} required className="auth-input" /></div></div>
        <div><label htmlFor="reg-email">Email address</label><div className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="reg-email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setErrorMessage(null); }} placeholder="you@example.com" maxLength={254} required className="auth-input" /></div></div>
        <div><label htmlFor="reg-mobile">Mobile number</label><div className="auth-input-wrap"><Phone size={17} aria-hidden="true" /><input id="reg-mobile" aria-describedby="reg-mobile-hint" type="tel" autoComplete="tel-national" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={mobile} onChange={handleMobileChange} placeholder="10-digit Indian mobile number" required className="auth-input" /></div><p id="reg-mobile-hint" className="auth-helper">A contact number for your orders.</p></div>
        <div className="auth-input-grid">
          <div><label htmlFor="reg-password">Password</label><div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="reg-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={e => { setPassword(e.target.value); setErrorMessage(null); }} placeholder="At least 8 characters" required className="auth-input auth-password" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="auth-visibility">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
          <div><label htmlFor="reg-confirm-password">Confirm password</label><div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="reg-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setErrorMessage(null); }} placeholder="Enter it again" required className="auth-input" /></div></div>
        </div>
      </fieldset>
      <AsyncButton id="btn-register-submit" type="submit" busy={isLoading} busyLabel="Creating your account…" className="auth-submit">Create an account <ArrowRight size={17} aria-hidden="true" /></AsyncButton>
      <p className="auth-helper auth-center">We’ll email you a link to confirm it’s you.</p>
    </form>
  </AuthShell>;
};
