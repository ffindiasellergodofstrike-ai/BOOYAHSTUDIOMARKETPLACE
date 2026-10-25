import React, { useState } from 'react';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { policyData, SUPPORTED_POLICY_SLUGS } from '../data/policyData';
import { BUSINESS } from '../config/business';
import { Brand } from './Brand';
import { useApp } from '../context/AppContext';
import { Spinner } from './ui/Spinner';
import { useToast } from '../context/ToastContext';

export const Footer: React.FC = () => {
  const { navigate } = useApp();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);

  const handleSubscribe = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error('Subscription failed');
      setSubscribed(true);
      setEmail('');
    } catch {
      showToast('error', 'Could not subscribe', 'Please try again in a moment.');
    } finally {
      setPending(false);
    }
  };

  const exploreLinks = [
    { label: 'All Templates', path: '/products' },
    { label: 'Meet the creators', path: '/creators' },
    { label: 'Start selling', path: '/pricing' },
    { label: 'My memberships', path: '/memberships' },
    { label: 'Your Wishlist', path: '/wishlist' },
    { label: 'My Account', path: '/account' },
    { label: 'Help & FAQs', path: '/faq' },
    { label: 'Our Story', path: '/about' },
    { label: 'Contact & Support', path: '/contact' },
  ];

  const policyLinks = [
    ...SUPPORTED_POLICY_SLUGS.map(slug => ({ label: policyData[slug].title, path: `/policies/${slug}` })),
    { label: 'Digital delivery', path: '/policies/delivery' },
    { label: 'Copyright & usage', path: '/policies/copyright' },
  ];

  return (
    <footer className="studio-footer" aria-label="Store Footer">
      <div className="studio-container">
        <div className="footer-main">
          {/* Brand & Contact Column */}
          <div className="footer-brand-column">
            <button
              className="studio-brand"
              onClick={() => navigate('/')}
              aria-label="BooyahMarket Home"
            >
              <Brand />
            </button>
            <p>
              Thoughtful digital goods.
              <br />
              For the things you haven’t built yet.
            </p>
            <address className="not-italic text-xs leading-6 mt-4 text-slate-600">
              {BUSINESS.owner}, Owner of {BUSINESS.name}
              {BUSINESS.legalName ? ` · ${BUSINESS.legalName}` : ''}
              {BUSINESS.gstin ? <><br />GSTIN: {BUSINESS.gstin}</> : null}
              <br />
              {BUSINESS.address}
              <br />
              <a href={`mailto:${BUSINESS.email}`} className="hover:underline">
                {BUSINESS.email}
              </a>
              <br />
              <a href={BUSINESS.phoneHref} className="hover:underline">
                {BUSINESS.phone}
              </a>
              <br />
              <span className="text-xs text-slate-500">
                Customer support and grievances via the email and WhatsApp above.
                <br />Grievance contact: {BUSINESS.owner}, at the same email and address.
              </span>
            </address>
            <span className="footer-made">A little inspiration. A lot of possibility.</span>
          </div>

          {/* Explore Column */}
          <div className="footer-link-column">
            <h3>Explore</h3>
            <nav aria-label="Explore store navigation">
              {exploreLinks.map((link) => (
                <button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  className="footer-nav-link"
                >
                  {link.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Current store policies and delivery / license details */}
          <div className="footer-link-column">
            <h3>Policies</h3>
            <nav aria-label="Store policies">
              {policyLinks.map((policy) => (
                <button
                  key={policy.path}
                  onClick={() => navigate(policy.path)}
                  className="footer-nav-link"
                >
                  {policy.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Newsletter Column */}
          <div className="footer-newsletter">
            <h3>A little good stuff in your inbox.</h3>
            <p>New templates, fresh ideas. Only the good things.</p>
            {subscribed ? (
              <p className="newsletter-success" role="status">
                <Check size={17} /> You’re on the list. Stay inspired.
              </p>
            ) : (
              <form onSubmit={handleSubscribe}>
                <label className="sr-only" htmlFor="newsletter-email">
                  Email address
                </label>
                <input
                  id="newsletter-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Your email address"
                  value={email}
                  disabled={pending}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  disabled={pending}
                  aria-busy={pending}
                  aria-label={pending ? 'Subscribing' : 'Subscribe to product updates'}
                >
                  {pending ? <Spinner size={18} /> : <ArrowRight size={18} />}
                </button>
              </form>
            )}

            <div className="footer-delivery-note">
              <ShieldCheck className="w-4 h-4 text-[#456331] shrink-0 mt-0.5" />
              <span>
                Digital downloads, made for your next project. Your files are available in your account after payment is confirmed.
              </span>
            </div>
          </div>
        </div>

        {/* Footer Bottom Bar - Organized, readable, no duplicate links */}
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {BUSINESS.owner} · {BUSINESS.name}. All rights reserved.
          </span>
          <div className="footer-bottom-badges">
            <span>India Store</span>
            <span aria-hidden="true">·</span>
            <span>All Prices in INR (₹)</span>
            <span aria-hidden="true">·</span>
            <span>Electronic Delivery Only</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
