export class AdminApiError extends Error {
  constructor(message: string, public httpStatus: number) { super(message); this.name = 'AdminApiError'; }
}

/** Same-origin cookie requests; API failures remain visible instead of becoming empty lists. */
export class AdminService {
  private static async request(path: string, options: RequestInit = {}): Promise<any> {
    let response: Response;
    try {
      response = await fetch(path, { ...options, credentials: 'include', signal: options.signal || AbortSignal.timeout(55_000) });
    } catch { throw new AdminApiError('The server could not be reached. Check your connection and retry.', 0); }
    let data: any;
    try { data = await response.json(); }
    catch { throw new AdminApiError('The server returned an unexpected response. Check the Vercel deployment and retry.', response.status || 502); }
    if (!response.ok || data?.success !== true) {
      const fallback = response.status === 401 ? 'Your session has expired. Sign in again.' : response.status === 403 ? 'This account does not have administrator access.' : 'This request could not be completed. Please retry.';
      throw new AdminApiError(typeof data?.message === 'string' ? data.message : fallback, response.status);
    }
    return data;
  }
  private static json(method: string, body: any): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
  public static async verifyAdminMe(): Promise<{ success: boolean; admin?: any; health?: any; httpStatus: number; message?: string }> {
    try { return { ...await this.request('/api/admin/me'), httpStatus: 200 }; }
    catch (error) { const err = error as AdminApiError; return { success: false, httpStatus: err.httpStatus ?? 0, message: err.message }; }
  }
  public static getDashboardStats() { return this.request('/api/admin/dashboard/stats'); }
  public static async getProducts(): Promise<any[]> { return (await this.request('/api/admin/products')).products; }
  public static saveProduct(product: any) { return AdminService.request(product.isNew ? '/api/admin/products' : `/api/admin/products/${encodeURIComponent(product.id)}`, AdminService.json(product.isNew ? 'POST' : 'PUT', product)); }
  public static deleteProduct(id: string) { return AdminService.request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  public static cloneProduct(id: string) { return AdminService.request(`/api/admin/products/${encodeURIComponent(id)}/clone`, { method: 'POST' }); }
  public static async getOrders(): Promise<any[]> { return (await this.request('/api/admin/orders')).orders; }
  public static async getOrderTimeline(id: string): Promise<any[]> { return (await this.request(`/api/admin/orders/${encodeURIComponent(id)}/timeline`)).timeline; }
  public static getOrderDeliveryDetails(id: string) { return this.request(`/api/admin/orders/${encodeURIComponent(id)}/delivery`); }
  public static retryOrderEmail(id: string) { return this.request(`/api/admin/orders/${encodeURIComponent(id)}/retry-email`, { method: 'POST' }); }
  public static revokeOrderAccess(id: string) { return this.request(`/api/admin/orders/${encodeURIComponent(id)}/status`, this.json('PUT', { deliveryStatus: 'REVOKED' })); }
  public static async reconcileOrderPayment(id: string, paymentProvider = 'Razorpay') {
    const provider = paymentProvider.toLowerCase();
    if (!['cashfree', 'razorpay'].includes(provider)) throw new AdminApiError('No supported payment gateway is bound to this order.', 400);
    // A pending or failed verified result is a valid response, not an API transport error.
    const response = await fetch(`/api/payments/${provider}/reconcile/${encodeURIComponent(id)}`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(55_000) });
    let data: any;
    try { data = await response.json(); } catch { throw new AdminApiError('Unexpected payment verification response. Retry shortly.', response.status); }
    if (!response.ok) throw new AdminApiError(data.message || 'Payment could not be verified.', response.status);
    return data;
  }
  public static async getCustomers(): Promise<any[]> { return (await this.request('/api/admin/customers')).customers; }
  public static updateCustomerStatus(id: string, payload: { role?: string; blocked?: boolean }) { return this.request(`/api/admin/customers/${encodeURIComponent(id)}/status`, this.json('PUT', payload)); }
  public static async getCoupons(): Promise<any[]> { return (await this.request('/api/admin/coupons')).coupons; }
  public static saveCoupon(coupon: any) { return this.request('/api/admin/coupons', this.json('POST', coupon)); }
  public static deleteCoupon(id: string) { return this.request(`/api/admin/coupons/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  public static async getSettings() { return (await this.request('/api/admin/settings')).settings; }
  public static saveSettings(settings: any) { return this.request('/api/admin/settings', this.json('PUT', settings)); }
  public static async getAuditLogs(): Promise<any[]> { return (await this.request('/api/admin/audit-logs')).logs; }
  public static getReadiness() { return this.request('/api/admin/readiness'); }
  public static async getSupportRequests(): Promise<any[]> { return (await this.request('/api/admin/support')).requests; }
  public static updateSupportRequest(id: string, payload: { status: 'open' | 'in_progress' | 'resolved'; adminNotes: string }) { return this.request(`/api/admin/support/${encodeURIComponent(id)}`, this.json('PATCH', payload)); }
  public static async getSubscribers(): Promise<any[]> { return (await this.request('/api/admin/subscribers')).subscribers; }
  public static updateSubscriber(id: string, payload: { subscribed: boolean }) { return this.request(`/api/admin/subscribers/${encodeURIComponent(id)}`, this.json('PATCH', payload)); }
  public static async getDownloadHistory(): Promise<any[]> { return (await this.request('/api/admin/downloads')).downloads; }
  public static getProductFile(id: string) { return this.request(`/api/admin/products/${encodeURIComponent(id)}/file`); }
  public static prepareProductFileUpload(id: string, payload: any) { return this.request(`/api/admin/products/${encodeURIComponent(id)}/file-upload`, this.json('POST', payload)); }
  public static completeProductFileUpload(id: string, payload: any) { return this.request(`/api/admin/products/${encodeURIComponent(id)}/file-upload/complete`, this.json('POST', payload)); }
  public static async uploadImage(file: File) {
    const form = new FormData(); form.append('image', file);
    return this.request('/api/admin/uploads/direct', { method: 'POST', body: form });
  }
}
