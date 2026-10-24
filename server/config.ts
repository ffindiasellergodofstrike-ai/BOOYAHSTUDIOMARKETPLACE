import { BUSINESS } from '../src/config/business';
/** Trusted redirect origin; never use a request Host header for recovery or email links. */
export function appOrigin(): string {
  // Vercel provides these deployment values. Never derive recovery links from
  // request Host/Origin headers. An explicitly configured APP_URL always wins.
  const deploymentHost = process.env.VERCEL_ENV === 'preview'
    ? process.env.VERCEL_URL
    : process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const platformOrigin = process.env.VERCEL && deploymentHost ? `https://${deploymentHost}` : undefined;
  if (process.env.NODE_ENV === 'production' && !process.env.APP_URL && !platformOrigin) throw new Error('Configure APP_URL for this marketplace deployment.');
  const url = new URL(process.env.APP_URL || platformOrigin || 'http://localhost:3000');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('APP_URL must be a trusted HTTPS origin (HTTP localhost is allowed in development).');
  }
  return url.origin;
}
