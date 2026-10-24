import pages from './policies.json';
export interface PolicySection { id: string; title: string; content: string; }
export interface Policy { slug: string; title: string; subtitle: string; lastUpdated: string; quickSummary: string[]; sections: PolicySection[]; }
export type SupportedPolicySlug = string;
export const SUPPORTED_POLICY_SLUGS = pages.map(page => page.slug);
export const policyData: Record<string, Policy> = Object.assign(Object.create(null), Object.fromEntries(pages.map(page => [page.slug, page])));
export const POLICY_REDIRECTS: Record<string, SupportedPolicySlug> = Object.assign(Object.create(null), {
  'delivery': 'terms',
  'fraud': 'terms',
  'chargebacks': 'terms',
  'license': 'terms',
  'copyright': 'terms',
  'acceptable-use': 'terms',
  'account-security': 'terms',
  'payments': 'refund',
  'product-requirements': 'terms',
  'download-records': 'terms',
  'duplicate-payments': 'refund',
  'grievance': 'terms',
  'updates': 'terms',
  'purchase': 'terms',
  'cancellation': 'refund',
  'digital-delivery': 'terms',
  'cookies': 'privacy',
  'cookies-browser-storage': 'privacy',
  'cookie-policy': 'privacy',
  'security': 'terms',
  'payment': 'refund',
  'refund-policy': 'refund',
  'terms-and-conditions': 'terms',
});
