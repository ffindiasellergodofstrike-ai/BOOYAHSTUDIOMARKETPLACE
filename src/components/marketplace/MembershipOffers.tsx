import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { authReturnSearch } from '../../services/AuthNavigation';
import { SubscriptionService, type SubscriptionCheckout, type SubscriptionSummary } from '../../services/SubscriptionService';
import { Modal } from '../Modal';
import { openSubscriptionCheckout } from '../../services/SubscriptionCheckout';
import { AsyncButton } from '../ui/AsyncButton';
import { Notice } from '../ui/Notice';
import { MarketError, MarketLoading, marketplaceMoney, StatusPill } from './MarketplaceShared';

export interface MarketPlan { checkoutQuote?: string; id: string; name: string; description: string; audience: 'creator' | 'customer'; creatorId?: string; amount: number; currency: string; interval: 'month' | 'year'; billingMode: 'automatic' | 'manual'; published: boolean; features: string[]; productLimit?: number | null; productQuota?: 'billing_period_creations' | 'active_listings'; }
export function PlanCard({ plan, onChoose, busy, buttonLabel }: { plan: MarketPlan; onChoose: () => void; busy?: boolean; buttonLabel?: string }) {
  return <article className="market-plan-card"><span className="eyebrow">{plan.audience === 'creator' ? 'For your creative business' : 'More from your favourite creator'}</span><h2>{plan.name}</h2><p className="market-plan-description">{plan.description}</p><div className="market-plan-price">{plan.amount === 0 ? 'Free' : <>{marketplaceMoney(plan.amount)}<small> / {plan.interval === 'year' ? 'year' : 'month'}</small></>}</div><StatusPill value={plan.amount === 0 ? 'No subscription fee' : plan.billingMode === 'automatic' ? 'Automatic renewal' : 'Manual renewal'}/><ul className="market-plan-features">{typeof plan.productLimit === 'number' && !(plan.features || []).some(feature => feature.includes(String(plan.productLimit)) && /product|listing/i.test(feature)) && <li><Check size={14}/>{plan.productLimit} {plan.productQuota === 'billing_period_creations' ? 'new products per paid period' : 'published products'}</li>}{(plan.features || []).map((feature, i) => <li key={i}><Check size={14}/>{feature}</li>)}</ul><AsyncButton onClick={onChoose} busy={busy} busyLabel="Opening checkout…">{buttonLabel || 'Choose membership'}<ArrowRight size={16}/></AsyncButton><p className="market-note">Review the <a href="/policies/terms">Terms</a> and <a href="/policies/refund">Refund & cancellation policy</a> before choosing a plan.</p><p className="market-note">{plan.amount === 0 ? 'Start with the features included above. Marketplace commission applies to product sales.' : plan.billingMode === 'manual' ? 'Pay for one period at a time. We will not automatically charge you again.' : 'Renews automatically with your authorised payment mandate. Manage cancellation from your account.'}</p></article>;
}
/** An unchecked consent step precedes creating a mandate or renewal payment. */
export function usePlanCheckout(returnTo: 'pricing' | 'memberships' = 'memberships') {
  const { isAuthenticated, navigate } = useApp();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ plan: MarketPlan; renewalId?: string; resumeId?: string; checkout?: SubscriptionCheckout; quoteChanged?: boolean } | null>(null);
  const choose = async (plan: MarketPlan) => {
    if (plan.amount === 0) { navigate('/creator'); return; }
    if (!isAuthenticated) { navigate('/login', undefined, authReturnSearch(returnTo)); return; }
    if (busy) return;
    setMessage(''); setPending({ plan });
  };
  const chooseExisting = (subscription: SubscriptionSummary, action: 'renewal' | 'resume') => {
    if (busy) return;
    setMessage('');
    setPending({ ...(action === 'renewal' ? { renewalId: subscription.id } : { resumeId: subscription.id }), plan: { checkoutQuote: subscription.checkoutQuote, id: subscription.planId, name: subscription.planName, description: '', audience: subscription.audience, creatorId: subscription.creatorId, amount: subscription.amount, currency: subscription.currency, interval: subscription.interval, billingMode: subscription.billingMode, published: true, features: [] } });
  };
  const chooseRenewal = (subscription: SubscriptionSummary) => chooseExisting(subscription, 'renewal');
  const chooseResume = (subscription: SubscriptionSummary) => chooseExisting(subscription, 'resume');
  const continueCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending || busy || new FormData(event.currentTarget).get('terms') !== 'on') return;
    setBusy(pending.plan.id); setMessage('');
    try {
      let checkout = pending.checkout;
      if (!checkout) {
        const result = pending.resumeId
          ? await SubscriptionService.resume(pending.resumeId, true, pending.plan.checkoutQuote)
          : pending.renewalId
          ? await SubscriptionService.renew(pending.renewalId, true, pending.plan.checkoutQuote)
          : await SubscriptionService.subscribe(pending.plan.id, true, pending.plan.checkoutQuote);
        if (!result.checkout) throw new Error('Checkout is not ready yet. Check your memberships before trying again.');
        checkout = result.checkout;
        const confirmedPlan = { ...pending.plan, checkoutQuote: result.subscription.checkoutQuote, name: result.subscription.planName, amount: result.subscription.amount, interval: result.subscription.interval, billingMode: result.subscription.billingMode };
        if (confirmedPlan.amount !== pending.plan.amount || confirmedPlan.interval !== pending.plan.interval || confirmedPlan.billingMode !== pending.plan.billingMode) {
          setPending({ ...pending, plan: confirmedPlan, checkout, quoteChanged: true });
          return;
        }
      }
      await openSubscriptionCheckout(checkout);
      setMessage('Your plan starts after the full payment is verified. Check its status in Memberships.');
      setPending(null);
    } catch (err: any) {
      if (err?.status === 409) {
        try {
          if (pending.renewalId || pending.resumeId) {
            const fresh = (await SubscriptionService.listSubscriptions()).subscriptions.find(subscription => subscription.id === (pending.renewalId || pending.resumeId));
            if (fresh?.checkoutQuote && fresh.checkoutQuote !== pending.plan.checkoutQuote) {
              setPending({ ...(pending.resumeId ? { resumeId: fresh.id } : { renewalId: fresh.id }), quoteChanged: true, plan: { ...pending.plan, checkoutQuote: fresh.checkoutQuote, name: fresh.planName, amount: fresh.amount, interval: fresh.interval, billingMode: fresh.billingMode } });
              return;
            }
          } else {
            const fresh = (await SubscriptionService.listPlans({ audience: pending.plan.audience, creatorId: pending.plan.creatorId })).plans.find(plan => plan.id === pending.plan.id && plan.published);
            if (fresh?.checkoutQuote && fresh.checkoutQuote !== pending.plan.checkoutQuote) { setPending({ plan: fresh, quoteChanged: true }); return; }
          }
        } catch { /* Keep the original actionable error if updated offer details cannot load. */ }
      }
      setMessage(err?.message || 'Checkout could not open. Check your membership status before retrying.');
      setPending(null);
    } finally { setBusy(''); }
  };
  const checkoutDialog = pending && <Modal isOpen title={pending.renewalId ? 'Review your renewal.' : pending.resumeId ? 'Continue your existing plan checkout.' : 'One quick check before you continue.'} onClose={() => { if (!busy) setPending(null); }} maxWidth="lg">
    <form key={`${pending.plan.id}:${pending.plan.amount}:${pending.plan.interval}:${pending.plan.billingMode}:${pending.plan.checkoutQuote || ''}`} className="market-form" onSubmit={continueCheckout}>
      <div><p className="eyebrow">{pending.plan.name}</p><p className="market-plan-price" style={{ marginTop: 15 }}>{marketplaceMoney(pending.plan.amount)}<small> / {pending.plan.interval === 'year' ? 'year' : 'month'}</small></p><StatusPill value={pending.plan.billingMode === 'automatic' ? 'Automatic renewal' : 'Manual renewal'}/></div>
      {pending.quoteChanged && <Notice>The plan details or policies changed. Review the current terms above before continuing.</Notice>}
      {pending.plan.description && <p className="market-note">{pending.plan.description}</p>}
      <p className="market-note">{pending.plan.audience === 'customer' ? 'This membership covers only this creator’s published products marked as eligible. It does not include the whole marketplace. Download access ends with the verified paid period; your separate one-time purchases keep their own access.' : `This creator plan includes its listed platform features${typeof pending.plan.productLimit === 'number' ? ` and up to ${pending.plan.productLimit} ${pending.plan.productQuota === 'billing_period_creations' ? 'new products each paid billing period' : 'published products'}` : ''}. It does not replace marketplace review or payment-provider approval.`}</p>
      {pending.checkout?.note && <Notice>{pending.checkout.note}</Notice>}
      <p className="market-note">{pending.plan.billingMode === 'automatic' ? 'You will authorise a recurring payment mandate in checkout. A mandate authorisation alone is not a full plan payment. Access starts only after a matching full payment is verified and continues for the paid period. Request cancellation of future renewals in Memberships.' : 'This payment covers one plan period. You will not be charged automatically for the next period. Access starts after payment is verified.'}</p>
      {pending.checkout?.environment === 'test' && <Notice>This is a test checkout. It does not grant a paid plan or product downloads.</Notice>}
      <label className="market-check"><input name="terms" type="checkbox" required/><span>I agree to the price, access scope and renewal terms above, the <a href="/policies/terms">Terms</a>, and the <a href="/policies/refund">Refund & cancellation policy</a>.</span></label>
      <div className="market-form-actions"><AsyncButton type="submit" busy={!!busy} busyLabel="Preparing secure checkout…">Continue to secure checkout<ArrowRight size={15}/></AsyncButton><button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => setPending(null)}>Not now</button></div>
    </form>
  </Modal>;
  return { choose, chooseRenewal, chooseResume, busy, message, setMessage, checkoutDialog };
}
export function MembershipOffers({ creatorId, creatorName }: { creatorId: string; creatorName: string }) {
  const [plans, setPlans] = useState<MarketPlan[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const { choose, busy, message, checkoutDialog } = usePlanCheckout();
  const load = useCallback(async () => { setLoading(true); setError(''); try { const result = await SubscriptionService.listPlans({ audience: 'customer', creatorId }); setPlans((result.plans || []).filter((p: MarketPlan) => p.published)); } catch { setError('Membership options could not be loaded.'); } finally { setLoading(false); } }, [creatorId]);
  useEffect(() => { void load(); }, [load]);
  if (!loading && !error && !plans.length) return null;
  return <section aria-labelledby="creator-memberships-heading"><hr className="market-section-divider"/><div className="market-section-heading"><div><p className="eyebrow">A little closer to the work</p><h2 id="creator-memberships-heading">Memberships by {creatorName}</h2><p>Choose a plan to access the products included by this creator. Check each product and plan before joining.</p></div></div>{loading ? <MarketLoading label="Loading memberships…"/> : error ? <MarketError message={error} onRetry={load}/> : <>{message && <Notice>{message}</Notice>}<div className="market-plan-grid">{plans.map(plan => <PlanCard key={plan.id} plan={plan} onChoose={() => void choose(plan)} busy={busy === plan.id}/>)}</div>{checkoutDialog}</>}</section>;
}
