import type { SubscriptionPlan, SubscriptionSummary, SubscriptionCheckout } from '../types/subscription';
export type { SubscriptionPlan, SubscriptionSummary, SubscriptionCheckout } from '../types/subscription';
export class SubscriptionApiError extends Error {constructor(message:string,public status:number){super(message);}}
async function request<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(`/api/marketplace${path}`,{credentials:'include',method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60_000)});
 const result=await response.json().catch(()=>null);if(!response.ok||!result||result.success===false)throw new SubscriptionApiError(result?.message||'We could not complete your request. Please try again.',response.status);return result as T;
}
export const SubscriptionService={
 listPlans:(options:{audience?:'creator'|'customer';creatorId?:string}={})=>{const params=new URLSearchParams();if(options.audience)params.set('audience',options.audience);if(options.creatorId)params.set('creatorId',options.creatorId);return request<{plans:SubscriptionPlan[]}>(`/plans?${params}`);},
 listSubscriptions:()=>request<{subscriptions:SubscriptionSummary[]}>('/subscriptions'),
 subscribe:(planId:string,agreeTerms=false,checkoutQuote?:string)=>request<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>('/subscriptions',{planId,agreeTerms,checkoutQuote}),
 renew:(id:string,agreeTerms=false,checkoutQuote?:string)=>request<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>(`/subscriptions/${encodeURIComponent(id)}/renew`,{agreeTerms,checkoutQuote}),
 resume:(id:string,agreeTerms=false,checkoutQuote?:string)=>request<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>(`/subscriptions/${encodeURIComponent(id)}/resume`,{agreeTerms,checkoutQuote}),
 reconcile:(id:string)=>request<{subscription:SubscriptionSummary}>(`/subscriptions/${encodeURIComponent(id)}/reconcile`,{}),
 cancel:(id:string)=>request<{subscription:SubscriptionSummary;message:string}>(`/subscriptions/${encodeURIComponent(id)}/cancel`,{}),
 ownMembershipPlans:()=>request<{plans:SubscriptionPlan[]}>('/me/membership-plans'),
};
