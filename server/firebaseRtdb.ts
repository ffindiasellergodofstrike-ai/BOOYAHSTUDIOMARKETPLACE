import { SupabaseStore, usesSupabase } from './supabaseStore';
/**
 * Firebase Realtime Database REST Client with Resilient Fallback Persistence
 * Communicates with configured FIREBASE_DATABASE_URL
 */

import fs from 'fs';
import path from 'path';

function getRtdbBaseUrl(): string {
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) {
    throw new Error('FIREBASE_DATABASE_URL environment variable is required.');
  }
  return url.replace(/\/$/, '');
}

function getRtdbAuth(): string {
  return process.env.FIREBASE_DATABASE_AUTH || process.env.FIREBASE_DATABASE_SECRET || '';
}

// A serverless instance's in-memory cache is not a durable or shared source of
// truth for identities, payments or download entitlements.
function requiresRemoteAuthority(_path: string): boolean {
  // Vercel instances do not share process memory or a writable filesystem.
  // Every production record, including logs and rate limits, needs Firebase.
  return process.env.NODE_ENV === 'production';
}

function assertRemoteAuthority(path: string): void {
  if (usesSupabase()) return;
  if (requiresRemoteAuthority(path) && (!process.env.FIREBASE_DATABASE_URL || !getRtdbAuth())) {
    throw new Error('Authenticated Firebase database access is required for account and payment data.');
  }
}

const isDev = process.env.NODE_ENV !== 'production';
const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'local_rtdb_store.json');

let localStore: Record<string, any> = {};

function loadLocalStore() {
  if (!isDev) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      localStore = JSON.parse(raw);
    }
  } catch (err) {
    localStore = {};
  }
}

function saveLocalStore() {
  if (!isDev) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(localStore, null, 2), 'utf-8');
  } catch (err) {}
}

if (isDev) {
  loadLocalStore();
}

export function encodeKey(str: string): string {
  return encodeURIComponent(str.toLowerCase().trim())
    .replace(/\./g, '_dot_')
    .replace(/[$#[\]/]/g, '_');
}

/**
 * Traverses nested memory object by path string e.g. "users/USER_123/profile"
 */
function getPathValue(obj: any, pathStr: string): any {
  if (!obj || !pathStr) return null;
  const parts = pathStr.replace(/^\/+|\/+$/g, '').split('/');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = current[part];
  }
  return current !== undefined ? current : null;
}

function setPathValue(obj: any, pathStr: string, value: any): void {
  const parts = pathStr.replace(/^\/+|\/+$/g, '').split('/');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

function updatePathValue(obj: any, pathStr: string, value: any): any {
  const existing = getPathValue(obj, pathStr) || {};
  const merged = typeof value === 'object' && value !== null ? { ...existing, ...value } : value;
  setPathValue(obj, pathStr, merged);
  return merged;
}

function deletePathValue(obj: any, pathStr: string): void {
  const parts = pathStr.replace(/^\/+|\/+$/g, '').split('/');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') return;
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  delete current[lastPart];
}

export class FirebaseRtdb {
  public static get baseUrl(): string {
    return getRtdbBaseUrl();
  }

  private static getUrl(path: string): string {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    const auth = getRtdbAuth();
    const queryParams = auth ? `?auth=${encodeURIComponent(auth)}` : '';
    return `${this.baseUrl}/${cleanPath}.json${queryParams}`;
  }

  /**
   * Check connection to Firebase Realtime Database
   */
  public static async testConnection(): Promise<{ connected: boolean; url: string; error?: string; mode: string }> {
    if (usesSupabase()) {
      try { await SupabaseStore.get('settings'); return { connected: true, url: 'Supabase', mode: 'SUPABASE' }; }
      catch { return { connected: false, url: 'Supabase', mode: 'SUPABASE', error: 'Database unavailable' }; }
    }
    const configuredUrl = process.env.FIREBASE_DATABASE_URL || '(not configured)';
    const fallbackMode = isDev ? 'LOCAL_DEVELOPMENT_FALLBACK' : 'REMOTE_REQUIRED';
    try {
      assertRemoteAuthority('orders');
      const url = this.getUrl('health_check');
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: new Date().toISOString(), status: 'active' }),
        signal: AbortSignal.timeout(4000),
      });

      if (response.ok) {
        return { connected: true, url: configuredUrl, mode: 'DIRECT_REMOTE_SYNC' };
      } else {
        return {
          connected: false,
          url: configuredUrl,
          error: `Firebase connection failed (HTTP ${response.status}).`,
          mode: fallbackMode,
        };
      }
    } catch (err: any) {
      return {
        connected: false,
        url: configuredUrl,
        error: err.message || 'Firebase connection failed.',
        mode: fallbackMode,
      };
    }
  }

  /**
   * Generic GET from RTDB with local store fallback
   */
  public static async get<T>(path: string): Promise<T | null> {
    if (usesSupabase()) return SupabaseStore.get<T>(path);
    assertRemoteAuthority(path);
    try {
      const url = this.getUrl(path);
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data !== null) {
          setPathValue(localStore, path, data);
          saveLocalStore();
        }
        return data as T;
      }
      if (requiresRemoteAuthority(path)) throw new Error(`Firebase read failed (HTTP ${res.status}).`);
    } catch (err) {
      if (requiresRemoteAuthority(path)) throw err;
    }

    // Fallback to persistent local store
    const cached = getPathValue(localStore, path);
    return cached as T | null;
  }

  /**
   * Generic PUT to RTDB with local store backup
   */
  public static async set<T>(path: string, data: T): Promise<T | null> {
    if (usesSupabase()) return SupabaseStore.set(path, data);
    assertRemoteAuthority(path);
    try {
      const url = this.getUrl(path);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        if (requiresRemoteAuthority(path)) throw new Error(`Firebase write failed (HTTP ${res.status}).`);
        const errorText = await res.text();
        console.warn(`[Firebase RTDB Remote Warning] ${path} returned HTTP ${res.status}: ${errorText}. Local fallback used in development.`);
      }
    } catch (err: any) {
      if (requiresRemoteAuthority(path)) throw err;
      console.warn(`[Firebase RTDB Remote Offline] ${path}: ${err?.message}. Local fallback used in development.`);
    }

    setPathValue(localStore, path, data);
    saveLocalStore();

    return data;
  }

  /**
   * Sync all local persistent data to Firebase Realtime Database
   */
  public static async syncLocalToRemote(): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getUrl('');
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localStore),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        return { success: true, message: 'Local store successfully synced to Firebase Realtime Database.' };
      } else {
        const errText = await res.text();
        return { success: false, message: `Firebase returned HTTP ${res.status}: ${errText}` };
      }
    } catch (err: any) {
      return { success: false, message: `Sync failed: ${err?.message || 'Network error'}` };
    }
  }

  /**
   * Generic PATCH to RTDB
   */
  public static async update<T>(path: string, data: Partial<T>): Promise<T | null> {
    if (usesSupabase()) return SupabaseStore.update(path, data) as Promise<T>;
    assertRemoteAuthority(path);
    try {
      const url = this.getUrl(path);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok && requiresRemoteAuthority(path)) throw new Error(`Firebase update failed (HTTP ${res.status}).`);
    } catch (err) {
      if (requiresRemoteAuthority(path)) throw err;
    }
    const updated = updatePathValue(localStore, path, data);
    saveLocalStore();
    return updated as T;
  }

  /**
   * Generic DELETE from RTDB
   */
  public static async delete(path: string): Promise<boolean> {
    if (usesSupabase()) { await SupabaseStore.delete(path); return true; }
    assertRemoteAuthority(path);
    try {
      const url = this.getUrl(path);
      const res = await fetch(url, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
      if (requiresRemoteAuthority(path) && !res.ok) throw new Error(`Firebase delete failed (HTTP ${res.status}).`);
      if (res.ok || !requiresRemoteAuthority(path)) {
        deletePathValue(localStore, path);
        saveLocalStore();
      }
      return res.ok;
    } catch (err) {
      if (requiresRemoteAuthority(path)) throw err;
      deletePathValue(localStore, path);
      saveLocalStore();
      return true;
    }
  }

  // ============================================
  // USER-SPECIFIC DATA ACCESS HELPERS
  // ============================================

  /**
   * Find user ID by email, mobile, or username
   */
  public static async findUserIdByIdentifier(identifier: string): Promise<string | null> {
    const cleanId = identifier.trim().toLowerCase();
    const encoded = encodeKey(cleanId);

    // 1. Check index by email
    const emailLookup = await this.get<string>(`indices/emails/${encoded}`);
    if (emailLookup) return emailLookup;

    // 2. Check index by mobile
    const mobileLookup = await this.get<string>(`indices/mobiles/${encoded}`);
    if (mobileLookup) return mobileLookup;

    // 3. Check index by username
    const usernameLookup = await this.get<string>(`indices/usernames/${encoded}`);
    if (usernameLookup) return usernameLookup;

    // 4. Fallback: Search all users in local/remote store
    const allUsers = await this.get<Record<string, { profile?: { email?: string; mobile?: string; username?: string } }>>('users');
    if (allUsers) {
      for (const [userId, record] of Object.entries(allUsers)) {
        if (
          record.profile?.email?.toLowerCase() === cleanId ||
          record.profile?.mobile?.toLowerCase() === cleanId ||
          record.profile?.username?.toLowerCase() === cleanId
        ) {
          // Heal index
          if (record.profile?.email) {
            await this.set(`indices/emails/${encodeKey(record.profile.email)}`, userId);
          }
          if (record.profile?.mobile) {
            await this.set(`indices/mobiles/${encodeKey(record.profile.mobile)}`, userId);
          }
          if (record.profile?.username) {
            await this.set(`indices/usernames/${encodeKey(record.profile.username)}`, userId);
          }
          return userId;
        }
      }
    }

    return null;
  }

  /**
   * Find user ID by specific mobile number
   */
  public static async findUserIdByMobile(mobile: string): Promise<string | null> {
    const cleanMobile = mobile.replace(/\D/g, '').slice(0, 10);
    if (!cleanMobile) return null;
    const encoded = encodeKey(cleanMobile);
    const lookup = await this.get<string>(`indices/mobiles/${encoded}`);
    if (lookup) return lookup;

    const allUsers = await this.get<Record<string, { profile?: { mobile?: string } }>>('users');
    if (allUsers) {
      for (const [userId, record] of Object.entries(allUsers)) {
        if (record.profile?.mobile === cleanMobile) {
          await this.set(`indices/mobiles/${encodeKey(cleanMobile)}`, userId);
          return userId;
        }
      }
    }
    return null;
  }

  /**
   * Check if email exists
   */
  public static async emailExists(email: string): Promise<boolean> {
    const userId = await this.findUserIdByIdentifier(email);
    return userId !== null;
  }

  /**
   * Check if mobile number exists
   */
  public static async mobileExists(mobile: string): Promise<boolean> {
    const userId = await this.findUserIdByMobile(mobile);
    return userId !== null;
  }

  /**
   * Check if username exists
   */
  public static async usernameExists(username: string): Promise<boolean> {
    const userId = await this.findUserIdByIdentifier(username);
    return userId !== null;
  }

  /**
   * Register new user in RTDB:
   * users/{userId}/profile
   * users/{userId}/credentials
   * users/{userId}/cart
   * users/{userId}/wishlist
   * users/{userId}/orders
   * users/{userId}/downloads
   * users/{userId}/settings
   */
  public static async createUserRecord(
    userId: string,
    profile: {
      id: string;
      name: string;
      email: string;
      mobile: string;
      username: string;
      createdAt: string;
      joinedDate: string;
      avatar?: string;
      country?: string;
      company?: string;
    },
    credentials: {
      passwordHash: string;
    }
  ): Promise<boolean> {
    const userRoot = `users/${userId}`;

    // 1. Save profile
    await this.set(`${userRoot}/profile`, profile);

    // 2. Save hashed credentials ONLY (NEVER plaintext)
    await this.set(`${userRoot}/credentials`, credentials);

    // 3. Initialize separate user structures
    await this.set(`${userRoot}/settings`, {
      emailNotifications: true,
      orderAlerts: true,
      newsletter: false,
    });

    // 4. Update lookup indices
    await this.set(`indices/emails/${encodeKey(profile.email)}`, userId);
    await this.set(`indices/mobiles/${encodeKey(profile.mobile)}`, userId);
    await this.set(`indices/usernames/${encodeKey(profile.username)}`, userId);

    return true;
  }

  /**
   * Retrieve credentials strictly for authentication verification
   * NEVER sent to client
   */
  public static async getUserCredentials(userId: string): Promise<{
    passwordHash: string;
  } | null> {
    return await this.get<{ passwordHash: string }>(`users/${userId}/credentials`);
  }

  /**
   * Update password hash (e.g. after security code reset)
   */
  public static async updatePasswordHash(userId: string, newPasswordHash: string): Promise<boolean> {
    const res = await this.update(`users/${userId}/credentials`, { passwordHash: newPasswordHash });
    return res !== null;
  }

  /**
   * Get user profile (SAFE, credentials stripped)
   */
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

  public static async getGlobalOrder(orderIdOrTxnId: string): Promise<any | null> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(orderIdOrTxnId || '')) return null;
    const direct = await this.get(`orders/${orderIdOrTxnId}`);
    if (direct) return direct;

    const indexedOrderId = await this.get<string>(`paymentTxnIndex/${orderIdOrTxnId}`);
    if (indexedOrderId && /^[A-Za-z0-9_-]{1,100}$/.test(indexedOrderId)) {
      const indexedOrder = await this.get<any>(`orders/${indexedOrderId}`);
      if (indexedOrder?.easebuzzTxnId === orderIdOrTxnId) return indexedOrder;
    }

    // Orders created before the index was added still need to reconcile.
    const allOrdersObj = await this.get<Record<string, any>>('orders');
    if (allOrdersObj && typeof allOrdersObj === 'object') {
      const allOrders = Object.values(allOrdersObj);
      const matched = allOrders.find((o: any) => 
        o && (o.id === orderIdOrTxnId || o.easebuzzTxnId === orderIdOrTxnId ||
          o.transactionId === orderIdOrTxnId || o.orderNumber === orderIdOrTxnId)
      );
      if (matched) return matched;
    }
    return null;
  }

  public static async saveGlobalOrder(order: any): Promise<void> {
    const orderId = order.id || order.orderId;
    await this.setMultiple({
      [`orders/${orderId}`]: order,
      ...(order.userId ? { [`users/${order.userId}/orders/${orderId}`]: order } : {}),
      ...(order.easebuzzTxnId && /^[A-Za-z0-9_-]{1,100}$/.test(order.easebuzzTxnId)
        ? { [`paymentTxnIndex/${order.easebuzzTxnId}`]: orderId }
        : {}),
    });
  }

  /** Atomically update mirrored records with one Firebase root PATCH. */
  public static async setMultiple(records: Record<string, unknown>): Promise<void> {
    if (usesSupabase()) { await SupabaseStore.multiple(records); return; }
    assertRemoteAuthority('orders');
    const entries = Object.entries(records);
    if (!entries.length || entries.some(([key]) => !key || key.startsWith('/') || key.endsWith('/') || key.includes('..'))) {
      throw new Error('Invalid Firebase multi-path update.');
    }
    try {
      const res = await fetch(this.getUrl(''), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Firebase multi-path write failed (HTTP ${res.status}).`);
    } catch (error) {
      if (process.env.NODE_ENV === 'production') throw error;
    }
    for (const [key, value] of entries) setPathValue(localStore, key, value);
    saveLocalStore();
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
  public static async deleteUserAccount(userId: string): Promise<void> {
    const profile = await this.getUserProfile(userId);
    if (profile) {
      if (profile.email) await this.delete(`indices/emails/${encodeKey(profile.email)}`);
      if (profile.username) await this.delete(`indices/usernames/${encodeKey(profile.username)}`);
    }
    await this.delete(`users/${userId}`);
  }

  // --- ADMIN & PRODUCTS / COUPONS / SETTINGS HELPERS ---

  public static async getAllProducts(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('products');
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async getProductById(id: string): Promise<any | null> {
    return await this.get(`products/${id}`);
  }

  public static async saveProduct(product: any): Promise<void> {
    await this.set(`products/${product.id}`, product);
  }

  public static async deleteProduct(id: string): Promise<void> {
    await this.delete(`products/${id}`);
  }

  public static async getAllCoupons(): Promise<any[]> {
    const data = await this.get<Record<string, any>>('coupons');
    if (!data) return [];
    return Array.isArray(data) ? data : Object.values(data);
  }

  public static async saveCoupon(coupon: any): Promise<void> {
    await this.set(`coupons/${coupon.id}`, coupon);
  }

  public static async deleteCoupon(id: string): Promise<void> {
    await this.delete(`coupons/${id}`);
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
