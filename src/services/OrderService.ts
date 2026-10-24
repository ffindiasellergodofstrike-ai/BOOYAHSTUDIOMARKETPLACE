import { Order, OrderItem, CartItem, Product } from '../types';
import { AuthService } from './AuthService';
import { isVerifiedPaidOrder } from './PaymentVerification';

const isDownloadableOrder = isVerifiedPaidOrder;
const itemHasAccess = (item: any): boolean => item.refunded !== true && item.accessStatus !== 'restricted' && item.downloadStatus !== 'REVOKED';

class OrderServiceImpl {
  private orders: Order[] = [];

  constructor() {
    AuthService.subscribe((user) => {
      if (user) {
        void this.fetchUserOrders();
      } else {
        this.orders = [];
      }
    });
  }

  public async fetchUserOrders(options: { throwOnError?: boolean } = {}): Promise<Order[]> {
    const ownerId = AuthService.getCurrentUser()?.id;
    if (!ownerId) return [];
    try {
      const res = await fetch('/api/user/orders', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.orders)) {
          if (AuthService.getCurrentUser()?.id !== ownerId) return [];
          this.orders = data.orders.filter((order: Order) => order.userId === ownerId);
          return this.orders;
        }
      }
    } catch (err) {
      if (AuthService.getCurrentUser()?.id !== ownerId) return [];
      this.orders = [];
      if (options.throwOnError) throw new Error('We could not load your orders. Please try again.');
      return [];
    }
    if (AuthService.getCurrentUser()?.id === ownerId) {
      this.orders = [];
      if (options.throwOnError) throw new Error('We could not load your orders. Please try again.');
    }
    return [];
  }

  public async fetchOrderById(orderId: string): Promise<Order | null> {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.order) {
          return data.order;
        }
      }
    } catch (err) {
      console.warn('Could not fetch order by ID:', err);
    }
    return null;
  }

  public getOrders(): Order[] {
    return [...this.orders];
  }

  public getOrdersForUser(_email?: string): Order[] {
    const user = AuthService.getCurrentUser();
    return user ? this.orders.filter((order) => order.userId === user.id) : [];
  }

  public getUserOrders(email?: string): Order[] {
    return this.getOrdersForUser(email);
  }

  public getOrderById(id: string): Order | undefined {
    return this.orders.find((o) => o.id === id || o.orderNumber === id);
  }

  public getDownloads(): (OrderItem & { product: Product; quantity?: number })[] {
    const map = new Map<string, OrderItem & { product: Product; quantity?: number }>();
    this.orders
      .filter(isDownloadableOrder)
      .forEach((o) => {
        o.items.filter(itemHasAccess).forEach((item) => {
          map.set(item.productId, item);
        });
      });
    return Array.from(map.values());
  }

  public getUserDownloads(email?: string): (OrderItem & { product: Product; quantity?: number })[] {
    const userOrders = this.getOrdersForUser(email);
    const map = new Map<string, OrderItem & { product: Product; quantity?: number }>();
    userOrders
      .filter(isDownloadableOrder)
      .forEach((o) => {
        o.items.filter(itemHasAccess).forEach((item) => {
          map.set(item.productId, item);
        });
      });
    return Array.from(map.values());
  }

  /**
   * Create a pending order on the server
   */
  public async createPendingOrderAsync(
    cartItems: CartItem[],
    customer: { fullName: string; email: string; phone?: string; company?: string; country: string },
    discount = 0,
    discountCode?: string,
    paymentMethod = 'Credit Card'
  ): Promise<Order> {
    if (!AuthService.isAuthenticated()) throw new Error('Please sign in before checkout.');
    const res = await fetch('/api/user/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items: cartItems, customer, discount, discountCode, paymentMethod, ...(['cashfree', 'razorpay', 'easebuzz'].includes(paymentMethod.toLowerCase()) ? { paymentProvider: paymentMethod.toLowerCase() } : {}) }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.order) {
      throw new Error(data.message || 'Could not create an order. Please retry checkout.');
    }
    if (data.order.userId !== AuthService.getCurrentUser()?.id) {
      throw new Error('Your session changed during checkout. Please sign in and try again.');
    }
    this.orders.unshift(data.order);
    return data.order;
  }

  /**
   * Request a signed, short-lived download token from backend
   */
  public async requestDownloadToken(productId: string, orderId?: string): Promise<{ success: boolean; token?: string; downloadUrl?: string; message?: string }> {
    try {
      const res = await fetch(`/api/downloads/${encodeURIComponent(productId)}/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderId ? { orderId } : {}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          token: data.token,
          downloadUrl: data.downloadUrl,
        };
      }
      return {
        success: false,
        message: data.message || 'Download authorization denied.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error requesting download link.',
      };
    }
  }

}

export const OrderService = new OrderServiceImpl();
