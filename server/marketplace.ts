/** RETIRED SCAFFOLD: not mounted by this project. Active marketplace uses creatorMarketplace, gatewayControl, gatewaySplits and subscriptions. Do not activate this legacy adapter. */
import crypto from 'node:crypto';
import { z } from 'zod';
import { FirebaseRtdb as DB } from './firebaseRtdb';
import { atomicDocument } from './atomicStore';
import { seal, unseal } from './privateData';
import { SELLER_PLANS, SELLER_AGREEMENT_TEXT, SELLER_AGREEMENT_VERSION, SELLER_CATEGORIES } from '../src/config/marketplace';
export class MarketplaceError extends Error {}
export function ensure(condition:unknown,message:string): asserts condition {if(!condition) throw new MarketplaceError(message);}
export const now=()=>new Date().toISOString();
export const commissionBps=()=>{
  const value=Number(process.env.MARKETPLACE_COMMISSION_BPS || '0');
  ensure(Number.isInteger(value)&&value>=0&&value<=5000,'Invalid marketplace commission configuration.'); return value;
};
export const config=()=>({plans:SELLER_PLANS,categories:SELLER_CATEGORIES,commissionBps:commissionBps(),agreementVersion:SELLER_AGREEMENT_VERSION,
  operator:process.env.MARKETPLACE_LEGAL_NAME || '',agreement:SELLER_AGREEMENT_TEXT,
  onboardingEnabled:process.env.EASEBUZZ_MARKETPLACE_APPROVED==='true' && !!process.env.EASEBUZZ_KEY && !!process.env.EASEBUZZ_SALT,
  registrationEnabled:!!process.env.MARKETPLACE_LEGAL_NAME && !!process.env.MARKETPLACE_ENCRYPTION_KEY && (process.env.NODE_ENV!=='production' || process.env.DATABASE_PROVIDER==='supabase')});
export type Seller = {id:string;legalName:string;storeName:string;email:string;phone:string;plan:string;status:string;kycStatus:string;
  privateData:string;panLast4:string;bankLast4:string;agreement:any;createdAt:string;providerId?:string;onboardingStatus?:string;
  splitLabel?:string;approvalReference?:string;hold?:any;products:Record<string,any>;ledger:Record<string,any>;cases:Record<string,any>;events:any[]};
const text=(min:number,max:number)=>z.string().trim().min(min).max(max);
export const registrationSchema=z.object({legalName:text(2,160),storeName:text(2,80),phone:z.string().regex(/^[6-9]\d{9}$/),address:text(15,500),
 pan:z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/),gstin:z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/).default(''),
 holder:text(2,160),account:z.string().regex(/^\d{9,18}$/),ifsc:z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),bank:text(2,100),branch:text(2,100),
 plan:z.enum(['starter','creator','studio']),signedName:text(2,160),agreementVersion:z.literal(SELLER_AGREEMENT_VERSION),commissionBps:z.number().int(),
 acceptAgreement:z.literal(true),ownsRights:z.literal(true),adult:z.literal(true)});
export const productSchema=z.object({title:text(5,120),description:text(60,12000),price:z.number().min(1).max(100000).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7,'Use at most two decimal places'),category:z.enum(SELLER_CATEGORIES),
 image:z.string().url().max(2000),previewUrl:z.string().url().max(2000),version:text(1,40),fileSize:text(1,50),license:text(20,4000),requirements:text(5,2000),
 whatsIncluded:text(10,4000),support:text(10,1000),sourceUrl:z.string().url().max(4000),ownsRights:z.literal(true)});
export const getSeller=(id:string)=>DB.get<Seller>(`marketplace_sellers/${id}`);
export const getSellers=async()=>Object.values(await DB.get<Record<string,Seller>>('marketplace_sellers') || {});
export function record(s:Seller,actor:string,event:string,detail:string) {s.events.push({at:now(),actor,event,detail});return s;}
export async function registerSeller(id:string,email:string,input:unknown,ip:string) {
 const data=registrationSchema.parse(input);const cfg=config();ensure(cfg.registrationEnabled,'Seller registration will open after business setup is complete.');
 ensure(data.signedName===data.legalName,'Signature must match your legal name.');ensure(data.commissionBps===cfg.commissionBps,'Commission has changed. Review the agreement again.');
 const {pan,account,holder,ifsc,bank,branch,address,gstin}=data;
 const encrypted=seal({pan,account,holder,ifsc,bank,branch,address,gstin},`seller:${id}`);
 const agreementText=`${SELLER_AGREEMENT_TEXT}\nOperator: ${cfg.operator}\nSeller: ${data.legalName}\nPlan: ${data.plan}\nSubscription: INR 0\nCommission: ${cfg.commissionBps/100}% of gross sale (tax/processor adjustments separately disclosed).`;
 return atomicDocument<Seller>('marketplace_sellers',id,current=>{ensure(!current,'A seller account already exists.');return {id,legalName:data.legalName,storeName:data.storeName,email,phone:data.phone,plan:data.plan,status:'pending',kycStatus:'pending',privateData:encrypted,panLast4:pan.slice(-4),bankLast4:account.slice(-4),createdAt:now(),
 agreement:{version:SELLER_AGREEMENT_VERSION,text:agreementText,sha256:crypto.createHash('sha256').update(agreementText).digest('hex'),signedName:data.signedName,acceptedAt:now(),ip,commissionBps:cfg.commissionBps,operator:cfg.operator},products:{},ledger:{},cases:{},events:[]};});
}
export function sellerView(s:Seller,admin=false) {
 const {privateData,products,...safe}=s;
 return {...safe,agreement:admin?s.agreement:{...s.agreement,ip:undefined},events:admin?s.events:s.events.map(({actor,...event})=>event),
 products:Object.values(products).map(({encryptedSource,...p}:any)=>p)};
}
export function validateSource(raw:string) {
 const url=new URL(raw);ensure(url.protocol==='https:'&&!url.username&&!url.password&&!url.port,'Use an approved HTTPS file source.');
 const allowed=(process.env.SELLER_DOWNLOAD_HOSTS || 'mega.nz').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 ensure(allowed.includes(url.hostname)&&!/^\d|localhost$|\.local$|\.internal$/i.test(url.hostname),'This storage host is not approved.');
 if(url.hostname==='mega.nz') ensure(url.pathname.startsWith('/file/')&&url.hash.length>10,'Use a complete private MEGA file link.');
 return url.href;
}
export async function submitProduct(id:string,input:unknown) {
 const data=productSchema.parse(input);validateSource(data.sourceUrl);
 for(const url of [data.image,data.previewUrl]) ensure(new URL(url).protocol==='https:','Images and previews must use HTTPS.');
 const productId=`seller_${crypto.randomBytes(12).toString('hex')}`;
 const encryptedSource=seal(data.sourceUrl,`product:${productId}`);
 return atomicDocument<Seller>('marketplace_sellers',id,s=>{ensure(s,'Create your seller account first.');ensure(['pending','approved'].includes(s.status),'Your account cannot submit products.');
 const limit=SELLER_PLANS.find(p=>p.id===s.plan)!.productLimit;ensure(Object.keys(s.products).length<limit,'Your plan catalog limit has been reached.');
 const {sourceUrl,ownsRights,requirements,whatsIncluded,...fields}=data;
 s.products[productId]={...fields,id:productId,slug:productId,sellerId:id,sellerName:s.storeName,requirements:requirements.split('\n'),whatsIncluded:whatsIncluded.split('\n'),shortDescription:data.description.slice(0,220),categoryLabel:data.category,productType:'DOWNLOAD',fileFormat:'ZIP',tags:[],features:[],gallery:[],faqs:[],status:'pending',submittedAt:now(),encryptedSource};return record(s,id,'PRODUCT_SUBMITTED',productId);});
}
export async function publicMarketplaceProducts() {return (await getSellers()).filter(s=>s.status==='approved'&&s.kycStatus==='approved').flatMap(s=>Object.values(s.products).filter(p=>p.status==='active').map(({encryptedSource,reviewNote,submittedAt,...p})=>p));}
export async function sellerSource(productId:string) {
 for(const s of await getSellers()) {const p=s.products[productId];if(p){ensure(p.status!=='removed','Product delivery is under review.');return validateSource(unseal<string>(p.encryptedSource,`product:${productId}`));}}
 throw new MarketplaceError('Product source is unavailable.');
}
export async function prepareMarketplaceOrder(items:any[],method:string,discountCode:unknown) {
 const owners=new Set(items.map(i=>i.product.sellerId || 'store'));
 ensure(owners.size===1,'Please check out products from one seller at a time.');
 const id=items[0]?.product.sellerId;if(!id)return undefined;
 ensure(String(method).toLowerCase().includes('easebuzz'),'Choose the available secure payment method for this seller.');
 ensure(!discountCode,'Store coupons do not apply to independent seller products.');
 const s=await getSeller(id);ensure(s&&s.status==='approved'&&s.kycStatus==='approved'&&!s.hold,'This seller is temporarily unavailable.');
 ensure(s.splitLabel&&s.approvalReference&&process.env.EASEBUZZ_MARKETPLACE_APPROVED==='true'&&process.env.EASEBUZZ_ONDEMAND_APPROVED==='true','Seller checkout is not available yet.');
 return {sellerId:id,sellerName:s.storeName,commissionBps:s.agreement.commissionBps,agreementVersion:s.agreement.version};
}
export async function accrueSale(order:any) {
 if(!order.marketplace)return;
 ensure(order.paymentProvider==='Easebuzz'&&order.paymentStatus==='PAID'&&order.paymentEnvironment==='live','Verified marketplace payment required.');
 const gross=Math.round(Number(order.total)*100);ensure(Number.isSafeInteger(gross)&&gross>0,'Invalid sale amount.');
 const fee=Math.round(gross*order.marketplace.commissionBps/10000);
 await atomicDocument<Seller>('marketplace_sellers',order.marketplace.sellerId,s=>{ensure(s,'Seller record missing.');if(s.ledger[order.id])return s;
 s.ledger[order.id]={orderId:order.id,grossPaise:gross,commissionPaise:fee,sellerPaise:gross-fee,refundPaise:0,paymentId:order.transactionId,merchantTxnId:order.easebuzzTxnId,status:'pending',createdAt:now(),eligibleAt:new Date(Date.now()+7*86400000).toISOString()};return record(s,'payment','SALE_VERIFIED',order.id);});
}
