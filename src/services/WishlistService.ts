import { WishlistItem, Product } from '../types';
import { ProductService } from './ProductService';
import { CartService } from './CartService';
import { AuthService } from './AuthService';

const WISHLIST_STORAGE_KEY = 'booyah-studio_wishlist_v1';
const LEGACY_WISHLIST_STORAGE_KEY = 'booyah-studio_wishlist_v1';

type WishlistListener = (items: WishlistItem[]) => void;

class WishlistServiceImpl {
  private items: WishlistItem[] = [];
  private listeners: Set<WishlistListener> = new Set();
  private isSyncing = false;

  constructor() {
    this.loadFromStorage();
    let previousUserId = localStorage.getItem('booyahstudio_wishlist_owner');
    AuthService.subscribe((user) => {
      if (user) {
        const mergeGuest = !previousUserId;
        if (previousUserId && previousUserId !== user.id) this.items = [];
        previousUserId = user.id;
        localStorage.setItem('booyahstudio_wishlist_owner', user.id);
        void this.fetchUserWishlist(mergeGuest);
      } else if (previousUserId) {
        previousUserId = null;
        localStorage.removeItem('booyahstudio_wishlist_owner');
        this.items = [];
        this.saveToStorage();
      }
    });
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(WISHLIST_STORAGE_KEY) || localStorage.getItem(LEGACY_WISHLIST_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.items = parsed
          .map((item: any) => {
            const fresh = ProductService.getProductById(item.productId || item.product?.id);
            if (!fresh) return null;
            return {
              productId: fresh.id,
              product: fresh,
              addedAt: item.addedAt || new Date().toISOString(),
            };
          })
          .filter(Boolean);
      }
    } catch {
      this.items = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // Storage unavailable
    }
    this.notify();
    this.syncWithBackend();
  }

  public async fetchUserWishlist(mergeGuest = false): Promise<void> {
    if (!AuthService.isAuthenticated() || this.isSyncing) return;
    try {
      this.isSyncing = true;
      const res = await fetch('/api/user/wishlist', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          this.items = (mergeGuest ? [...this.items, ...data.items] : data.items)
            .map((item: any) => {
              const fresh = ProductService.getProductById(item.productId || item.product?.id);
              if (!fresh) return null;
              return {
                productId: fresh.id,
                product: fresh,
                addedAt: item.addedAt || new Date().toISOString(),
              };
            })
            .filter(Boolean);
          this.items = Array.from(new Map(this.items.map(item => [item.product.id, item])).values());
          localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(this.items));
          this.notify();
        }
      }
    } catch (err) {
      console.warn('Could not sync user wishlist:', err);
    } finally {
      this.isSyncing = false;
      if (mergeGuest) this.saveToStorage();
    }
  }

  private async syncWithBackend() {
    if (!AuthService.isAuthenticated() || this.isSyncing) return;
    try {
      await fetch('/api/user/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: this.items }),
      });
    } catch {
      // Silently retry
    }
  }

  public subscribe(listener: WishlistListener): () => void {
    this.listeners.add(listener);
    listener(this.getItems());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const current = this.getItems();
    this.listeners.forEach((l) => l(current));
  }

  public getItems(): WishlistItem[] {
    return [...this.items];
  }

  public getItemCount(): number {
    return this.items.length;
  }

  public isInWishlist(productId: string): boolean {
    return this.items.some((item) => item.productId === productId);
  }

  public toggleWishlist(product: Product): boolean {
    const exists = this.isInWishlist(product.id);
    if (exists) {
      this.items = this.items.filter((item) => item.productId !== product.id);
    } else {
      this.items.push({
        productId: product.id,
        product,
        addedAt: new Date().toISOString(),
      });
    }
    this.saveToStorage();
    return !exists;
  }

  public removeFromWishlist(productId: string): void {
    this.items = this.items.filter((item) => item.productId !== productId);
    this.saveToStorage();
  }

  public moveToCart(productId: string): boolean {
    const item = this.items.find((i) => i.productId === productId);
    if (!item) return false;
    CartService.addItem(item.product, 1);
    this.removeFromWishlist(productId);
    return true;
  }

  public moveAllToCart(): void {
    this.items.forEach((item) => {
      CartService.addItem(item.product, 1);
    });
    this.items = [];
    this.saveToStorage();
  }

  public clearWishlist(): void {
    this.items = [];
    this.saveToStorage();
  }
}

export const WishlistService = new WishlistServiceImpl();
