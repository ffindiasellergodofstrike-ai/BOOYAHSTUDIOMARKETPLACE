/** Provider-owned recurring receipts need query pagination, unlike ordinary product routes. */
export async function razorpayBillingList(resource:'invoices'|'subscriptions'|'orders',filter:{subscription_id?:string;from?:number}={}):Promise<any[]>{
 const id=process.env.RAZORPAY_KEY_ID,secret=process.env.RAZORPAY_KEY_SECRET;
 if(!id||!secret)throw new Error('Razorpay billing is not configured.');
 const all:any[]=[];
 for(let page=0;page<20;page++){
  const query=new URLSearchParams({count:'100',skip:String(page*100)});
  if(filter.subscription_id){if(!/^sub_[A-Za-z0-9]+$/.test(filter.subscription_id))throw new Error('Invalid subscription reference');query.set('subscription_id',filter.subscription_id);}
  if(filter.from&&Number.isSafeInteger(filter.from)&&filter.from>0)query.set('from',String(filter.from));
  const response=await fetch(`https://api.razorpay.com/v1/${resource}?${query}`,{headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Razorpay billing lookup failed.');
  const data=await response.json();if(!Array.isArray(data.items))throw new Error('Invalid Razorpay billing response');all.push(...data.items);
  if(data.items.length<100)return all;
 }
 throw new Error('Billing history requires further reconciliation.');
}
