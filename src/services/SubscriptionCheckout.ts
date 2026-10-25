import { approvedHostedCheckoutUrl, loadGatewaySdk } from './GatewayCheckout';
import type { SubscriptionCheckout } from '../types/subscription';
/** SDK callbacks only trigger server reconciliation. They never grant a paid plan. */
export async function openSubscriptionCheckout(checkout:SubscriptionCheckout):Promise<void>{
 const returnURL=new URL(checkout.returnUrl,window.location.origin);if(returnURL.origin!==window.location.origin||returnURL.pathname!=='/memberships')throw new Error('Invalid subscription return address.');
 if(checkout.mode==='hosted'){
  window.location.assign(approvedHostedCheckoutUrl(checkout.url,checkout.provider,checkout.environment));return;
 }
 await loadGatewaySdk(checkout.provider==='cashfree'?'cashfree':'razorpay');
 if(checkout.provider==='cashfree'&&checkout.mode==='cashfree'){
  const factory=(window as any).Cashfree;if(typeof factory!=='function')throw new Error('Cashfree checkout could not load. Please try again.');
  const sdk=factory({mode:checkout.environment==='live'?'production':'sandbox'});
  const result=checkout.subscriptionSessionId?await sdk.subscriptionsCheckout({subsSessionId:checkout.subscriptionSessionId,redirectTarget:'_self'}):await sdk.checkout({paymentSessionId:checkout.paymentSessionId,redirectTarget:'_self'});
  if(result?.error)throw new Error('Checkout could not be completed. Your membership status has not changed.');return;
 }
 if(checkout.provider==='razorpay'&&checkout.mode==='razorpay'){
  if(!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(checkout.keyId||'')||!/^((sub|order)_[A-Za-z0-9]+)$/.test(checkout.subscriptionId||checkout.orderId||''))throw new Error('Invalid payment session.');
  await new Promise<void>((resolve,reject)=>{
   const modal=new (window as any).Razorpay({key:checkout.keyId,...(checkout.subscriptionId?{subscription_id:checkout.subscriptionId}:{order_id:checkout.orderId,amount:checkout.amount,currency:'INR'}),name:'BooyahMarket',description:'Membership',theme:{color:'#c94a1a'},handler:()=>{window.location.assign(returnURL.href);resolve();},modal:{ondismiss:()=>reject(new Error('Checkout closed. You can check your membership status below.'))}});
   modal.on('payment.failed',()=>reject(new Error('Payment was not completed. Please check your membership status before retrying.')));modal.open();
  });return;
 }
 throw new Error('This payment option is not available.');
}
