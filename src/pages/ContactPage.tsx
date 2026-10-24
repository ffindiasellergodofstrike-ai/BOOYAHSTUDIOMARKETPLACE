import React, { useRef, useState } from 'react';
import { ArrowUpRight, Check, Download, Mail, MessageCircle, Send } from 'lucide-react';
import { BUSINESS } from '../config/business';
import { AsyncButton } from '../components/ui/AsyncButton';
import { useApp } from '../context/AppContext';
import '../styles/content.css';

export const ContactPage: React.FC = () => {
  const { navigate } = useApp();
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [message, setMessage] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<{ reference: string; submittedAt: string; name: string; email: string; message: string } | null>(null);
  const inFlight = useRef(false);
  function downloadReceipt() {
    if (!receipt) return;
    const copy = `${BUSINESS.name} — support request\nReference: ${receipt.reference}\nSubmitted: ${receipt.submittedAt}\nName: ${receipt.name}\nEmail: ${receipt.email}\n\n${receipt.message}\n\nGrievance contact: ${BUSINESS.owner}\n${BUSINESS.email}\n${BUSINESS.address}\nWhatsApp: ${BUSINESS.phone} (${BUSINESS.phoneHref})\n`;
    const url = URL.createObjectURL(new Blob([copy], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${receipt.reference}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim() || message.trim().length < 10) { setError('Please add your name and a message of at least 10 characters.'); return; }
    inFlight.current = true; setPending(true); setError(''); setReference(''); setReceipt(null);
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }), signal: AbortSignal.timeout(25000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || typeof body.reference !== 'string') throw new Error(body?.message || 'Your message could not be sent. Please try again.');
      setReference(body.reference);
      if (body.receipt?.reference === body.reference && typeof body.receipt.message === 'string') setReceipt(body.receipt);
      setMessage('');
    } catch (failure) { setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'We couldn’t send your message just now. Please try again or email us directly.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div className="content-page contact-page">
    <header className="content-intro"><span className="content-kicker">LET’S TALK</span><h1>A little help,<br /><em>right this way.</em></h1><p className="content-lead">Have a question about a template or your order?<br />We’re here to help you find your next step.</p></header>
    <div className="contact-layout">
      <aside className="contact-aside">
        <a className="contact-channel" href={'mailto:' + BUSINESS.email}><span className="contact-channel-icon"><Mail size={23} strokeWidth={1.6} /></span><span><strong>Drop us a line</strong><span>{BUSINESS.email}</span></span><ArrowUpRight size={18} /></a>
        <a className="contact-channel" href={BUSINESS.phoneHref} target="_blank" rel="noopener noreferrer"><span className="contact-channel-icon"><MessageCircle size={23} strokeWidth={1.6} /></span><span><strong>Find us on WhatsApp</strong><span>{BUSINESS.phone}</span></span><ArrowUpRight size={18} /></a>
        <div className="contact-help-note"><h2>Before you send</h2><p>For an order or download question, include your order number and the email you used at checkout.</p><button type="button" className="content-text-link" onClick={() => navigate('/faq')}>Browse helpful answers <ArrowUpRight size={16} /></button></div>
        <details open className="contact-business"><summary>Business & grievance details</summary><address>{BUSINESS.owner}, Owner of {BUSINESS.name}{BUSINESS.legalName ? <><br />{BUSINESS.legalName}</> : null}{BUSINESS.gstin ? <><br />GSTIN: {BUSINESS.gstin}</> : null}<br />{BUSINESS.address}</address><p>Customer support and grievances: <a href={'mailto:' + BUSINESS.email}>{BUSINESS.email}</a><br />WhatsApp: <a href={BUSINESS.phoneHref} target="_blank" rel="noopener noreferrer">{BUSINESS.phone}</a></p><p>Grievance contact: {BUSINESS.owner}, at the same email and address. We acknowledge complaints within 48 hours and resolve them within one month, or any shorter period required by applicable law.</p></details>
      </aside>
      <section className="contact-form-card" aria-label="Send a message">
        <div className="contact-form-heading"><span className="content-kicker">YOUR MESSAGE</span><h2>What can we help with?</h2><p>Tell us a little about it below.</p></div>
        {reference && <div className="content-notice content-notice-success" role="status"><Check size={20} /><div><strong>Thanks, your message is with us.</strong><p>Your reference is <b>{reference}</b>. Keep it handy if you need to follow up.</p>{receipt && <><button type="button" className="content-text-link" onClick={downloadReceipt}><Download size={15} /> Save a copy of your message</button><details className="support-receipt-preview"><summary>View your message</summary><p>{receipt.message}</p></details></>}</div></div>}
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending} className="contact-fields"><div className="contact-field-row"><label htmlFor="support-name">Your name<input id="support-name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} autoComplete="name" placeholder="Your full name" /></label><label htmlFor="support-email">Email address<input id="support-email" required type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></label></div><label htmlFor="support-message">Your message<textarea id="support-message" required minLength={10} maxLength={4000} rows={6} value={message} onChange={event => setMessage(event.target.value)} placeholder="I have a question about…" aria-describedby="support-message-hint" /></label><div className="contact-message-hint"><span id="support-message-hint">A few details help us help you.</span><span>{message.length.toLocaleString()} / 4,000</span></div></fieldset>
          {error && <div className="content-notice content-notice-error" role="alert"><p>{error} You can also <a href={'mailto:' + BUSINESS.email}>email us directly</a>.</p></div>}
          <div className="contact-form-footer"><p>We’ll use your email to follow up on this request.</p><AsyncButton type="submit" busy={pending} busyLabel="Sending your message…" className="content-button">Send message <Send size={16} /></AsyncButton></div>
        </form>
      </section>
    </div>
  </div>;
};
