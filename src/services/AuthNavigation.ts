/** Symbolic return hints only: never accept a customer-supplied URL or arbitrary path. */
const AUTH_DESTINATIONS: Readonly<Record<string, string>> = Object.freeze({ checkout: '/checkout', downloads: '/account/downloads', orders: '/account/orders', creator: '/creator', pricing: '/pricing', memberships: '/memberships' });
const isReturnHint = (redirect?: string): redirect is string => Boolean(redirect && Object.hasOwn(AUTH_DESTINATIONS, redirect));
export const authDestination = (redirect?: string): string => isReturnHint(redirect) ? AUTH_DESTINATIONS[redirect] : '/account';
export const authReturnSearch = (redirect?: string): Record<string, string> => isReturnHint(redirect) ? { redirect } : {};

/** Never persist email authentication material in local navigation history. */
export function safePreviousUrl(pathname: string, search = ''): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f]/.test(pathname)) return '/';
  const query = new URLSearchParams(search);
  for (const key of [...query.keys()]) {
    if (/token|code|secret|password|confirmation_url|error_description/i.test(key)) query.delete(key);
  }
  const clean = query.toString();
  return pathname + (clean ? `?${clean}` : '');
}
