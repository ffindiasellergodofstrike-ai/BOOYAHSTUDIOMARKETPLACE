/** Public deployment origin only. Never derive payment/email redirects from request headers. */
export function resolvePublicSiteOrigin(): string {
  const browserValue = (import.meta as any).env?.VITE_SITE_URL;
  const environment = typeof process !== 'undefined' ? process.env : {};
  const platformHost = environment.VERCEL_ENV === 'preview' ? environment.VERCEL_URL : environment.VERCEL_PROJECT_PRODUCTION_URL || environment.VERCEL_URL;
  const candidate = browserValue || environment.APP_URL || (environment.VERCEL && platformHost ? `https://${platformHost}` : undefined) ||
    (typeof window !== 'undefined' ? window.location.origin : environment.NODE_ENV === 'production' ? 'https://marketplace.example.com' : 'http://localhost:3000');
  const url = new URL(candidate);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Configure a valid public HTTPS site origin.');
  return url.origin;
}
/** Public marketplace operator identity supplied by the owner. */
export const BUSINESS = {
  name: 'BooyahMarket',
  legalName: '',
  owner: 'MANISH KUMAR SONKAR',
  gstin: '',
  email: 'connectbooyahstudio@gmail.com',
  phone: '+91 7393845435',
  phoneHref: 'https://wa.me/917393845435',
  url: resolvePublicSiteOrigin(),
  address: 'S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR, Varanasi, Varanasi, Uttar Pradesh, 221003',
  supportHours: 'Contact us by email or WhatsApp',
} as const;
