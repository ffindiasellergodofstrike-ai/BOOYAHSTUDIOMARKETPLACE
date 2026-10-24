import 'express-async-errors';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { adminManagementRouter, MAX_PRIVATE_ZIP_BYTES, safeDownloadRows, verifyStagedZipHeader } from './adminManagement';
import { Store } from './store';
import { AuditLogger } from './audit';

test('admin operational inboxes preserve customer records, consent and download token confidentiality', async t => {
 const documents:any={supportRequests:{'BS-help':{reference:'BS-help',name:'Buyer',email:'buyer@example.com',message:'The download needs help.',status:'open',createdAt:'2026-10-22T00:00:00Z'}},newsletterSubscribers:{['a'.repeat(64)]:{email:'buyer@example.com',status:'subscribed',subscribedAt:'2026-10-21T00:00:00Z',lastConsentAt:'2026-10-21T00:00:00Z'}},downloadLogs:{log1:{userId:'buyer',orderId:'order1',productId:'first',event:'DOWNLOAD_AUTHORIZED',downloadUrl:'https://secret.invalid/token',authorizedAt:'2026-10-22T00:00:00Z'}},downloadTokens:{'SECRET_DOWNLOAD_TOKEN':{tokenId:'SECRET_DOWNLOAD_TOKEN',userId:'buyer',orderId:'order1',productId:'first',used:false,expiresAt:1}}};
 const get=(key:string)=>key.split('/').reduce((v:any,p:string)=>v?.[p],documents)??null;
 const write=(key:string,value:any)=>{const parts=key.split('/'),leaf=parts.pop()!;let parent=documents;for(const part of parts)parent=parent[part]??={};parent[leaf]=structuredClone(value);return structuredClone(value);};
 t.mock.method(Store,'get',async(key:string)=>structuredClone(get(key)));
 t.mock.method(Store,'update',async(key:string,value:any)=>write(key,{...get(key),...value}));
 t.mock.method(AuditLogger,'log',async()=>({}));
 const app=express();app.use(express.json());app.use('/api/admin',(req:any,res,next)=>{if(req.get('x-admin')!=='owner')return res.status(403).json({success:false});req.userId='owner';next();},adminManagementRouter);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${(server.address() as any).port}/api/admin`;
 const request=(path:string,body?:any)=>fetch(base+path,{method:body===undefined?'GET':'PATCH',headers:{'x-admin':'owner','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await fetch(base+'/downloads')).status,403);
 assert.equal((await request('/support')).status,200);
 assert.equal((await request('/support/BS-help',{status:'resolved',adminNotes:'Sent the correct help guide.'})).status,200);
 assert.equal(get('supportRequests/BS-help').email,'buyer@example.com');assert.equal(get('supportRequests/BS-help').status,'resolved');assert.ok(get('supportRequests/BS-help').resolvedAt);
 assert.equal((await request('/support/BS-help',{paymentStatus:'PAID'})).status,400);
 assert.equal((await request('/support/missing',{status:'open'})).status,404);
 const id='a'.repeat(64);
 assert.equal((await request(`/subscribers/${id}`,{subscribed:false})).status,200);
 assert.equal(get(`newsletterSubscribers/${id}`).status,'unsubscribed');assert.equal(get(`newsletterSubscribers/${id}`).lastConsentAt,'2026-10-21T00:00:00Z');
 assert.equal((await request(`/subscribers/${id}`,{subscribed:true})).status,200);
 assert.equal(get(`newsletterSubscribers/${id}`).status,'subscribed');
 const downloadResponse=await request('/downloads');const text=await downloadResponse.text();
 assert.ok(!text.includes('SECRET_DOWNLOAD_TOKEN'));assert.ok(!text.includes('secret.invalid'));assert.match(text,/DOWNLOAD_AUTHORIZED/);
 assert.equal(safeDownloadRows({},{}).length,0);
});

test('private ZIP management stages direct uploads, validates content before publication, protects replacements and restores backups',async t=>{
 const previousUrl=process.env.SUPABASE_URL, previousKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://admin.synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
 t.after(()=>{if(previousUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previousUrl;if(previousKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;});
 const documents:any={},files=new Map<string,{bytes:Uint8Array,id:string}>();let failPublish=false, cancelled=0;
 const get=(key:string)=>key.split('/').reduce((v:any,p:string)=>v?.[p],documents)??null;
 const write=(key:string,value:any)=>{const parts=key.split('/'),leaf=parts.pop()!;let parent=documents;for(const part of parts)parent=parent[part]??={};parent[leaf]=structuredClone(value);return structuredClone(value);};
 t.mock.method(Store,'get',async(key:string)=>structuredClone(get(key)));
 t.mock.method(Store,'set',async(key:string,value:any)=>write(key,value));
 t.mock.method(Store,'update',async(key:string,value:any)=>write(key,{...get(key),...value}));
 t.mock.method(Store,'delete',async(key:string)=>{const parts=key.split('/'),leaf=parts.pop()!;let parent=documents;for(const part of parts)parent=parent[part]??={};delete parent[leaf];return true;});
 t.mock.method(Store,'rpc',async(operation:string,key:string)=>{assert.equal(operation,'rate');if(get(key))return false;write(key,true);return true;});
 t.mock.method(Store,'getProductById',async(id:string)=>id==='first'?{id,title:'First'}:null);
 t.mock.method(AuditLogger,'log',async()=>({}));
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(input:any,options?:any)=>{
  const url=new URL(String(input?.url||input));
  if(url.origin!=='https://admin.synthetic.supabase.co')return nativeFetch(input,options);
  if(url.pathname.startsWith('/storage/v1/object/info/products/')){
   const key=url.pathname.split('/products/')[1],file=files.get(key);
   return file?Response.json({id:file.id,name:key,size:file.bytes.byteLength,version:file.id,last_modified:'2026-10-22T01:00:00Z'}):Response.json({message:'Object not found'},{status:404});
  }
  if(url.pathname.startsWith('/storage/v1/object/upload/sign/products/'))return Response.json({url:url.pathname.replace('/storage/v1','')+'?token=synthetic-upload-token'});
  if(url.pathname.startsWith('/storage/v1/object/sign/products/')&&options?.method==='POST')return Response.json({signedURL:url.pathname.replace('/storage/v1','')+'?token=synthetic-read-token'});
  if(url.pathname.startsWith('/storage/v1/object/sign/products/')){
   assert.equal(new Headers(options?.headers).get('range'),'bytes=0-3');
   const file=files.get(url.pathname.split('/products/')[1]);if(!file)return new Response(null,{status:404});
   return new Response(new ReadableStream({start(controller){controller.enqueue(file.bytes);},cancel(){cancelled++;}}),{status:206});
  }
  if(url.pathname==='/storage/v1/object/move'){
   const data=JSON.parse(options.body),file=files.get(data.sourceKey);
   if(!file||files.has(data.destinationKey)||(failPublish&&data.sourceKey.startsWith('_staging/')))return Response.json({message:'Synthetic move failed'},{status:500});
   files.set(data.destinationKey,file);files.delete(data.sourceKey);return Response.json({message:'moved'});
  }
  throw new Error('Unexpected storage operation '+url.pathname);
 };
 t.after(()=>{globalThis.fetch=nativeFetch;});
 const app=express();app.use(express.json());app.use('/api/admin',(req:any,res,next)=>{if(req.get('x-admin')!=='owner')return res.status(403).json({success:false});req.userId='owner';next();},adminManagementRouter);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as any).port}/api/admin`;
 const request=(path:string,body?:any)=>nativeFetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-admin':'owner','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const input={fileName:'product.zip',size:22,reviewed:true,replaceExisting:false,reason:'Reviewed correct product file'};
 assert.equal((await nativeFetch(base+'/products/first/file')).status,403);
 assert.equal((await (await request('/products/first/file')).json()).file.exists,false);
 assert.equal((await request('/products/first/file-upload',{...input,size:MAX_PRIVATE_ZIP_BYTES+1})).status,400);
 assert.equal((await request('/products/missing/file-upload',input)).status,404);
 const prepare=await request('/products/first/file-upload',input);assert.equal(prepare.status,200);const upload=(await prepare.json()).upload;
 assert.equal(upload.method,'PUT');assert.match(upload.path,/^_staging\/first\//);assert.ok(upload.signedUrl.includes('synthetic-upload-token'));
 const valid=new Uint8Array(22);valid.set([0x50,0x4b,0x03,0x04]);files.set(upload.path,{bytes:valid,id:'first-upload'});
 const complete={uploadId:upload.uploadId,reviewed:true,reason:'Approved checked ZIP publication'};
 assert.equal((await request('/products/first/file-upload/complete',complete)).status,200);assert.ok(files.has('first.zip'));assert.ok(cancelled>0,'header check cancels remaining stream');
 assert.equal((await request('/products/first/file-upload/complete',complete)).status,200,'completion replay is idempotent');
 assert.equal((await request('/products/first/file-upload',input)).status,409,'replacement needs explicit approval');
 const bad=(await (await request('/products/first/file-upload',{...input,replaceExisting:true})).json()).upload;
 files.set(bad.path,{bytes:new TextEncoder().encode('<html>not a ZIP.......'),id:'bad-upload'});
 const badComplete=await request('/products/first/file-upload/complete',{...complete,uploadId:bad.uploadId});assert.equal(badComplete.status,400);assert.equal(files.get('first.zip')?.id,'first-upload','invalid replacement never touches live file');
 const replacement=(await (await request('/products/first/file-upload',{...input,replaceExisting:true})).json()).upload;
 files.set(replacement.path,{bytes:valid,id:'new-upload'});failPublish=true;
 assert.equal((await request('/products/first/file-upload/complete',{...complete,uploadId:replacement.uploadId})).status,503);assert.equal(files.get('first.zip')?.id,'first-upload','old file restored after publication failure');
 failPublish=false;
 const changed=(await (await request('/products/first/file-upload',{...input,replaceExisting:true})).json()).upload;
 files.set(changed.path,{bytes:valid,id:'staged-final'});files.set('first.zip',{bytes:valid,id:'someone-else-upload'});
 assert.equal((await request('/products/first/file-upload/complete',{...complete,uploadId:changed.uploadId})).status,409,'stale replacement cannot overwrite a newer product file');
 await assert.rejects(verifyStagedZipHeader('https://attacker.invalid/storage/v1/object/sign/products/a.zip'),/Unexpected private storage/);
});
