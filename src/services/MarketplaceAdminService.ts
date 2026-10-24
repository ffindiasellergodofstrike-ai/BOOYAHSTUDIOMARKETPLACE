import { AdminApiError } from './AdminService';

/** Administrative marketplace calls use the existing verified, same-origin session. */
export class MarketplaceAdminService {
  private static async request<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/marketplace/admin/${path}`, {
        ...options, credentials: 'include', signal: options.signal || AbortSignal.timeout(55_000),
      });
    } catch { throw new AdminApiError('The server could not be reached. Check your connection and retry.', 0); }
    let data: any;
    try { data = await response.json(); }
    catch { throw new AdminApiError('The server returned an unexpected response. Please retry.', response.status); }
    if (!response.ok || data?.success !== true) {
      const fallback = response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 403 ? 'Administrator access is required.' : 'This request could not be completed. Please retry.';
      throw new AdminApiError(typeof data?.message === 'string' ? data.message : fallback, response.status);
    }
    return data as T;
  }

  private static json(method: string, body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  static getSection<T = Record<string, unknown>>(section: string) { return this.request<T>(section); }
  static reviewCreator(id: string, action: 'approve' | 'suspend' | 'reject', reason: string) {
    return this.request(`creators/${encodeURIComponent(id)}`, this.json('PATCH', { action, reason }));
  }
  static reviewListing(id: string, action: 'approve' | 'reject' | 'archive', reason: string, reviewed: boolean) {
    return this.request(`listings/${encodeURIComponent(id)}`, this.json('PATCH', { action, reason, reviewed }));
  }
  static getListingFile(id: string) { return this.request<{ success: true; downloadUrl: string; expiresAt: string; validation: string }>(`listings/${encodeURIComponent(id)}/review-file`); }
  static saveGateways(settings: unknown) { return this.request('gateways', this.json('PATCH', settings)); }
  static savePlan(id: string, plan: unknown) { return this.request(`plans/${encodeURIComponent(id)}`, this.json('PUT', plan)); }
}
