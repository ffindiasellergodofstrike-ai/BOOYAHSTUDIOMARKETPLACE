export const MARKETPLACE_RESERVE_POLICY_VERSION = '72h-120d-v1';
export const NORMAL_RESERVE_HOURS = 72;
export const SELLER_RISK_REVIEW_DAYS = 120;
export type ReserveProvider = 'cashfree' | 'razorpay' | 'easebuzz';
const referencePresent = (name: string) => Boolean(process.env[name]?.trim() && process.env[name]!.length <= 300);
/** Deployment attestations require the actual provider contract; they do not manufacture approval. */
export function marketplaceReserveCapability(provider: ReserveProvider) {
  const scheduleId = Number(process.env.CASHFREE_RESERVE_SCHEDULE_ID);
  const ready = provider === 'razorpay'
    ? process.env.RAZORPAY_ROUTE_APPROVED === 'true' && process.env.RAZORPAY_RESERVES_APPROVED === 'true' && referencePresent('RAZORPAY_RESERVE_CONTRACT_REFERENCE')
    : provider === 'cashfree'
      ? process.env.CASHFREE_EASYSPLIT_APPROVED === 'true' && process.env.CASHFREE_RESERVES_APPROVED === 'true' && referencePresent('CASHFREE_RESERVE_CONTRACT_REFERENCE') && Number.isSafeInteger(scheduleId) && scheduleId > 0 && Number(process.env.CASHFREE_RESERVE_MIN_HOURS) >= NORMAL_RESERVE_HOURS
      : false;
  return { ready, riskHoldAutomationReady: provider === 'razorpay' && ready, normalReserveHours: NORMAL_RESERVE_HOURS, riskReviewDays: SELLER_RISK_REVIEW_DAYS, upiPayoutReady: false,
    message: provider === 'razorpay' ? ready ? 'Bank Route transfers remain on hold until verified release eligibility. Bank credit follows the provider.' : 'Route reserve approval and a written contract reference are required before new creator sales.'
      : provider === 'cashfree' ? ready ? 'Provider-approved bank schedule is checked at checkout; actual vendor settlement must be reconciled. Risk holds require Cashfree review; no automatic vendor block is claimed.' : 'Easy Split reserve approval, the approved schedule and minimum 72-hour contract are required.'
        : 'A documented reserve/hold-release integration is unavailable. New third-party sales requiring reserves are disabled; company sales are unaffected.' };
}
export function assertMarketplaceReserveCapability(provider: ReserveProvider) {
  if (!marketplaceReserveCapability(provider).ready) throw new Error(marketplaceReserveCapability(provider).message);
}
