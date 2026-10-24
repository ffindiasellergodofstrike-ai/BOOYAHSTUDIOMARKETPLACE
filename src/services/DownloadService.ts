import { Order, OrderItem } from '../types';
import { OrderService } from './OrderService';
import { AuthService } from './AuthService';
import { isVerifiedPaidOrder } from './PaymentVerification';

export interface DownloadToken {
  token: string;
  orderId: string;
  productId: string;
  expiresAt: number;
  downloadUrl: string;
}

class DownloadServiceImpl {
  /**
   * Verify digital download authorization via backend API.
   * Checks customer ownership, order payment status, and generates a time-limited protected access token.
   */
  public async getProtectedDownload(
    orderId: string,
    productId: string
  ): Promise<{ success: boolean; downloadUrl?: string; token?: string; message?: string }> {
    const user = AuthService.getCurrentUser();
    if (!user || !AuthService.isAuthenticated()) {
      return {
        success: false,
        message: 'Authentication required. Please sign in to access your digital downloads.',
      };
    }

    try {
      const res = await fetch(`/api/downloads/${encodeURIComponent(productId)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      return res.ok && data.success
        ? { success: true, downloadUrl: data.downloadUrl, token: data.token }
        : { success: false, message: data.message || 'Download authorization denied.' };
    } catch {
      return { success: false, message: 'Could not verify the purchase. Please retry.' };
    }
  }

  /**
   * Get all active authorized downloads for the current authenticated user from backend
   */
  public async fetchUserDownloads(): Promise<any[]> {
    if (!AuthService.isAuthenticated()) return [];
    try {
      const res = await fetch('/api/user/downloads', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.downloads)) {
          return data.downloads;
        }
      }
    } catch (err) {
      console.warn('Could not fetch user downloads:', err);
    }
    return [];
  }

  public getUserDownloads(): Array<{
    order: Order;
    item: OrderItem;
    isAccessible: boolean;
  }> {
    const user = AuthService.getCurrentUser();
    if (!user) return [];

    const orders = OrderService.getOrdersForUser(user.email);
    const downloads: Array<{ order: Order; item: OrderItem; isAccessible: boolean }> = [];

    for (const order of orders) {
      const orderHasAccess = isVerifiedPaidOrder(order);
      for (const item of order.items) {
        downloads.push({
          order,
          item,
          isAccessible: orderHasAccess && (item as any).refunded !== true && (item as any).accessStatus !== 'restricted' && item.downloadStatus !== 'REVOKED',
        });
      }
    }

    return downloads;
  }
}

export const DownloadService = new DownloadServiceImpl();
