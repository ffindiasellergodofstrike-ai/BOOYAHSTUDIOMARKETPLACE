import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { NEW_PRODUCTS } from '../src/data/newProducts';
import { PRODUCTS } from '../src/data/products';

const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('20 original listings have bounded INR prices, honest scope and protected delivery keys', () => {
  assert.equal(NEW_PRODUCTS.length, 20);
  assert.equal(new Set(PRODUCTS.map(p => p.id)).size, PRODUCTS.length);
  for (const required of [699,799,1499,250,1800,6300,4300,199,299,899,599]) {
    assert.ok(NEW_PRODUCTS.some(p => p.price === required));
  }
  for (const product of NEW_PRODUCTS) {
    assert.ok(product.price > 0 && product.price < 8000);
    assert.equal(product.downloadUrl, undefined, 'paid archives must not be public URLs');
    assert.equal(product.rating, undefined, 'no invented ratings');
    assert.equal(product.reviewCount, undefined, 'no invented reviews');
    assert.equal(product.originalPrice, undefined, 'no artificial crossed-out prices');
    assert.match(product.description, /not a hosted business or backend service/);
    assert.ok(existsSync(new URL(`../public${product.image}`, import.meta.url)), `${product.id} thumbnail missing`);
  }
});

test('all 80 original source pages and public demos have matching working local assets', () => {
  for (const product of NEW_PRODUCTS) {
    for (const page of ['index','work','about','contact']) {
      const source = text(`templates/${product.id}/${page}.html`);
      const demo = text(`public/demos/${product.id}/${page}.html`);
      assert.match(source, /<html lang="en">/);
      assert.match(source, /Content-Security-Policy/);
      assert.doesNotMatch(source, /ff-preview-watermark|preview-watermark.css/);
      assert.match(demo, /preview-watermark.css/);
      assert.match(demo, new RegExp(`<base href="/demos/${product.id}/">`));
      assert.doesNotMatch(source, /(?:src|href)="https?:\/\//, 'source requires no external assets');
      for (const [,url] of source.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        assert.ok(existsSync(new URL(`../templates/${product.id}/${url}`, import.meta.url)), `${product.id}/${page}: ${url} missing`);
      }
    }
    new Script(text(`templates/${product.id}/app.js`));
    assert.equal(text(`templates/${product.id}/app.js`), text(`public/demos/${product.id}/app.js`));
    assert.match(text(`templates/${product.id}/README.md`), /No packages, build tools/);
    assert.match(text(`templates/${product.id}/LICENSE.txt`), /Single Project Template License/);
    assert.doesNotThrow(() => JSON.parse(text(`templates/${product.id}/vercel.json`)));
  }
});

test('Vercel routes preserve API, demo directories and product share pages before the status-aware HTML fallback', () => {
  const config = JSON.parse(text('vercel.json'));
  assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(config.rewrites[0], { source:'/api/:path*', destination:'/api' });
  assert.ok(config.rewrites.some((r: any) => r.source === '/product/:slug' && r.destination === '/api/page?slug=:slug'));
  assert.ok(config.rewrites.some((r: any) => r.source === '/demos/:product/' && r.destination === '/demos/:product/index.html'));
  assert.deepEqual(config.rewrites.at(-1), { source:'/:path*', destination:'/api/page?path=:path*' });
  assert.match(text('api/index.ts'), /server\/app/);
  const scripts = JSON.parse(text('package.json')).scripts;
  assert.ok(scripts.build.includes('generate-product-pages.ts'));
  assert.ok(!scripts.build.includes('--outfile=dist/server'), 'server code must not be served as a static asset');
});
