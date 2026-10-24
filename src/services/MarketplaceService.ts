import type { Product } from '../types';

export interface CreatorCard {
  id: string; slug: string; displayName: string; headline?: string; bio?: string;
  publicBusiness?: { businessName: string; businessAddress: string; supportEmail: string; supportPhone: string; grievanceName: string };
  avatar?: string; avatarUrl?: string; coverImage?: string; website?: string; categories?: string[];
  status?: string; kycStatus?: string; planId?: string; productLimit?: number;
  productCount?: number; isPlatform?: boolean; createdAt?: string;
  providerAccounts?: Record<string, { status?: string; reference?: string; ready?: boolean }>;
  [key: string]: unknown;
}
export interface CreatorListing extends Omit<Product, 'status'> {
  status: 'draft' | 'pending' | 'active' | 'rejected' | 'archived';
  sellerId?: string; sellerName?: string; privateFileReady?: boolean;
  fileStatus?: string; reviewNote?: string; rejectionReason?: string;
  [key: string]: unknown;
}
export interface MarketplaceConfig {
  settings?: { commissionBps?: number; registrationEnabled?: boolean; [key: string]: unknown };
  companyCreator?: CreatorCard; creatorPlans?: any[]; agreement?: string | { version: string; title: string; terms: string[] }; categories?: string[];
  [key: string]: unknown;
}
export interface CreatorWorkspace {
  creator: CreatorCard | null; products: CreatorListing[]; orders: any[];
  summary?: Record<string, any>; plans?: any[]; [key: string]: unknown;
}

export class MarketplaceApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`/api/marketplace${path}`, { ...options, credentials: 'include', headers, signal: options.signal || AbortSignal.timeout(30_000) }); }
  catch { throw new MarketplaceApiError('The connection took too long. Please check your connection and try again.', 0); }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success === false || !result) throw new MarketplaceApiError(result?.message || (response.status === 401 ? 'Please sign in to continue.' : 'We could not complete that request. Please try again.'), response.status);
  return result as T;
}
const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) });
const segment = (value: string) => encodeURIComponent(value);
export const MarketplaceService = {
  request,
  config: () => request<MarketplaceConfig>('/config'),
  creators: () => request<{ creators: CreatorCard[] }>('/creators'),
  creator: (slug: string) => request<{ creator: CreatorCard; products: Product[] }>(`/creators/${segment(slug)}`),
  me: () => request<CreatorWorkspace>('/me'),
  onboard: (profile: unknown) => request('/me', json('POST', profile)),
  acceptAgreement: (agreementVersion: string) => request('/me/agreement', json('POST', { agreementVersion, acceptAgreement: true })),
  updateProfile: (profile: unknown) => request('/me', json('PATCH', profile)),
  submitKyc: (details: unknown) => request('/me/kyc', json('POST', details)),
  createListing: (listing: unknown) => request('/me/listings', json('POST', listing)),
  updateListing: (id: string, listing: unknown) => request(`/me/listings/${segment(id)}`, json('PATCH', listing)),
  submitListing: (id: string) => request(`/me/listings/${segment(id)}/submit`, json('POST', {})),
  uploadListing: (id: string, file: File) => { const body = new FormData(); body.set('file', file); return request(`/me/listings/${segment(id)}/upload`, { method: 'POST', body }); },
  membershipPlans: () => request('/plans?audience=customer'),
  saveMembershipPlan: (id: string | undefined, plan: unknown) => request(`/me/membership-plans${id ? `/${segment(id)}` : ''}`, json(id ? 'PATCH' : 'POST', plan)),
};
