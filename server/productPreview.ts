const BLOCKED_PREVIEW_HOSTS = new Set(['vercel.app']);
const LOCAL_PREVIEW_PATH = /^\/demos\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;

export function normalizeProductPreviewUrl(value: unknown, productId?: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const previewUrl = value.trim();
  if (LOCAL_PREVIEW_PATH.test(previewUrl)) {
    if (typeof productId === 'string' && previewUrl !== `/demos/${productId}/`) return undefined;
    return previewUrl;
  }

  if (previewUrl.startsWith('/')) return undefined;

  try {
    const url = new URL(previewUrl);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== 'https:') return undefined;
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return undefined;
    if (BLOCKED_PREVIEW_HOSTS.has(hostname) || hostname.endsWith('.vercel.app')) return undefined;

    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isAllowedProductPreviewUrl(value: unknown): value is string {
  return normalizeProductPreviewUrl(value) !== undefined;
}
