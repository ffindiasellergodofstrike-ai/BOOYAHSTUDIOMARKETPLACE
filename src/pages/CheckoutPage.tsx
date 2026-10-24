import { selectCustomerCheckout, type GatewayAvailability } from '../config/checkout';
import { hasLivePayment } from '../services/PaymentEnvironment';
import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  XCircle,
  Download,
  Clock,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { OrderService } from '../services/OrderService';
import { PaymentService } from '../services/PaymentService';
import { approvedHostedCheckoutUrl, loadGatewaySdk } from '../services/GatewayCheckout';
import { isVerifiedPaidOrder, verifyReturnedPayment } from '../services/PaymentVerification';
import { Order } from '../types';

import { AsyncButton } from '../components/ui/AsyncButton';
import { Spinner } from '../components/ui/Spinner';
import { Notice } from '../components/ui/Notice';
import { ArrowRight, ArrowUpRight, ShoppingBag, LifeBuoy } from 'lucide-react';
import '../styles/purchase.css';

declare global { interface Window { Razorpay: any; Cashfree: any; } }
const loadCashfreeCheckout = () => loadGatewaySdk('cashfree');
const loadRazorpayCheckout = () => loadGatewaySdk('razorpay');

export const CheckoutPage: React.FC = () => {
  const { cartItems, cartSummary, appliedCoupon, clearCart, currentUser, navigate, searchParams } = useApp();
  const { showToast } = useToast();

  // Form State
  const [customerName, setCustomerName] = useState(currentUser?.name || '');
  const [customerEmail, setCustomerEmail] = useState(currentUser?.email || '');
  const [customerPhone, setCustomerPhone] = useState(currentUser?.mobile || '');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayAvailability>({});
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [downloadBusy, setDownloadBusy] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    setConfigLoading(true); setConfigError(false);
    fetch('/api/config/payments').then(async response => {
      if (!response.ok) throw new Error('Checkout unavailable');
      const data = await response.json();
      if (!data.success || !data.gateways) throw new Error('Checkout unavailable');
      if (active) setGatewayConfig(data.gateways);
    }).catch(() => { if (active) { setGatewayConfig({}); setConfigError(true); } })
      .finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [configAttempt]);
  const paymentMethod = selectCustomerCheckout(gatewayConfig, cartItems.length === 1 && cartItems[0].quantity === 1 && cartSummary.discount === 0);
  const canCheckout = paymentMethod !== null;
  const testMode = paymentMethod ? gatewayConfig[paymentMethod]?.environment === 'test' : false;

  // Processing & Completed State
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [paymentView, setPaymentView] = useState<'checking' | 'pending' | 'failed'>(() =>
    searchParams.status === 'failed' ? 'failed' : searchParams.status === 'pending' ? 'pending' : 'checking');

  // Handle Redirect Back from Gateways
  useEffect(() => {
    let isCancelled = false;
    const status = searchParams.status;
    const orderId = searchParams.orderId;

    if ((status === 'success' || status === 'pending' || status === 'failed') && orderId) {
      let retryTimer: number | undefined;
      let lastVerificationMessage: string | undefined;
      const verificationStartedAt = Date.now();
      const canRetry = (attempt: number) => attempt < 14 && Date.now() - verificationStartedAt < 60_000;
      setVerificationError(null);
      setPaymentView(status === 'failed' ? 'failed' : status === 'pending' ? 'pending' : 'checking');

      const poll = async (attempt: number) => {
        try {
          const outcome = await verifyReturnedPayment(
            () => OrderService.fetchOrderById(orderId),
            async () => {
              const order = await OrderService.fetchOrderById(orderId);
              const provider = String(order?.paymentProvider || '').toLowerCase();
              if (!['razorpay', 'cashfree', 'easebuzz'].includes(provider)) return { success: false, httpStatus: 409, status: 'PENDING', message: 'No payment has been initiated for this order.' };
              const response = await fetch(`/api/payments/${provider}/reconcile/${encodeURIComponent(orderId)}`, { method: 'POST', credentials: 'include', cache: 'no-store' });
              const result = await response.json();
              return { ...result, httpStatus: response.status };
            },
          );
          if (isCancelled) return;
          if (outcome.kind === 'auth_required') {
            setPaymentView(status === 'failed' ? 'failed' : 'pending');
            setVerificationError('Your session expired. Please sign in and check the order in your account.');
            return;
          }
          if (outcome.kind === 'paid') {
            setCompletedOrder(outcome.order);
            clearCart();
            try {
              if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
            } catch {}
            showToast('success', hasLivePayment(outcome.order) ? 'Payment confirmed' : 'Payment check complete', hasLivePayment(outcome.order) ? 'Your payment is confirmed.' : 'This transaction did not create a purchase.');
            return;
          }
          if (outcome.kind === 'failed') {
            setPaymentView('failed');
            setVerificationError(outcome.message);
            if (attempt < 3 && canRetry(attempt)) {
              retryTimer = window.setTimeout(() => { void poll(attempt + 1); }, 2000);
            }
            return;
          }
          setPaymentView((current) => status === 'failed' && current === 'failed' ? 'failed' : 'pending');
          if (canRetry(attempt)) {
            lastVerificationMessage = outcome.message || lastVerificationMessage;
            retryTimer = window.setTimeout(() => { void poll(attempt + 1); }, 2000);
          } else {
            setVerificationError(outcome.message || lastVerificationMessage ||
              'Payment is still pending. Check again or view the order in your account.');
          }
        } catch {
          if (isCancelled) return;
          setPaymentView(status === 'failed' ? 'failed' : 'pending');
          if (canRetry(attempt)) {
            retryTimer = window.setTimeout(() => { void poll(attempt + 1); }, 2000);
          } else {
            setVerificationError('We could not get the latest result yet. Your order will update automatically once payment is verified.');
          }
        }
      };

      void poll(0);
      return () => {
        isCancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    }
  }, [searchParams.status, searchParams.orderId]);

  useEffect(() => {
    if (!completedOrder || completedOrder.deliveryStatus === 'REVOKED' ||
        ((isVerifiedPaidOrder(completedOrder) || !hasLivePayment(completedOrder)) && completedOrder.emailDelivery?.status)) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (++attempts > 20) {
        window.clearInterval(timer);
        return;
      }
      void OrderService.fetchOrderById(completedOrder.id).then((latest) => {
        if (latest?.paymentStatus === 'PAID') setCompletedOrder(latest);
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [completedOrder?.id, completedOrder?.deliveryStatus, completedOrder?.emailDelivery?.status]);

  // Sync customer form data when currentUser is loaded
  useEffect(() => {
    if (currentUser) {
      if (!customerName) setCustomerName(currentUser.name || '');
      setCustomerEmail(currentUser.email || '');
      if (!customerPhone) setCustomerPhone(currentUser.mobile || '');
    }
  }, [currentUser]);

  const handleProcessCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    if (!agreeTerms) {
      showToast('error', 'Terms Required', 'Please accept the terms and purchase policies before continuing.');
      return;
    }
    if (cartItems.length === 0) {
      showToast('error', 'Cart Empty', 'Add products to your cart before proceeding.');
      return;
    }

    if (!canCheckout) { showToast('info', 'Checkout unavailable', 'Online checkout is temporarily unavailable. Please contact us for help.'); return; }
    setIsProcessing(true);

    try {
      const sanitizedPhone = (customerPhone || '').replace(/\D/g, '').slice(-10);

      if (!/^[6-9]\d{9}$/.test(sanitizedPhone)) throw new Error('Enter a valid 10-digit Indian contact number.');
      if (paymentMethod === 'easebuzz') {
        const pendingOrder = await OrderService.createPendingOrderAsync(cartItems,
          { fullName: customerName, email: customerEmail, country: 'India', phone: sanitizedPhone },
          cartSummary.discount, appliedCoupon?.code, 'Easebuzz');
        const init = await PaymentService.initiateEasebuzzPayment(pendingOrder.id, agreeTerms);
        if (!init.success) throw new Error(init.message || 'Could not open checkout.');
        window.location.assign(approvedHostedCheckoutUrl(init.url, 'easebuzz', init.environment));
        return;
      }
      if (paymentMethod === 'cashfree') {
        await loadCashfreeCheckout();
        const pendingOrder = await OrderService.createPendingOrderAsync(cartItems,
          { fullName: customerName, email: customerEmail, country: 'India', phone: sanitizedPhone } as any,
          cartSummary.discount, appliedCoupon?.code, 'Cashfree');
        const init = await PaymentService.initiateCashfreePayment(pendingOrder.id, agreeTerms);
        if (init.alreadyPaid) { window.location.href = `/checkout?status=pending&orderId=${encodeURIComponent(pendingOrder.id)}`; return; }
        if (!init.success || !init.paymentSessionId) throw new Error(init.message || 'Could not open checkout.');
        // All completion, cancellation and error outcomes are reconciled by the server.
        try {
          await window.Cashfree({ mode: init.mode }).checkout({ paymentSessionId: init.paymentSessionId, redirectTarget: '_modal' });
        } finally {
          window.location.href = `/checkout?status=pending&orderId=${encodeURIComponent(pendingOrder.id)}`;
        }
        return;
      }
      await loadRazorpayCheckout();
      const pendingOrder = await OrderService.createPendingOrderAsync(cartItems,
        { fullName: customerName, email: customerEmail, country: 'India', phone: sanitizedPhone } as any,
        cartSummary.discount, appliedCoupon?.code, 'Razorpay');
      const init = await PaymentService.initiateRazorpayPayment(pendingOrder.id, agreeTerms);
      if (!init.success) throw new Error(init.message || 'Could not open checkout.');
      const checkout = new window.Razorpay({
        key: init.key, order_id: init.razorpayOrderId, amount: init.amount, currency: init.currency,
        name: 'Booyahstudio', description: `Digital products · ${pendingOrder.id}`,
        prefill: { name: customerName, email: customerEmail, contact: sanitizedPhone },
        modal: { ondismiss: () => { setIsProcessing(false); void fetch('/api/payments/razorpay/checkout-closed', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: pendingOrder.id }) }).catch(() => undefined); } },
        handler: async (response: any) => {
          try {
            await fetch('/api/payments/razorpay/verify', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: pendingOrder.id, ...response }) });
          } finally { window.location.href = `/checkout?status=pending&orderId=${encodeURIComponent(pendingOrder.id)}`; }
        },
      });
      checkout.on('payment.failed', () => { setIsProcessing(false); showToast('error', 'Payment incomplete', 'Check your order before trying again if your account was debited.'); });
      checkout.open();
    } catch (err: any) {
      setIsProcessing(false);
      showToast('error', 'Checkout Error', err.message || 'We could not open checkout. Please contact support.');
    }
  };

  const handleSecureDownload = async (productId: string, defaultName: string) => {
    if (downloadBusy[productId]) return;
    setDownloadBusy(current => ({ ...current, [productId]: true }));
    try {
      const res = await OrderService.requestDownloadToken(productId, completedOrder?.id);
      if (res.success && res.downloadUrl) {
        showToast('success', 'Download link ready', `Your browser can now download ${defaultName}.`);
        const a = document.createElement('a');
        a.href = res.downloadUrl;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        showToast('error', 'Download unavailable', 'We could not prepare your download. Check your order in your account or contact support.');
      }
    } catch (err) {
      showToast('error', 'Download unavailable', 'We could not prepare your file. Please try again.');
    } finally { setDownloadBusy(current => ({ ...current, [productId]: false })); }
  };

  if (completedOrder && !hasLivePayment(completedOrder)) {
    return <section className="purchase-page purchase-empty"><span className="purchase-empty-icon"><ShieldCheck size={30} /></span><span className="purchase-eyebrow">PAYMENT UPDATE</span><h1>Payment check<br /><em>complete.</em></h1><p>This transaction did not create a purchase. No files, download access, purchase invoice, or purchase-confirmation email will be issued. Contact us if you need help with a payment shown on your bank statement.</p><p className="purchase-reference">Reference: {completedOrder.orderNumber}</p><button className="purchase-button purchase-button-primary" onClick={() => navigate('/account')}>View your account <ArrowRight size={17} /></button></section>;
  }

  if (completedOrder) {
    const deliveryReady = isVerifiedPaidOrder(completedOrder);
    const emailStatus = completedOrder.emailDelivery?.providerStatus === 'delivered'
      ? 'Your confirmation email has been delivered.'
      : ['bounced', 'failed', 'complained', 'suppressed'].includes(completedOrder.emailDelivery?.providerStatus || '') || ['failed', 'not_configured'].includes(completedOrder.emailDelivery?.status || '')
        ? 'We could not deliver your email. Your purchases are still saved in your account.'
        : completedOrder.emailDelivery?.status === 'sent' ? 'Your confirmation email is on its way.' : 'We’re preparing your confirmation email. Your order is saved in your account.';
    return <section className="purchase-page checkout-result">
      <div className="checkout-thankyou"><span className="checkout-success-icon"><CheckCircle2 size={34} /></span><span className="purchase-eyebrow">A GOOD IDEA, MADE YOURS</span><h1>{deliveryReady ? <>Your next chapter<br />starts <em>here.</em></> : <>You’re all <em>paid up.</em></>}</h1><p>{deliveryReady ? 'Thank you for your purchase. Your files are ready whenever you are.' : 'Your payment is confirmed. We’re getting your files ready.'}</p><div className="checkout-reference"><span>Order <strong>{completedOrder.orderNumber}</strong></span><span>Total paid <strong>₹{completedOrder.total.toFixed(2)}</strong></span></div><p className="checkout-email-status">{emailStatus}</p></div>
      {!deliveryReady && <Notice tone="info">Your files are being prepared. Check your account shortly for downloads and your receipt.</Notice>}
      {deliveryReady && <div className="purchase-bag"><div className="purchase-card-heading"><div><span className="purchase-eyebrow">READY FOR WHAT’S NEXT</span><h2>Your downloads</h2></div><Download size={21} /></div>
        <div className="checkout-download-list">{completedOrder.items.map((item, idx) => {
          const productId = item.productId || item.product?.id;
          const fileName = `${item.product?.slug || item.productSlug || item.productId}-v${item.product?.version || item.version || '1.0'}.zip`;
          const restricted = item.refunded === true || (item as any).accessStatus === 'restricted' || (item as any).downloadStatus === 'REVOKED';
          return <article className="checkout-download" key={`${productId}-${idx}`}><div><span className="purchase-eyebrow">{item.product?.categoryLabel || item.category || 'Digital product'}</span><h3>{item.product?.title || item.productTitle}</h3><p>{item.product?.fileSize || item.fileSize || 'Downloadable files'}{item.product?.version || item.version ? ` · Version ${item.product?.version || item.version}` : ''}</p></div><AsyncButton id={`download-archive-btn-${idx}`} className="purchase-button purchase-button-primary" busy={Boolean(downloadBusy[productId])} busyLabel="Preparing…" disabled={restricted} onClick={() => handleSecureDownload(productId, fileName)}>{restricted ? 'Access unavailable' : <><Download size={17} />Download</>}</AsyncButton></article>;
        })}</div>
        <div className="checkout-result-footer"><button className="purchase-text-link" onClick={() => navigate('/account')}>View your orders & receipt <ArrowRight size={16} /></button><button className="purchase-button purchase-button-secondary" onClick={() => navigate('/products')}>Keep exploring <ArrowUpRight size={17} /></button></div>
      </div>}
      <div className="purchase-summary-help"><LifeBuoy size={20} /><div><strong>A question about your order?</strong><button onClick={() => navigate('/contact')}>We’re here to help <ArrowUpRight size={14} /></button></div></div>
    </section>;
  }

  // The URL is a hint; order and gateway state decide the visible result.
  const isReturningFromGateway = ['success', 'pending', 'failed'].includes(searchParams.status || '') && Boolean(searchParams.orderId);
  if (isReturningFromGateway) {
    const failed = paymentView === 'failed';
    const checking = paymentView === 'checking';
    return <section className="purchase-page purchase-empty checkout-status" aria-busy={checking}><span className={`purchase-empty-icon ${failed ? 'checkout-status-failed' : ''}`}>{failed ? <XCircle size={32} /> : checking ? <Spinner size={32} /> : <Clock size={32} />}</span><span className="purchase-eyebrow">YOUR ORDER UPDATE</span><h1>{failed ? <>Payment wasn’t<br /><em>completed.</em></> : checking ? <>Checking your<br /><em>payment.</em></> : <>Waiting for<br /><em>confirmation.</em></>}</h1><p>{failed ? 'Your payment was not completed. If your account was debited, your saved order will update when the payment provider confirms the final result.' : checking ? 'We’re getting the latest payment result for your order. This usually takes a moment.' : 'Your bank hasn’t confirmed this payment yet. This page updates automatically when we receive the result.'}</p>{verificationError && <Notice tone={failed ? 'error' : 'info'}>{verificationError}</Notice>}<button className="purchase-button purchase-button-primary" onClick={() => navigate('/account')}>View your orders <ArrowRight size={17} /></button><p className="purchase-reference">Order: {searchParams.orderId}</p></section>;
  }

  if (!currentUser) return <section className="purchase-page purchase-empty"><span className="purchase-empty-icon"><ShoppingBag size={31} /></span><span className="purchase-eyebrow">ONE STEP CLOSER</span><h1>Make it<br /><em>yours.</em></h1><p>Sign in or create an account to complete your order. Your downloads and receipts will be saved in one place.</p><div className="account-welcome-actions"><button onClick={() => navigate('/login', undefined, { redirect: 'checkout' })} className="purchase-button purchase-button-primary">Sign in <ArrowRight size={17} /></button><button onClick={() => navigate('/register', undefined, { redirect: 'checkout' })} className="purchase-button purchase-button-secondary">Create an account <ArrowUpRight size={17} /></button></div><button className="purchase-text-link" onClick={() => navigate('/cart')}>Back to your bag</button></section>;

  if (!cartItems.length) return <section className="purchase-page purchase-empty"><span className="purchase-empty-icon"><ShoppingBag size={32} /></span><span className="purchase-eyebrow">YOUR NEXT IDEA IS OUT THERE</span><h1>A fresh<br /><em>start.</em></h1><p>Your bag is empty. Find something you’d love to build with before checking out.</p><button className="purchase-button purchase-button-primary" onClick={() => navigate('/products')}>Explore the collection <ArrowUpRight size={17} /></button></section>;

  return <section className="purchase-page checkout-page">
    <div className="purchase-page-heading"><div><span className="purchase-eyebrow">THE START OF SOMETHING GOOD</span><h1>Make it yours<span>.</span></h1><p>A few details, then you’re ready to create.</p></div><button className="purchase-text-link" onClick={() => navigate('/cart')}>Back to your bag <ShoppingBag size={17} /></button></div>
    <div className="purchase-two-column">
      <form onSubmit={handleProcessCheckout} className="checkout-form" aria-busy={isProcessing}>
        <fieldset disabled={isProcessing} className="checkout-fieldset">
          <div className="checkout-card"><div className="checkout-step-heading"><span>01</span><div><h2>Your details</h2><p>Your receipt and order updates will come here.</p></div></div><div className="checkout-fields">
            <div><label htmlFor="checkout-name">Full name</label><input type="text" id="checkout-name" autoComplete="name" required value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Your full name" /></div>
            <div><label htmlFor="checkout-email">Email address</label><input type="email" id="checkout-email" autoComplete="email" required readOnly value={customerEmail} /><p className="checkout-input-help">The email linked to your account.</p></div>
            <div><label htmlFor="checkout-phone">Mobile number</label><div className="checkout-phone-field"><span>+91</span><input type="tel" id="checkout-phone" autoComplete="tel-national" inputMode="numeric" required pattern="[6-9][0-9]{9}" value={customerPhone} onChange={e => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" /></div></div>
            <div><span className="checkout-field-label">Billing country</span><div className="checkout-readonly">India <span>INR ₹</span></div></div>
          </div></div>
          <div className="checkout-card"><div className="checkout-step-heading"><span>02</span><div><h2>The final step</h2><p>Review your order, then continue to payment.</p></div></div>
            <div className="checkout-payment-note"><span><Lock size={19} /></span><div><strong>Secure online payment</strong><p>Choose from the available payment options on the next screen. You’ll see your total before paying.</p></div></div>
            {testMode && <Notice tone="info">Test checkout: no real payment or product access is created.</Notice>}
            {configLoading ? <div className="checkout-config-status" role="status"><Spinner size={17} />Loading payment options…</div> : !canCheckout && <Notice tone="info"><div>{configError ? 'We couldn’t load payment options. ' : 'Online checkout is temporarily unavailable. '}{configError && <button type="button" className="purchase-text-link" onClick={() => setConfigAttempt(value => value + 1)}>Try again</button>}<button type="button" onClick={() => navigate('/contact')} className="purchase-text-link">Contact us for help</button></div></Notice>}
            <p className="checkout-delivery-policy">Your files become available in your account after payment confirmation. Digital purchases generally cannot be refunded for a change of mind after access is delivered. Non-delivery, defects, and duplicate charges remain covered by our policies.</p>
            <div className="checkout-consent"><input type="checkbox" id="agree-terms" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} required /><label htmlFor="agree-terms">I agree to the <button type="button" onClick={() => navigate('/policies/terms')}>Terms & Conditions</button>, <button type="button" onClick={() => navigate('/policies/refund')}>Refund & Cancellation Policy</button>, <button type="button" onClick={() => navigate('/policies/cancellation')}>Cancellation Policy</button>, and <button type="button" onClick={() => navigate('/policies/delivery')}>Digital Delivery Policy</button>. I have read the <button type="button" onClick={() => navigate('/policies/privacy')}>Privacy Policy</button> and understand that digital delivery begins after payment confirmation.</label></div>
          </div>
        </fieldset>
        <AsyncButton id="submit-order-btn" type="submit" className="purchase-button purchase-button-primary purchase-button-full checkout-submit" busy={isProcessing || configLoading} busyLabel={configLoading ? 'Loading payment options…' : 'Opening checkout…'} disabled={!canCheckout || !agreeTerms}>{!canCheckout ? 'Checkout temporarily unavailable' : <>Continue to payment · ₹{cartSummary.total.toFixed(2)} <ArrowRight size={18} /></>}</AsyncButton>
        <p className="purchase-summary-note"><Lock size={14} />Your payment details are handled by the payment provider.</p>
      </form>
      <aside className="purchase-summary"><span className="purchase-eyebrow">ONE GOOD CHOICE AFTER ANOTHER</span><h2>Your order <span className="checkout-item-count">{cartItems.length}</span></h2><div className="checkout-summary-items">{cartItems.map(item => <div key={item.product.id}><div><strong>{item.product.title}</strong><span>Qty: {item.quantity}</span></div><strong>₹{(item.price * item.quantity).toFixed(2)}</strong></div>)}</div><dl className="purchase-totals"><div><dt>Subtotal</dt><dd>₹{cartSummary.subtotal.toFixed(2)}</dd></div>{cartSummary.discount > 0 && <div className="purchase-discount"><dt>Discount ({appliedCoupon?.code})</dt><dd>−₹{cartSummary.discount.toFixed(2)}</dd></div>}<div><dt>Digital delivery</dt><dd>No extra charge</dd></div><div className="purchase-grand-total"><dt>Total</dt><dd>₹{cartSummary.total.toFixed(2)}</dd></div></dl><div className="purchase-summary-help"><Download size={19} /><div><strong>Ready for your next project.</strong><p>Find your files in your account after payment is confirmed. We’ll also send an order email.</p></div></div><div className="purchase-summary-help"><LifeBuoy size={19} /><div><strong>Need a hand?</strong><button onClick={() => navigate('/contact')}>Get in touch <ArrowUpRight size={14} /></button></div></div></aside>
    </div>
  </section>;
};
