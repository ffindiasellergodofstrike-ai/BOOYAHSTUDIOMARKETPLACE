import type { CreatorFeatureAccess, SubscriptionPlan } from '../src/types/subscription';

export const BASIC_CREATOR_FEATURES: CreatorFeatureAccess = { storefront: true, secureDownloads: true, orderManagement: true, customerMemberships: false, advancedAnalytics: false };
export const ALL_CREATOR_FEATURES: CreatorFeatureAccess = { ...BASIC_CREATOR_FEATURES, customerMemberships: true, advancedAnalytics: true };
export const CREATOR_PLAN_CATALOG_VERSION = 2;
export const LEGACY_CREATOR_PLAN_IDS = new Set(['starter', 'creator', 'studio']);
export const CREATOR_PLANS: SubscriptionPlan[] = [
  { id: 'creator_monthly_499', name: 'Creator', description: 'Your storefront, with ten new digital products each paid month.', audience: 'creator', amount: 499, currency: 'INR', interval: 'month', billingMode: 'manual', published: true, productLimit: 10, productQuota: 'billing_period_creations', catalogVersion: 2, featureAccess: BASIC_CREATOR_FEATURES, features: ['10 new products per paid monthly period', 'Your own shareable storefront', 'Private files and protected downloads', 'Orders and basic earnings', 'INR20 platform fee per item sold'] },
  { id: 'studio_monthly_899', name: 'Studio', description: 'Unlimited product creations and every creator feature.', audience: 'creator', amount: 899, currency: 'INR', interval: 'month', billingMode: 'manual', published: true, productLimit: null, productQuota: 'billing_period_creations', catalogVersion: 2, featureAccess: ALL_CREATOR_FEATURES, features: ['Unlimited product creations per paid monthly period', 'Everything in Creator', 'Customer membership offers', 'Advanced sales analytics', '10 MB maximum per product file', 'INR20 platform fee per item sold'] },
];
export const isPublicCreatorPlan = (plan: SubscriptionPlan): boolean => plan.audience !== 'creator' || (!LEGACY_CREATOR_PLAN_IDS.has(plan.id) && plan.published);
export function creatorPlanQuota(plan: SubscriptionPlan): { productLimit: number | null | undefined; productQuota: 'billing_period_creations' | 'active_listings' } {
  // The user's first monthly plans deliberately used productLimit:null alongside
  // monthlyProductLimit:10. Null on that old field must not grant unlimited access.
  if (Object.hasOwn(plan, 'monthlyProductLimit') && plan.monthlyProductLimit !== undefined) {
    return { productLimit: plan.monthlyProductLimit, productQuota: 'billing_period_creations' };
  }
  return { productLimit: plan.productLimit, productQuota: plan.productQuota || 'active_listings' };
}
export function creatorPlanFeatures(plan: SubscriptionPlan): CreatorFeatureAccess {
  // Historical paid plan snapshots retain the features they already offered.
  if (plan.featureAccess) return { ...BASIC_CREATOR_FEATURES, ...plan.featureAccess };
  if (Object.hasOwn(plan, 'monthlyProductLimit') && plan.monthlyProductLimit !== undefined) return plan.monthlyProductLimit === null ? { ...ALL_CREATOR_FEATURES } : { ...BASIC_CREATOR_FEATURES };
  return { ...ALL_CREATOR_FEATURES };
}
