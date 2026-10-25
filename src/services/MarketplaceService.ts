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
  file?: { uploaded?: boolean; published?: boolean; fileName?: string; size?: number; uploadedAt?: string };
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
  uploadListing: async (id: string, file: File) => {
    if (!/\.zip$/i.test(file.name) || file.size < 22 || file.size > 10 * 1024 * 1024) throw new MarketplaceApiError('Choose one non-empty ZIP file up to 10 MB.', 400);
    const intent = await request<{ uploadId: string; uploadUrl: string; uploadOrigin: string; expiresAt: number; method: string }>(`/me/listings/${segment(id)}/upload-intent`, json('POST', { fileName: file.name, size: file.size }));
    let target: URL;
    try { target = new URL(intent.uploadUrl); } catch { throw new MarketplaceApiError('Private Storage returned an invalid upload address. Please try again.', 503); }
    if (target.protocol !== 'https:' || target.username || target.password || target.origin !== intent.uploadOrigin ||
        !target.pathname.startsWith('/storage/v1/object/upload/sign/products/_creators/') || !/^[a-f0-9]{32}$/.test(intent.uploadId) || intent.method !== 'PUT' || intent.expiresAt <= Date.now()) throw new MarketplaceApiError('Private Storage could not prepare a safe upload. Please try again.', 503);
    let response: Response;
    try { response = await fetch(target.toString(), { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'application/zip', 'x-upsert': 'false' }, body: file, signal: AbortSignal.timeout(120_000) }); }
    catch { throw new MarketplaceApiError('The file upload did not finish. Check your connection and choose the ZIP again.', 0); }
    if (!response.ok) throw new MarketplaceApiError(response.status === 413 ? 'The file exceeds the 10 MB Storage limit.' : 'Private Storage could not accept this ZIP. Please try again.', response.status);
    return request(`/me/listings/${segment(id)}/upload-complete`, json('POST', { uploadId: intent.uploadId }));
  },
  importListing: (id: string, url: string) => request(`/me/listings/${segment(id)}/import-link`, json('POST', { url, fileName: 'product.zip' })),
  membershipPlans: () => request('/plans?audience=customer'),
  saveMembershipPlan: (id: string | undefined, plan: unknown) => request(`/me/membership-plans${id ? `/${segment(id)}` : ''}`, json(id ? 'PATCH' : 'POST', plan)),
};
