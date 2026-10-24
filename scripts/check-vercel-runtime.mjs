// Run after pnpm build. Deliberately uses native Node, not tsx/Vite's module loader.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_WEBHOOK_SECRET', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_API_VERSION', 'CASHFREE_ENV', 'CRON_SECRET']) delete process.env[key];
process.env.NODE_ENV = 'production';
process.env.APP_URL = 'https://shop.example.com';
const { default: app } = await import('../api/index.ts');
const { default: page } = await import('../api/page.ts');
const server = createServer((req, res) => {
  if (req.url.startsWith('/page-check')) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    if (!query.has('native')) req.query = { slug: query.get('slug') };
    return page(req, res);
  }
  app(req, res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const originalFetch = globalThis.fetch;
try {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const registration = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.com' }, body: '{}',
  });
  assert.equal(registration.status, 503, 'Unconfigured database must return a handled JSON error, not a function crash');
  assert.equal((await registration.json()).success, false);
  assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
  const malformed = await fetch(`${base}/page-check?slug=..`);
  assert.equal(malformed.status, 404);
  assert.equal(malformed.headers.get('x-robots-tag'), 'noindex');
  const product = await fetch(`${base}/page-check?slug=margin-portfolio`, { headers: { Accept: 'text/html' } });
  assert.equal(product.status, 200);
  assert.match(await product.text(), /Margin/i);
  assert.equal(product.headers.get('cache-control'), 'private, no-store');
  const head = await fetch(`${base}/page-check?slug=margin-portfolio`, { method: 'HEAD', headers: { Accept: 'text/html' } });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const nativeQuery = await fetch(`${base}/page-check?slug=margin-portfolio&native=1`, { headers: { Accept:'text/html' } });
  assert.equal(nativeQuery.status, 200, 'Native URL fallback does not require a framework query object');
  const repeatedSlug = await fetch(`${base}/page-check?slug=margin-portfolio&slug=other&native=1`);
  assert.equal(repeatedSlug.status, 404);
  const deniedMethod = await fetch(`${base}/page-check?slug=margin-portfolio`, { method: 'POST' });
  assert.equal(deniedMethod.status, 405); assert.equal(deniedMethod.headers.get('allow'), 'GET, HEAD');
  assert.equal((await deniedMethod.json()).success, false);
  const contactPage = await fetch(`${base}/page-check?path=contact&native=1`, { headers: { Accept: 'text/html' } });
  assert.equal(contactPage.status, 200);
  const contactHtml = await contactPage.text();
  assert.match(contactHtml, /MANISH KUMAR SONKAR/);
  assert.match(contactHtml, /Customer support and grievances/);
  assert.match(contactHtml, /connectbooyahstudio@gmail\.com/);
  const missingPage = await fetch(`${base}/page-check?path=not-a-page&native=1`, { headers: { Accept: 'text/html' } });
  assert.equal(missingPage.status, 404);
  assert.equal(missingPage.headers.get('x-robots-tag'), 'noindex, nofollow');
  const policyAlias = await fetch(`${base}/page-check?path=policies/delivery&native=1`, { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(policyAlias.status, 301);
  assert.equal(policyAlias.headers.get('location'), '/policies/terms');
  for (const blockedPath of ['api/auth/me', 'API/auth/me', 'demos/linknest-pro', 'assets/private']) {
    assert.equal((await fetch(`${base}/page-check?path=${blockedPath}&native=1`)).status, 404, blockedPath);
  }
  assert.equal((await fetch(`${base}/page-check?path=contact&path=about&native=1`)).status, 404);
  assert.equal((await fetch(`${base}/page-check?path=contact&slug=margin-portfolio&native=1`)).status, 404);
  const sitemapPage = await fetch(`${base}/page-check?path=sitemap.xml&native=1`);
  assert.equal(sitemapPage.status, 200);
  assert.match(sitemapPage.headers.get('content-type'), /application\/xml/);
  assert.match(await sitemapPage.text(), /<urlset/);
  assert.equal(existsSync(new URL('../dist/sitemap.xml', import.meta.url)), false, 'static output must not shadow the live sitemap rewrite');
  process.env.CASHFREE_ENV = 'sandbox'; process.env.CASHFREE_SECRET_KEY = 'synthetic-runtime-secret';
  const raw = ' {\n  "type" : "UNHANDLED_NATIVE_RUNTIME_TEST"\n } ', timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY).update(timestamp).update(raw).digest('base64');
  const webhook = await fetch(`${base}/api/payments/cashfree/webhook`, { method: 'POST', headers: { 'content-type':'application/json', 'x-webhook-signature':signature, 'x-webhook-timestamp':timestamp }, body:raw });
  assert.equal(webhook.status, 200, 'Native entrypoint must preserve the original signed body bytes');

  const malformedJson = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:'{bad-json' });
  assert.equal(malformedJson.status,400); assert.equal((await malformedJson.json()).success,false);
  const crossSite = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json',Origin:'https://other.example','Sec-Fetch-Site':'cross-site'},body:'{}' });
  assert.equal(crossSite.status,403);

  // Exercise registration through the bundled API with synthetic Supabase responses.
  // The real Supabase SDK serializes these requests; no hosted account is created.
  process.env.SUPABASE_URL = 'https://synthetic.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'synthetic-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
  let signupCalls = 0;
  let rateAllowed = true;
  let rejectSignup = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://synthetic.supabase.co/rest/v1/rpc/store_operation') return Response.json(rateAllowed);
    if (url === 'https://synthetic.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fshop.example.com%2Flogin') {
      signupCalls++;
      const payload = JSON.parse(init.body);
      assert.equal(payload.email, 'customer@example.com');
      assert.equal(payload.data.name, 'Test Customer');
      if (rejectSignup) return Response.json({ msg: 'Signup rejected', code: 'validation_failed' }, { status: 422 });
      return Response.json({ id: 'synthetic-user', email: payload.email });
    }
    if (url.startsWith(`${base}/`)) return originalFetch(input, init);
    throw new Error('Unexpected external request in runtime check');
  };
  const register = body => fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.com' }, body: JSON.stringify(body),
  });
  const details = { name: 'Test Customer', email: 'customer@example.com', mobile: '9876543210', password: 'synthetic-password', confirmPassword: 'synthetic-password' };
  assert.equal((await register({})).status, 400);
  assert.equal(signupCalls, 0);
  const signup = await register(details);
  assert.equal(signup.status, 201);
  assert.equal((await signup.json()).success, true);
  assert.equal(signup.headers.get('set-cookie'), null, 'Signup must wait for email confirmation');
  assert.equal(signupCalls, 1);
  rejectSignup = true;
  const rejected = await register(details);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).success, false);
  rateAllowed = false;
  assert.equal((await register(details)).status, 429);
  assert.equal(signupCalls, 2, 'Rate limited requests must not reach Supabase Auth');
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.functions['api/index.ts'].includeFiles, '{build/api-app.mjs,dist/index.html}');
  assert.equal(config.functions['api/page.ts'].includeFiles, '{build/api-app.mjs,dist/index.html}');
  assert.equal(config.functions['api/index.ts'].maxDuration, 300);
  assert.equal(config.functions['api/page.ts'].maxDuration, 60);
  console.log('PASS: native Node API startup; health200; unconfigured503; API404; product404/200/HEAD/405; readable contact, HTML404, policy301, blocked fallback paths; raw signed webhook200; simulated Supabase signup201, invalid400, provider rejection400, rate limit429. No hosted accounts or provider calls.');
} finally {
  globalThis.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
}
