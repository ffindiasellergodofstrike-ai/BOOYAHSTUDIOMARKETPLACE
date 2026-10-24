import { CartItem, Product, Coupon } from '../types';
import { ProductService } from './ProductService';
import { AuthService } from './AuthService';

const CART_STORAGE_KEY = 'booyah-studio_cart_v1';
const LEGACY_CART_STORAGE_KEY = 'booyah-studio_cart_v1';
const COUPON_STORAGE_KEY = 'booyah-studio_coupon_v1';
const LEGACY_COUPON_STORAGE_KEY = 'booyah-studio_coupon_v1';

type CartListener = (cart: CartItem[], coupon: Coupon | null) => void;

class CartServiceImpl {
  private items: CartItem[] = [];
  private appliedCoupon: Coupon | null = null;
  private listeners: Set<CartListener> = new Set();
  private isSyncing = false;

  constructor() {
    this.loadFromStorage();
    // Subscribe to auth changes to sync user-specific cart from Supabase
    let previousUserId = localStorage.getItem('booyahstudio_cart_owner');
    AuthService.subscribe((user) => {
      if (user) {
        const mergeGuest = !previousUserId;
        if (previousUserId && previousUserId !== user.id) this.items = [];
        previousUserId = user.id;
        localStorage.setItem('booyahstudio_cart_owner', user.id);
        void this.fetchUserCart(mergeGuest);
      } else if (previousUserId) {
        previousUserId = null;
        localStorage.removeItem('booyahstudio_cart_owner');
        this.items = [];
        this.appliedCoupon = null;
        this.saveToStorage();
      }
    });
  }

  private normalizeItems(rawItems: any[]): CartItem[] {
    const byProductId = new Map<string, CartItem>();

    for (const item of rawItems) {
      const fresh = ProductService.getProductById(item?.product?.id || item?.productId) || item?.product;
      if (!fresh?.id) continue;

      const quantity = 1;
      const existing = byProductId.get(fresh.id);
      if (existing) {
        existing.quantity = 1;
        continue;
      }

      byProductId.set(fresh.id, {
        product: fresh,
        price: fresh.price,
        quantity: 1,
        addedAt: item.addedAt || new Date().toISOString(),
      });
    }

    return Array.from(byProductId.values());
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY) || localStorage.getItem(LEGACY_CART_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.items = this.normalizeItems(Array.isArray(parsed) ? parsed : []);
      }
      const storedCoupon = localStorage.getItem(COUPON_STORAGE_KEY) || localStorage.getItem(LEGACY_COUPON_STORAGE_KEY);
      if (storedCoupon) {
        this.appliedCoupon = JSON.parse(storedCoupon);
      }
    } catch {
      this.items = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(this.items));
      if (this.appliedCoupon) {
        localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(this.appliedCoupon));
      } else {
        localStorage.removeItem(COUPON_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable
    }
    this.notify();
    this.syncWithBackend();
  }

  public async fetchUserCart(mergeGuest = false): Promise<void> {
    if (!AuthService.isAuthenticated() || this.isSyncing) return;
    try {
      this.isSyncing = true;
      const res = await fetch('/api/user/cart', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          this.items = this.normalizeItems(mergeGuest ? [...this.items, ...data.items] : data.items);
          localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(this.items));
          this.notify();
        }
      }
    } catch (err) {
      console.warn('Could not sync user cart from backend:', err);
    } finally {
      this.isSyncing = false;
      if (mergeGuest) this.saveToStorage();
    }
  }

  private async syncWithBackend() {
    if (!AuthService.isAuthenticated() || this.isSyncing) return;
    try {
      await fetch('/api/user/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: this.items }),
      });
    } catch {
      // Silently retry on next action
    }
  }

  public subscribe(listener: CartListener): () => void {
    this.listeners.add(listener);
    listener(this.getItems(), this.appliedCoupon);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const current = this.getItems();
    this.listeners.forEach((l) => l(current, this.appliedCoupon));
  }

  public getItems(): CartItem[] {
    return [...this.items];
  }

  public getItemCount(): number {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  public addItem(product: Product, quantity = 1): void {
    const existingIndex = this.items.findIndex((item) => item.product.id === product.id);

    if (existingIndex > -1) {
      this.items[existingIndex].quantity = 1;
    } else {
      this.items.push({
        product,
        price: product.price,
        quantity: 1,
        addedAt: new Date().toISOString(),
      });
    }
    this.saveToStorage();
  }

  public removeItem(productId: string): void {
    this.items = this.items.filter((item) => item.product.id !== productId);
    this.saveToStorage();
  }

  public updateQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId);
      return;
    }
    const target = this.items.find((item) => item.product.id === productId);
    if (target) {
      target.quantity = 1;
      this.saveToStorage();
    }
  }

  public clearCart(): void {
    this.items = [];
    this.appliedCoupon = null;
    this.saveToStorage();
  }

  public applyCoupon(code: string): { success: boolean; message: string; coupon?: Coupon } {
    const coupon = ProductService.getCoupon(code);
    if (!coupon) {
      return { success: false, message: 'Invalid promotional code' };
    }
    const subtotal = this.getSubtotal();
    if (coupon.minSpend && subtotal < coupon.minSpend) {
      return {
        success: false,
        message: `This coupon requires a minimum subtotal of INR ${coupon.minSpend}.00`,
      };
    }
    this.appliedCoupon = coupon;
    this.saveToStorage();
    return {
      success: true,
      message: `Coupon "${coupon.code}" applied: ${coupon.discountPercent}% OFF!`,
      coupon,
    };
  }

  public removeCoupon(): void {
    this.appliedCoupon = null;
    this.saveToStorage();
  }

  public getAppliedCoupon(): Coupon | null {
    return this.appliedCoupon;
  }

  public getSubtotal(): number {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  public getDiscount(): number {
    const subtotal = this.getSubtotal();
    if (!this.appliedCoupon) return 0;
    return Math.round((subtotal * (this.appliedCoupon.discountPercent / 100)) * 100) / 100;
  }

  public getTotals(): { subtotal: number; discount: number; tax: number; total: number } {
    const subtotal = this.getSubtotal();
    const discount = this.getDiscount();
    const tax = 0;
    const total = Math.max(0, subtotal - discount + tax);
    return {
      subtotal,
      discount,
      tax,
      total,
    };
  }

  public hasItem(productId: string): boolean {
    return this.items.some((item) => item.product.id === productId);
  }
}

export const CartService = new CartServiceImpl();
