import type { CheckoutProvider } from '../config/checkout';

/** Treat even server checkout URLs as untrusted until their provider host is checked. */
export function approvedHostedCheckoutUrl(value: unknown, provider: CheckoutProvider, environment: string): string {
  if (typeof value !== 'string') throw new Error('The payment provider did not return a checkout link.');
  const url = new URL(value);
  const hosts = provider === 'easebuzz' ? (environment === 'live' ? ['pay.easebuzz.in'] : ['testpay.easebuzz.in'])
    : provider === 'cashfree' ? (environment === 'live' ? ['payments.cashfree.com', 'api.cashfree.com'] : ['payments-test.cashfree.com', 'sandbox.cashfree.com'])
      : ['rzp.io', 'razorpay.com', 'api.razorpay.com'];
  if (!['live', 'test'].includes(environment) || url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname) || (provider === 'easebuzz' && !/^\/pay\/[a-f0-9]{64}$/i.test(url.pathname))) throw new Error('The payment checkout link could not be verified.');
  return url.toString();
}

const scripts = new Map<string, Promise<void>>();
export function loadGatewaySdk(provider: 'cashfree' | 'razorpay') {
  const globalName = provider === 'cashfree' ? 'Cashfree' : 'Razorpay';
  if ((window as any)[globalName]) return Promise.resolve();
  const existing = scripts.get(provider); if (existing) return existing;
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = provider === 'cashfree' ? 'https://sdk.cashfree.com/js/v3/cashfree.js' : 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('Payment checkout took too long to load. Please retry.')); }, 15000);
    script.onload = () => { window.clearTimeout(timer); (window as any)[globalName] ? resolve() : reject(new Error('Payment checkout is unavailable.')); };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error('Payment checkout could not load. Please retry.')); };
    document.head.appendChild(script);
  }).catch(error => { scripts.delete(provider); throw error; });
  scripts.set(provider, pending); return pending;
}
