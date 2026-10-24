export type SubscriptionProvider = 'cashfree' | 'razorpay' | 'easebuzz';
export type BillingMode = 'manual' | 'automatic';
export interface SubscriptionPlan {
 [key:string]: unknown;
 id: string; name: string; description: string; audience: 'creator' | 'customer'; creatorId?: string;
 amount: number; currency: 'INR'; interval: 'month' | 'year'; billingMode: BillingMode;
 published: boolean; productLimit?: number | null; monthlyProductLimit?: number | null; features: string[]; updatedAt?: string;
 checkoutQuote?: string;
}
export interface SubscriptionSummary {
 id: string; userId: string; planId: string; planName: string; audience: 'creator' | 'customer'; creatorId?: string;
 provider: SubscriptionProvider; environment: 'live' | 'test'; billingMode: BillingMode; status: string;
 amount: number; currency: 'INR'; interval: 'month' | 'year'; currentPeriodStart?: string; currentPeriodEnd?: string;
 cancelAtPeriodEnd: boolean; createdAt: string; hasAccess: boolean;
 checkoutQuote?: string;
}
export interface SubscriptionCheckout {
 provider: SubscriptionProvider; mode: 'hosted' | 'cashfree' | 'razorpay'; environment: 'live' | 'test';
 url?: string; paymentSessionId?: string; subscriptionSessionId?: string; subscriptionId?: string;
 keyId?: string; orderId?: string; amount?: number; currency?: 'INR'; returnUrl: string; note?: string;
}
