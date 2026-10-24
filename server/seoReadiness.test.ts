import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { seoMiddleware } from './seoMiddleware';
import { Store } from './store';
import { PRODUCTS } from '../src/data/products';
import { BUSINESS } from '../src/config/business';
import { getSEOPageData, injectSEOMetadata } from '../src/seo/seoMetadata';
import { injectPublicPageContent, publicCanonicalPaths, renderPublicPageContent, renderRobots, renderSitemap } from '../src/seo/publicPages';

test('SEO public HTML escapes catalog content, excludes hidden products and never serializes private asset fields', () => {
  const product = { ...PRODUCTS[0], id: 'seo-test', slug: 'seo-test', title: '<script>bad()</script>', shortDescription: 'A "safe" preview', description: '<img src=x onerror=bad()>', downloadUrl: 'https://private.invalid/paid.zip' };
  const hidden = { ...product, id: 'retired-item', slug: 'retired-item', status: 'archived' as const };
  const shell = '<html><head><title>Old</title><script id="json-ld-data" type="application/ld+json">{"old":true}</script></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';
  const page = getSEOPageData('/product/seo-test', {}, [product, hidden]);
  const html = injectPublicPageContent(injectSEOMetadata(shell, page), '/product/seo-test', [product, hidden]);
  assert.match(html, /<main/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad\(\)/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /private\.invalid|paid\.zip|"old":true|aggregateRating|ratingValue/);
  assert.ok(html.includes(BUSINESS.owner));
  const sitemap = renderSitemap([product, hidden]);
  assert.match(sitemap, /\/product\/seo-test/);
  assert.doesNotMatch(sitemap, /retired-item|\/account|\/checkout|\/demos/);
  assert.equal(getSEOPageData('/product/retired-item', {}, [hidden]).statusCode, 404);
  assert.ok(publicCanonicalPaths([product, hidden]).every(path => !getSEOPageData(path, {}, [product, hidden]).noindex));
  for (const path of ['/account/downloads', '/login', '/forgot-password', '/admin', '/checkout']) assert.equal(renderPublicPageContent(path), '');
  assert.match(renderRobots(), /Disallow: \/demos\//);
});

test('production HTTP pages return crawlable merchant details, genuine404, canonical policy redirects and private noindex without account data', async context => {
  const keys = ['NODE_ENV', 'SUPABASE_URL'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.NODE_ENV = 'production';
  delete process.env.SUPABASE_URL;
  context.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const app = express();
  app.use(seoMiddleware);
  app.use((_req, res) => res.status(404).end());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string) => fetch(base + path, { redirect: 'manual', headers: { Accept: 'text/html' } });
  for (const path of ['/', '/products', '/about', '/contact', '/faq', '/policies/terms', '/policies/refund', '/policies/privacy', '/policies/disclaimer']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    const body = await response.text();
    assert.match(body, /<main/);
    assert.ok(body.includes(BUSINESS.owner), path);
    assert.ok(body.includes(BUSINESS.email), path);
    assert.ok(body.includes(BUSINESS.address), path);
    assert.match(body, new RegExp(`rel="canonical" href="${BUSINESS.url.replaceAll('.', '\\.')}${path === '/' ? '/' : path}"`));
  }
  for (const path of ['/missing', '/category/missing', '/product/missing', '/constructor', '/toString', '/policies/__proto__']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  for (const [path, target] of [['/policies', 'terms'], ['/terms', 'terms'], ['/policies/delivery', 'terms'], ['/copyright', 'terms'], ['/policies/cancellation', 'refund']]) {
    const response = await request(path);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('location'), `/policies/${target}`);
  }
  const privateResponse = await request('/account/downloads?email=private-customer@example.test');
  assert.equal(privateResponse.status, 200);
  assert.equal(privateResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.doesNotMatch(await privateResponse.text(), /private-customer|<main|account\/downloads\?email/);
  const dynamic = { ...PRODUCTS[0], id: 'admin-item', slug: 'admin-item', category: 'new-category', categoryLabel: 'New collection', price: 925 };
  process.env.SUPABASE_URL = 'https://synthetic.supabase.test';
  context.mock.method(Store, 'getAllProducts', async () => [dynamic]);
  const category = await request('/category/new-category');
  assert.equal(category.status, 200);
  assert.match(await category.text(), /New collection/);
  const product = await request('/product/admin-item');
  assert.equal(product.status, 200);
  assert.match(await product.text(), /925/);
});


test('live sitemap reflects active admin catalog entries and excludes archived products and private metadata', async context => {
  const oldUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://synthetic.supabase.test';
  context.after(() => { if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; });
  const added = { ...PRODUCTS[0], id: 'sitemap-added', slug: 'sitemap-added', category: 'sitemap-collection', categoryLabel: 'Sitemap collection', downloadUrl: 'https://private.invalid/source.zip' };
  context.mock.method(Store, 'getAllProducts', async () => [{ ...PRODUCTS[0], status: 'archived' }, added]);
  const { app } = await import('./app');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/sitemap.xml?email=private@example.test`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/xml/);
  const xml = await response.text();
  assert.match(xml, /\/product\/sitemap-added/);
  assert.match(xml, /\/category\/sitemap-collection/);
  assert.ok(!xml.includes(`/product/${PRODUCTS[0].slug}</loc>`));
  assert.doesNotMatch(xml, /source\.zip|private\.invalid|private@example|\/account|\/checkout/);
});
