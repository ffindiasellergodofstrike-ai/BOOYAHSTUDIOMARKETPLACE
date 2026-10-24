export type CheckoutProvider = 'cashfree' | 'razorpay' | 'easebuzz';
export type GatewayAvailability = Partial<Record<CheckoutProvider, { configured: boolean; environment: string; enabled?: boolean; ready?: boolean; isDefault?: boolean }>>;
export function selectCustomerCheckout(gateways: GatewayAvailability, _singleItem = true): CheckoutProvider | null {
 const providers: CheckoutProvider[] = ['cashfree', 'razorpay', 'easebuzz'];
 const available = (provider: CheckoutProvider) => Boolean(gateways[provider]?.configured && gateways[provider]?.enabled !== false && gateways[provider]?.ready !== false && ['live', 'test'].includes(gateways[provider]?.environment || ''));
 return providers.find(provider => available(provider) && gateways[provider]?.isDefault) || providers.find(available) || null;
}
