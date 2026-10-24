import { PRODUCTS, COUPONS } from '../src/data/products';
import { supabaseAdmin } from './supabase';
/** Server-only PostgreSQL persistence; no local fallback for financial or identity data. */
export class Store {
  static async rpc<T = any>(operation: string, key = '', value: any = null): Promise<T> {
    const { data, error } = await supabaseAdmin().rpc('store_operation', { operation, key, value });
    if (error) throw new Error('Database operation failed.');
    return data as T;
  }
  static get<T = any>(key: string): Promise<T | null> { return this.rpc('get', key); }
  static set<T>(key: string, value: T): Promise<T> { return this.rpc('set', key, value); }
  static update<T = any>(key: string, value: Partial<T>): Promise<T> { return this.rpc('update', key, value); }
  static delete(key: string): Promise<boolean> { return this.rpc('delete', key); }
  static async setMultiple(value: Record<string, unknown>): Promise<void> { await this.rpc('multi', '', value); }
  static async testConnection() {
    try { await this.get('settings'); return { connected: true, mode: 'SUPABASE', url: process.env.SUPABASE_URL }; }
    catch { return { connected: false, mode: 'SUPABASE', url: '', error: 'Database unavailable' }; }
  }
  public static async getUserProfile(userId: string): Promise<any | null> {
    return await this.get(`users/${userId}/profile`);
  }

  /**
   * Update user profile
   */
  public static async updateUserProfile(userId: string, data: any): Promise<any | null> {
    return await this.update(`users/${userId}/profile`, data);
  }

  /**
   * User Cart Data
   */
  public static async getUserCart(userId: string): Promise<any[]> {
    const data = await this.get<Record<string, any>>(`users/${userId}/cart`);
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async setUserCart(userId: string, items: any[]): Promise<void> {
    await this.set(`users/${userId}/cart`, items);
  }

  /**
   * User Wishlist Data
   */
  public static async getUserWishlist(userId: string): Promise<any[]> {
    const data = await this.get<Record<string, any>>(`users/${userId}/wishlist`);
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async setUserWishlist(userId: string, items: any[]): Promise<void> {
    await this.set(`users/${userId}/wishlist`, items);
  }

  /**
   * User Orders Data
   */
  public static async getUserOrders(userId: string): Promise<any[]> {
    const data = await this.get<Record<string, any>>(`users/${userId}/orders`);
    if (!data) return [];
    const list = Array.isArray(data) ? data : Object.values(data);
    return list.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
  }

  public static async getUserOrderById(userId: string, orderId: string): Promise<any | null> {
    const globalOrder = await this.getGlobalOrder(orderId);
    return globalOrder?.userId === userId ? globalOrder : null;
  }

  public static async saveUserOrder(userId: string, order: any): Promise<void> {
    await this.setMultiple({ [`users/${userId}/orders/${order.id}`]: order, [`orders/${order.id}`]: order });
  }

  public static async getGlobalOrder(id: string): Promise<any | null> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '')) return null;
    return this.get(`orders/${id}`);
  }
  public static async saveGlobalOrder(order: any): Promise<void> {
    await this.setMultiple({ [`orders/${order.id}`]: order, [`users/${order.userId}/orders/${order.id}`]: order });
  }
  /**
   * Global Purchase Access Records
   * purchases/{purchaseId} & users/{userId}/purchases/{purchaseId}
   */
  public static async getPurchase(purchaseId: string): Promise<any | null> {
    return await this.get(`purchases/${purchaseId}`);
  }

  public static async getUserPurchases(userId: string): Promise<any[]> {
    const data = await this.get<Record<string, any>>(`users/${userId}/purchases`);
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async savePurchase(userId: string, purchaseId: string, purchaseData: any): Promise<void> {
    await this.setMultiple({
      [`purchases/${purchaseId}`]: purchaseData,
      [`users/${userId}/purchases/${purchaseId}`]: purchaseData,
    });
  }

  /**
   * Payment Events (Webhook Idempotency)
   * paymentEvents/{eventId}
   */
  public static async getPaymentEvent(eventId: string): Promise<any | null> {
    return await this.get(`paymentEvents/${eventId}`);
  }

  public static async savePaymentEvent(eventId: string, eventData: any): Promise<void> {
    await this.set(`paymentEvents/${eventId}`, eventData);
  }

  /**
   * Download Logs
   * downloadLogs/{downloadLogId}
   */
  public static async saveDownloadLog(downloadLogId: string, logData: any): Promise<void> {
    await this.set(`downloadLogs/${downloadLogId}`, logData);
  }

  /**
   * User Downloads Data
   */
  public static async getUserDownloads(userId: string): Promise<any[]> {
    const data = await this.get<Record<string, any>>(`users/${userId}/downloads`);
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async saveUserDownload(userId: string, downloadId: string, downloadItem: any): Promise<void> {
    await this.set(`users/${userId}/downloads/${downloadId}`, downloadItem);
  }

  /**
   * User Settings Data
   */
  public static async getUserSettings(userId: string): Promise<any> {
    const data = await this.get(`users/${userId}/settings`);
    return data || { emailNotifications: true, orderAlerts: true, newsletter: false };
  }

  public static async setUserSettings(userId: string, settings: any): Promise<void> {
    await this.set(`users/${userId}/settings`, settings);
  }

  /**
   * Delete test account for cleanup
   */
  // --- ADMIN & PRODUCTS / COUPONS / SETTINGS HELPERS ---

  public static async getAllProducts(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('products');
    const merged = new Map(PRODUCTS.map(product => [product.id, product as any]));
    for (const product of data ? (Array.isArray(data) ? data : Object.values(data)) : []) merged.set(product.id, { ...merged.get(product.id), ...product });
    return [...merged.values()];
  }

  public static async getProductById(id: string): Promise<any | null> {
    return await this.get(`products/${id}`) || PRODUCTS.find(product => product.id === id) || null;
  }

  public static async saveProduct(product: any): Promise<void> {
    await this.set(`products/${product.id}`, product);
  }

  public static async deleteProduct(id: string): Promise<void> {
    await this.delete(`products/${id}`);
  }

  public static async getAllCoupons(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('coupons');
    const merged = new Map(COUPONS.map(c => [`static-${c.code}`, { ...c, id: `static-${c.code}` } as any]));
    for (const c of data ? Object.values(data) : []) merged.set(c.id, c);
    return [...merged.values()];
  }

  public static async saveCoupon(coupon: any): Promise<void> {
    await this.set(`coupons/${coupon.id}`, coupon);
  }

  public static async deleteCoupon(id: string): Promise<void> {
    const coupon = (await this.getAllCoupons()).find(c => c.id === id);
    if (coupon) await this.saveCoupon({ ...coupon, active: false });
  }

  public static async getGlobalSettings(): Promise<any> {
    const data = await this.get('settings');
    return data || {};
  }

  public static async saveGlobalSettings(settings: any): Promise<void> {
    await this.set('settings', settings);
  }

  public static async getAllGlobalOrders(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('orders');
    if (!data) return [];
    const list = Array.isArray(data) ? data : Object.values(data);
    return list.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
  }

  public static async getAllUsers(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('users');
    if (!data) return [];
    const profiles: any[] = [];
    for (const [userId, userData] of Object.entries(data)) {
      if (userData && (userData as any).profile) {
        profiles.push({ ...(userData as any).profile, userId, settings: (userData as any).settings });
      } else if (userData && (userData as any).id) {
        profiles.push({ ...userData, userId });
      }
    }
    return profiles;
  }

  public static async setUserProfile(userId: string, profile: any): Promise<void> {
    await this.set(`users/${userId}/profile`, profile);
  }
}
