import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { appOrigin } from './config';
import { PROXIED_UPLOAD_LIMIT_BYTES } from '../src/config/uploadLimits';

const deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const envKeys = ['APP_URL','VERCEL','VERCEL_ENV','VERCEL_URL','VERCEL_PROJECT_PRODUCTION_URL','NODE_ENV'];
function scopedEnv(context: any) {
  const before = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  context.after(() => { for (const [key,value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

test('deployment links use explicit trusted origin or platform deployment values, never an HTTP request host', context => {
  scopedEnv(context);
  Object.assign(process.env, { NODE_ENV:'production', VERCEL:'1', VERCEL_ENV:'preview', VERCEL_URL:'project-feature-123.vercel.app', VERCEL_PROJECT_PRODUCTION_URL:'project.vercel.app' });
  assert.equal(appOrigin(),'https://project-feature-123.vercel.app');
  process.env.VERCEL_ENV='production'; assert.equal(appOrigin(),'https://project.vercel.app');
  process.env.APP_URL='https://www.booyahstudio.shop'; assert.equal(appOrigin(),'https://www.booyahstudio.shop');
  for (const value of ['https://trusted.example/path','https://user:password@trusted.example','https://trusted.example?next=evil','http://trusted.example']) { process.env.APP_URL=value; assert.throws(()=>appOrigin()); }
  delete process.env.APP_URL; process.env.VERCEL_URL='attacker.example/path'; delete process.env.VERCEL_PROJECT_PRODUCTION_URL; assert.throws(()=>appOrigin());
});

test('Vercel routing preserves API errors, dynamic categories, product shell tracing and safe deployment inputs', () => {
  assert.equal(deployment.framework,'vite'); assert.equal(deployment.installCommand,'pnpm install --frozen-lockfile');
  assert.deepEqual(deployment.rewrites[0],{source:'/api/:path*',destination:'/api'});
  assert.deepEqual(deployment.rewrites.find((rule:any)=>rule.source==='/sitemap.xml'),{source:'/sitemap.xml',destination:'/api/page?path=sitemap.xml'});
  assert.equal(deployment.functions['api/index.ts'].includeFiles,'{build/api-app.mjs,dist/index.html}');
  assert.equal(deployment.functions['api/page.ts'].includeFiles,'{build/api-app.mjs,dist/index.html}');
  assert.ok(deployment.functions['api/index.ts'].maxDuration>=60);
  assert.equal(deployment.rewrites.find((rule:any)=>rule.source==='/product/:slug')?.destination,'/api/page?slug=:slug');
  assert.equal(deployment.rewrites.find((rule:any)=>rule.source==='/category/:slug'),undefined,'new admin categories must not rewrite to absent prebuilt files');
  assert.deepEqual(deployment.rewrites.at(-1),{source:'/:path*',destination:'/api/page?path=:path*'}, 'unknown and policy-alias pages must reach status-aware HTML rendering');
  assert.deepEqual(deployment.crons, [{ path: '/api/jobs/reconcile', schedule: '0 0 * * *' }], 'daily fallback must remain deployable on all Vercel plans');
  for (const slug of ['terms','privacy','refund','disclaimer']) assert.equal(deployment.rewrites.find((rule:any)=>rule.source===`/policies/${slug}`)?.destination,`/policies/${slug}/index.html`);
  const ignore=readFileSync(new URL('../.vercelignore',import.meta.url),'utf8');
  for(const path of ['**/*.zip','owner-files/','private-product-uploads/','.env','node_modules/']) assert.ok(ignore.split('\n').includes(path));
  assert.ok(PROXIED_UPLOAD_LIMIT_BYTES<4.5*1024*1024,'multipart uploads leave room below platform cap');
});

test('Express API preserves raw-body verification and safe errors; deployment entry points at the native bundle', async context => {
  scopedEnv(context); const oldSecret=process.env.CASHFREE_SECRET_KEY, oldMode=process.env.CASHFREE_ENV;
  Object.assign(process.env,{ NODE_ENV:'production',APP_URL:'https://store.example.test',CASHFREE_ENV:'sandbox',CASHFREE_SECRET_KEY:'synthetic-deployment-secret' });
  context.after(()=>{ if(oldSecret===undefined)delete process.env.CASHFREE_SECRET_KEY;else process.env.CASHFREE_SECRET_KEY=oldSecret; if(oldMode===undefined)delete process.env.CASHFREE_ENV;else process.env.CASHFREE_ENV=oldMode; });
  const logs:string[]=[]; context.mock.method(console,'error',(value:any)=>logs.push(String(value)));
  // npm test also works before build. The build's native Node check exercises
  // both generated entrypoints; here verify their contract and request middleware.
  const entry=readFileSync(new URL('../api/index.ts',import.meta.url),'utf8');
  assert.match(entry,/export \{ default \} from ['\"]\.\.\/build\/api-app\.mjs['\"]/);
  const {app:api}=await import('./app');
  assert.equal(typeof api.listen,'function','Vercel must receive Express directly so it preserves raw webhook bytes');
  const server=createServer(api);server.listen(0,'127.0.0.1');await once(server,'listening');
  context.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const missing=await fetch(base+'/api/not-a-real-endpoint',{headers:{accept:'text/html'}});
  assert.equal(missing.status,404);assert.match(missing.headers.get('content-type')||'',/application\/json/);assert.equal((await missing.json()).success,false);
  const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{"secret":"do-not-log-this",'});
  assert.equal(malformed.status,400);const invalid=await malformed.json();assert.equal(invalid.success,false);assert.match(invalid.requestId,/^[a-f\d-]{36}$/);
  assert.equal(logs.some(line=>line.includes('do-not-log-this')),false);
  const timestamp=String(Date.now()), raw=' {\n  "type" : "UNHANDLED_DEPLOYMENT_TEST"\n } ';
  const signature=crypto.createHmac('sha256','synthetic-deployment-secret').update(timestamp).update(raw).digest('base64');
  const webhook=await fetch(base+'/api/payments/cashfree/webhook',{method:'POST',headers:{'content-type':'application/json','x-webhook-signature':signature,'x-webhook-timestamp':timestamp},body:raw});
  assert.equal(webhook.status,200,'original whitespace must survive API entry for valid raw HMAC');
  const crossSite=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://other.example','sec-fetch-site':'cross-site'},body:'{}'});
  assert.equal(crossSite.status,403);
});
