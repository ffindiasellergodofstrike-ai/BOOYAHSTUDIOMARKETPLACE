/** A creator handle can never replace an application, policy, API or asset route. */
export const RESERVED_CREATOR_SLUGS = new Set([
  'admin', 'api', 'assets', 'account', 'about', 'auth', 'build', 'cart', 'category', 'checkout',
  'contact', 'creator', 'creators', 'demos', 'docs', 'faq', 'files', 'forgot-password', 'images',
  'login', 'logout', 'memberships', 'policies', 'pricing', 'product', 'products', 'product-images',
  'register', 'reset-password', 'search', 'seller', 'sellers', 'settings', 'signup', 'support',
  'templates', 'uploads', 'wishlist', 'server', 'scripts', 'supabase', 'netlify', 'health',
  'terms', 'privacy', 'refund', 'disclaimer', 'creator-agreement', 'delivery', 'fraud', 'chargebacks',
  'license', 'copyright', 'acceptable-use', 'account-security', 'payments', 'product-requirements',
  'download-records', 'duplicate-payments', 'grievance', 'updates', 'purchase', 'cancellation',
  'digital-delivery', 'cookies', 'cookies-browser-storage', 'cookie-policy', 'security', 'payment',
  'refund-policy', 'terms-and-conditions', 'constructor', 'prototype', 'tostring', 'valueof',
]);
export function isCreatorSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,49}$/.test(value) && !RESERVED_CREATOR_SLUGS.has(value);
}
export function creatorSlugFromPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  const match = /^\/(?:(creators|store)\/)?([^/]+)$/.exec(path);
  if (!match) return null;
  let slug: string;
  try { slug = decodeURIComponent(match[2]); } catch { return null; }
  return match[1] ? /^[a-z0-9][a-z0-9-]{2,49}$/.test(slug) ? slug : null : isCreatorSlug(slug) ? slug : null;
}
export const getCreatorPath = (slug: string): string => /^[a-z0-9][a-z0-9-]{2,49}$/.test(slug) ? `/store/${slug}` : '/creators';
