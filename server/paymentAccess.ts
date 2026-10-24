import crypto from 'node:crypto';
import { hasLivePayment } from '../src/services/PaymentEnvironment';
import { Store } from './store';

/** Original verified funding proof; a later refund may change access without erasing the receipt. */
export function hasVerifiedEasebuzzFunding(order: any): boolean {
  const payment = order?.payments?.[order?.transactionId];
  return Boolean(order && String(order.paymentProvider).toLowerCase() === 'easebuzz' && order.paymentEnvironment === 'live' &&
    order.easebuzzTxnId && order.transactionId && Number.isFinite(Date.parse(order.paymentVerifiedAt)) &&
    payment?.id === order.transactionId && payment.txnid === order.easebuzzTxnId && payment.status === 'success' &&
    payment.environment === 'live' && payment.currency === 'INR' && Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
    payment.amount === Math.round(Number(order.total) * 100) && Number.isSafeInteger(payment.refundedPaise) &&
    payment.refundedPaise >= 0 && payment.refundedPaise <= payment.amount && Number.isFinite(Date.parse(payment.verifiedAt)));
}

export function isPaidOrderForProduct(order: any, userId: string, productId: string): boolean {
  const provider = String(order?.paymentProvider || '').toLowerCase();
  const paymentStatus = String(order?.paymentStatus || '').toUpperCase();
  const item = Array.isArray(order?.items) ? order.items.find((entry: any) => entry.productId === productId) : null;
  const cashfree = provider === 'cashfree';
  const easebuzz = provider === 'easebuzz';
  const payment = cashfree && order?.payments?.[order.transactionId];
  const easebuzzPayment = easebuzz && order?.payments?.[order.transactionId];
  const providerVerified = cashfree
    ? Boolean(order.cashfreeOrderId && payment?.status === 'SUCCESS' && payment.order_id === order.cashfreeOrderId &&
        payment.environment === 'live' && payment.currency === 'INR' && payment.amount === Math.round(Number(order.total) * 100))
    : easebuzz ? hasVerifiedEasebuzzFunding(order) && easebuzzPayment.refundedPaise === 0
      : provider === 'razorpay';
  return Boolean(
    order && hasLivePayment(order) && order.userId === userId &&
    (paymentStatus === 'PAID' || (cashfree && paymentStatus === 'PARTIALLY_REFUNDED')) &&
    providerVerified && Boolean(order.transactionId) &&
    !['REFUNDED', 'REVOKED', 'CANCELLED', 'FAILED', ...(cashfree ? [] : ['PARTIALLY_REFUNDED'])].includes(String(order.status).toUpperCase()) &&
    order.deliveryStatus === 'DELIVERED' && order.downloadStatus === 'AVAILABLE' &&
    item && item.refunded !== true && item.accessStatus !== 'restricted' && item.downloadStatus !== 'REVOKED'
  );
}

export function easebuzzRetrieveHash(merchantKey: string, txnid: string, salt: string): string {
  return crypto.createHash('sha512').update(`${merchantKey}|${txnid}|${salt}`).digest('hex');
}

export function matchesVerifiedEasebuzzPayment(providerPayment: any, order: any, merchantKey: string): boolean {
  if (!providerPayment || !order) return false;
  if (providerPayment.status !== 'success') return false;
  if (providerPayment.txnid !== order.easebuzzTxnId && providerPayment.txnid !== order.id && providerPayment.txnid !== order.orderNumber) return false;
  if (providerPayment.key && providerPayment.key !== merchantKey) return false;
  const paidAmount = parseFloat(providerPayment.amount);
  const expectedAmount = parseFloat(order.total);
  if (isNaN(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) return false;
  return true;
}

export async function findPaidPurchase(
  userId: string,
  productId: string,
  purchaseId?: string,
  orderId?: string
): Promise<any | null> {
  const purchases = await Store.getUserPurchases(userId);
  for (const purchase of purchases) {
    if (!purchase || purchase.userId !== userId || purchase.productId !== productId ||
        purchase.accessStatus !== 'active' || !purchase.orderId || !purchase.purchaseId ||
        (purchaseId && purchase.purchaseId !== purchaseId) ||
        (orderId && purchase.orderId !== orderId)) continue;
    const order = await Store.getGlobalOrder(purchase.orderId);
    if (isPaidOrderForProduct(order, userId, productId)) return purchase;
  }
  return null;
}
