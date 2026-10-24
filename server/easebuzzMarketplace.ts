/** RETIRED SCAFFOLD: not mounted by this project. Active marketplace uses creatorMarketplace, gatewayControl, gatewaySplits and subscriptions. Do not activate this legacy adapter. */
import crypto from 'node:crypto';
export const gatewayHash = (...parts: string[]) => crypto.createHash('sha512').update(parts.join('|')).digest('hex');
export function marketplaceCredentials() {
  const key = process.env.EASEBUZZ_KEY, salt = process.env.EASEBUZZ_SALT;
  if (!key || !salt || process.env.EASEBUZZ_MARKETPLACE_APPROVED !== 'true') throw new Error('Marketplace payment onboarding is not enabled.');
  return {key,salt};
}
export async function marketplaceRequest(path: string, body: unknown): Promise<any> {
  marketplaceCredentials();
  const base = ['prod','production','live'].includes(process.env.EASEBUZZ_ENV || '') ? 'https://dashboard.easebuzz.in' : 'https://testdashboard.easebuzz.in';
  const response = await fetch(base + path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Payment partner request could not be confirmed.');
  const result = await response.json();
  if (result.status !== true && result.status !== 'success') throw new Error('Payment partner has not accepted this request.');
  return result;
}
export async function createSubmerchant(seller: any, bank: any, password: string) {
  const {key,salt}=marketplaceCredentials();
  return marketplaceRequest('/merchant/v1/submerchant/create/', {
    merchant_details:{merchant_key:key,hash:gatewayHash(key,seller.email,seller.phone,salt)},
    submerchant_details:{sub_merchant_name:seller.legalName,sub_merchant_email:seller.email,sub_merchant_phone:seller.phone,
      sub_merchant_name_in_bank:bank.holder,sub_merchant_account_number:bank.account,sub_merchant_bank_name:bank.bank,
      sub_merchant_branch_name:bank.branch,sub_merchant_ifsc_code:bank.ifsc,sub_merchant_password:password,sub_merchant_confirm_password:password}
  });
}
export async function kycLink(seller:any) {
  const {key,salt}=marketplaceCredentials();
  const result=await marketplaceRequest('/submerchant/v1/generate_kyc_access_key',{merchant_key:key,sub_merchant_id:seller.providerId,name:seller.legalName,email:seller.email,phone:seller.phone,hash:gatewayHash(key,seller.providerId,seller.legalName,seller.email,seller.phone,salt)});
  const url=new URL(result.kyc_dashboard_url);
  if(url.protocol!=='https:' || url.hostname!=='kyc.easebuzz.in') throw new Error('Verification link could not be validated.');
  return url.href;
}
export function verifyKycWebhook(payload:any): boolean {
  const {key,salt}=marketplaceCredentials();
  const data=payload?.data;
  if(!data || typeof data.submerchant_id!=='string' || typeof data.hash!=='string' || !/^[a-f0-9]{128}$/i.test(data.hash)) return false;
  const expected=gatewayHash(key,data.submerchant_id,salt);
  return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(data.hash,'hex'));
}
export async function createSplit(id:string, paymentId:string, amount:number, configuration:any[]) {
  const {key,salt}=marketplaceCredentials();
  return marketplaceRequest('/post-split/v1/create/',{key,merchant_request_id:id,easebuzz_id:paymentId,amount:(amount/100).toFixed(2),configuration,hash:gatewayHash(key,id,paymentId,salt)});
}
export async function getSplit(id:string) {
  const {key,salt}=marketplaceCredentials();
  return marketplaceRequest('/post-split/v1/retrieve/',{key,merchant_request_id:id,hash:gatewayHash(key,id,salt)});
}
export async function requestSettlement(id:string, paymentId:string, txnId:string, amount:number) {
  const {key,salt}=marketplaceCredentials(); const formatted=(amount/100).toFixed(2);
  const email=process.env.EASEBUZZ_MERCHANT_EMAIL;
  if(!email) throw new Error('Settlement account is not configured.');
  return marketplaceRequest('/settlements/v1/ondemand/initiate/',{key,merchant_email:email,merchant_batch_id:id,transactions:[{easebuzz_id:paymentId,merchant_txn_id:txnId,amount:formatted,hash:gatewayHash(key,paymentId,txnId,formatted,salt)}]});
}
export async function settlementStatus(id:string) {
  const {key,salt}=marketplaceCredentials(); const email=process.env.EASEBUZZ_MERCHANT_EMAIL || '';
  return marketplaceRequest('/settlements/v1/ondemand/status/',{key,merchant_email:email,merchant_batch_id:id,hash:gatewayHash(key,email,id,salt)});
}
