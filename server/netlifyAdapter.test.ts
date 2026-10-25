import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createNetlifyHandler, runNetlifyReconciliation, type NetlifyEvent } from './netlifyAdapter';

const event = (path: string, options: Partial<NetlifyEvent> = {}): NetlifyEvent => ({
  path: `/.netlify/functions/api${path}`, httpMethod: 'GET', headers: { accept: 'text/html' }, body: null, isBase64Encoded: false,
  queryStringParameters: null, multiValueQueryStringParameters: null, ...options,
});
function scope(context: any, extra: Record<string, string> = {}) {
  const keys = ['NODE_ENV', 'APP_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV', 'CRON_SECRET'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'production', APP_URL: 'https://market.synthetic.netlify.app', ...extra });
  context.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

test('Netlify real Express adapter keeps API JSON status, private file boundaries and public SEO HTML', async context => {
  scope(context);
  const { app } = await import('./app'); const handle = createNetlifyHandler(app);
  let result = await handle(event('/api/health'));
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).status, 'ok');
  result = await handle(event('/api/not-a-route'));
  assert.equal(result.statusCode, 404); assert.equal(JSON.parse(result.body).success, false);
  assert.match(result.headers?.['content-type'] || '', /application\/json/);
  for (const path of ['/docs/marketplace/DEPLOYMENT.md', '/server/app.ts', '/private.zip', '/.env']) assert.equal((await handle(event(path))).statusCode, 404, path);
  result = await handle(event('/contact'));
  assert.equal(result.statusCode, 200); assert.match(result.body, /MANISH KUMAR SONKAR/); assert.match(result.body, /<main/);
  result = await handle(event('/this-does-not-exist'));
  assert.equal(result.statusCode, 404); assert.match(result.headers?.['x-robots-tag'] || '', /noindex/);
  result = await handle(event('/account/downloads'));
  assert.equal(result.statusCode, 200); assert.match(result.headers?.['x-robots-tag'] || '', /noindex/); assert.doesNotMatch(result.body, /<main/);
  assert.equal(result.headers?.['cache-control'], 'private, no-store');
  assert.equal((await handle(event('/terms'))).statusCode, 301);
});

test('Netlify preserves exact UTF-8 and base64 webhook bytes; malformed or invalid signatures never become successful', async context => {
  scope(context, { CASHFREE_ENV: 'sandbox', CASHFREE_SECRET_KEY: 'synthetic-netlify-webhook' });
  context.mock.method(console, 'error', () => {});
  const { app } = await import('./app'); const handle = createNetlifyHandler(app);
  const raw = ' {\n "type": "UNHANDLED_NETLIFY_EVENT", "data": {"note":"café"} }\n';
  const timestamp = String(Date.now()), signature = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY!).update(timestamp).update(raw).digest('base64');
  const headers = { 'content-type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature };
  for (const base64 of [false, true]) {
    const request = event('/api/payments/cashfree/webhook', { httpMethod: 'POST', headers, isBase64Encoded: base64, body: base64 ? Buffer.from(raw).toString('base64') : raw });
    assert.equal((await handle(request)).statusCode, 200);
    assert.equal(request.body, base64 ? Buffer.from(raw).toString('base64') : raw, 'adapter must not mutate the original event');
  }
  const bad = await handle(event('/api/payments/cashfree/webhook', { httpMethod: 'POST', headers: { ...headers, 'x-webhook-signature': 'a'.repeat(44) }, body: raw }));
  assert.equal(bad.statusCode, 400);
  const malformed = await handle(event('/api/auth/login', { httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }));
  assert.equal(malformed.statusCode, 400); assert.equal(JSON.parse(malformed.body).success, false);
});

test('Netlify cookie arrays, binary receipts and edge client IP survive the Lambda boundary', async () => {
  const fixture = express();
  fixture.get('/cookies', (_req, res) => { res.cookie('sid', 'opaque-session', { httpOnly: true, secure: true, sameSite: 'lax' }); res.cookie('preference', 'one'); res.json({ success: true }); });
  fixture.get('/receipt', (_req, res) => res.type('application/pdf').send(Buffer.from('%PDF-1.7\nsynthetic')));
  fixture.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const handle = createNetlifyHandler(fixture);
  const cookies = await handle(event('/cookies'));
  assert.equal(cookies.multiValueHeaders?.['set-cookie']?.length, 2);
  assert.match(cookies.multiValueHeaders?.['set-cookie']?.[0] || '', /HttpOnly/); assert.match(cookies.multiValueHeaders?.['set-cookie']?.[0] || '', /Secure/);
  const pdf = await handle(event('/receipt')); assert.equal(pdf.isBase64Encoded, true); assert.equal(Buffer.from(pdf.body, 'base64').toString(), '%PDF-1.7\nsynthetic');
  const ip = await handle(event('/ip', { headers: { 'x-nf-client-connection-ip': '203.0.113.8', 'x-forwarded-for': '127.0.0.1' } }));
  assert.equal(JSON.parse(ip.body).ip, '203.0.113.8');
  const invalid = await handle(event('/ip', { headers: { 'x-nf-client-connection-ip': '203.0.113.8,127.0.0.1', 'x-forwarded-for': '127.0.0.1' } }));
  assert.equal(JSON.parse(invalid.body).ip, '0.0.0.0');
});

test('background reconciliation authenticates before invoking any work and does not mistake acceptance for completion', async context => {
  scope(context, { CRON_SECRET: 'synthetic-background-secret' }); let calls = 0;
  const fixture = express(); fixture.post('/api/jobs/reconcile', (req, res) => { calls++; assert.equal(req.get('authorization'), 'Bearer synthetic-background-secret'); res.json({ success: true, status: 'completed' }); });
  const handle = createNetlifyHandler(fixture);
  assert.deepEqual(await runNetlifyReconciliation(handle, event('/irrelevant')), { authorized: false, completed: false });
  assert.equal(calls, 0);
  assert.deepEqual(await runNetlifyReconciliation(handle, event('/irrelevant', { headers: { authorization: 'Bearer synthetic-background-secret' } })), { authorized: true, completed: true, status: 'completed' });
  assert.equal(calls, 1);
  const unavailable = express(); unavailable.post('/api/jobs/reconcile', (_req, res) => res.status(503).json({ success: false }));
  await assert.rejects(runNetlifyReconciliation(createNetlifyHandler(unavailable), { headers: { authorization: 'Bearer synthetic-background-secret' } }), /did not complete/);
});

test('Netlify configuration preserves API precedence and uses a short schedule only to queue a background worker', () => {
  const config = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(config, /publish = "dist"/); assert.match(config, /from = "\/api\/\*"[\s\S]*?force = true/);
  assert.match(config, /included_files = \["build\/api-app.mjs", "dist\/index.html"\]/);
  assert.match(config, /schedule = "15 \* \* \* \*"/);
  const schedule = readFileSync(new URL('../netlify/functions/reconcile-schedule.ts', import.meta.url), 'utf8');
  assert.match(schedule, /reconcile-background/); assert.match(schedule, /appOrigin\(\)/); assert.doesNotMatch(schedule, /request\.headers|event\.rawUrl/);
});

test('the scheduled trigger uses only the trusted origin and checks actual 202 background acceptance', async context => {
  scope(context, { CRON_SECRET: 'synthetic-schedule-secret' });
  let status = 202;
  const requests: { url: string; init?: RequestInit }[] = [];
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => { requests.push({ url: String(input), init }); return new Response(null, { status }); });
  const { handler } = await import('../netlify/functions/reconcile-schedule');
  assert.equal((await handler()).statusCode, 202);
  assert.equal(requests[0].url, 'https://market.synthetic.netlify.app/.netlify/functions/reconcile-background');
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-schedule-secret');
  status = 200; await assert.rejects(handler(), /not accepted/);
  delete process.env.CRON_SECRET; await assert.rejects(handler(), /Configure CRON_SECRET/);
  assert.equal(requests.length, 2);
});
