import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Layers } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SubscriptionService } from '../services/SubscriptionService';
import { MarketplaceService, type MarketplaceConfig } from '../services/MarketplaceService';
import { PlanCard, usePlanCheckout, type MarketPlan } from '../components/marketplace/MembershipOffers';
import { MarketEmpty, MarketError, MarketLoading, MarketPageHeading } from '../components/marketplace/MarketplaceShared';
import { Notice } from '../components/ui/Notice';

export const PricingPage: React.FC = () => {
  const { navigate } = useApp(); const [plans, setPlans] = useState<MarketPlan[]>([]); const [config, setConfig] = useState<MarketplaceConfig | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const { choose, busy, message, checkoutDialog } = usePlanCheckout('pricing');
  const load = useCallback(async () => { setLoading(true); setError(''); const results = await Promise.allSettled([SubscriptionService.listPlans({ audience: 'creator' }), MarketplaceService.config()]); if (results[0].status === 'fulfilled') setPlans((results[0].value.plans || []).filter((p: MarketPlan) => p.published)); else setError('We could not load creator plans right now. Please try again.'); if (results[1].status === 'fulfilled') setConfig(results[1].value); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);
  const itemFee = typeof config?.settings?.commissionPaisePerItem === 'number' ? config.settings.commissionPaisePerItem / 100 : 20;
  return <main className="market-page"><div className="studio-container"><MarketPageHeading kicker="Make room for your next chapter" title="Your ideas deserve" emphasis="a place to grow." description="Build your storefront, share original digital products, and create memberships around the things you do best."><button className="btn btn-secondary" onClick={() => navigate('/creator')}>Your creator space<ArrowRight size={16}/></button></MarketPageHeading>
    {message && <Notice>{message}</Notice>}{loading ? <MarketLoading label="Finding the right plan for your next step…"/> : error ? <MarketError message={error} onRetry={load}/> : plans.length ? <div className="market-plan-grid">{plans.map(plan => <PlanCard key={plan.id} plan={plan} busy={busy === plan.id} onChoose={() => void choose(plan)} buttonLabel={plan.amount === 0 ? 'Start creating' : 'Choose creator plan'}/>)}</div> : <MarketEmpty title="Your first step starts here" description="Paid creator plans are not open yet. You can still set up your profile and see the features available to you." action="Set up your storefront" onAction={() => navigate('/creator')} icon={Layers}/>}
    {checkoutDialog}<div className="market-inline-notice">A flat ₹{itemFee} platform fee is charged per product item sold. Plan fees are separate; payment-processing charges, applicable taxes, refunds, and provider rules may also affect proceeds. A paid plan does not replace profile review or payment-provider approval.</div>
    <hr className="market-section-divider"/><div className="market-customer-intro"><div><p className="eyebrow">Here for the good stuff?</p><h2>Find a creator. Stay inspired.</h2><p>Customer memberships are offered by individual creators. Visit their storefront to see exactly what a membership includes, how often it renews, and which products you can access.</p><button className="btn btn-secondary" onClick={() => navigate('/creators')}>Discover creators<ArrowRight size={16}/></button></div><div className="market-panel"><h2>A few things to know</h2><div className="market-steps"><div className="market-step"><span><Check size={14}/></span><div><h3>Clear renewal terms</h3><p>Each plan tells you whether you pay manually or authorise automatic renewal.</p></div></div><div className="market-step"><span><Check size={14}/></span><div><h3>Your purchases stay yours</h3><p>Products you buy individually remain in Downloads. Membership access follows your verified paid period.</p></div></div><div className="market-step"><span><Check size={14}/></span><div><h3>Manage it in one place</h3><p>View plan status, check a payment, or request cancellation from Memberships.</p></div></div></div></div></div>
  </div></main>;
};
export default PricingPage;
