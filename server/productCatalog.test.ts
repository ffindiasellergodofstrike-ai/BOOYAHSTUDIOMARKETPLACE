import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PRODUCTS } from '../src/data/products';
import { ProductService } from '../src/services/ProductService';
import { isBrowserSafeAssetUrl, mergeProductCatalog } from './productCatalog';
import { isAllowedProductPreviewUrl, normalizeProductPreviewUrl } from './productPreview';

test('recognizes only browser-loadable product asset URLs', () => {
  assert.equal(isBrowserSafeAssetUrl('/product-images/example.png'), true);
  assert.equal(isBrowserSafeAssetUrl('https://cdn.example/product.png'), true);
  assert.equal(isBrowserSafeAssetUrl('//untrusted.example/product.png'), false);
  assert.equal(isBrowserSafeAssetUrl('file:///var/task/product.png'), false);
  assert.equal(isBrowserSafeAssetUrl('javascript:alert(1)'), false);
});

test('accepts bundled product previews and custom HTTPS preview domains', () => {
  assert.equal(isAllowedProductPreviewUrl('/demos/linknest-pro/'), true);
  assert.equal(normalizeProductPreviewUrl('/demos/neura-ai/', 'neura-ai'), '/demos/neura-ai/');
  assert.equal(normalizeProductPreviewUrl('/demos/neura-ai/', 'finora'), undefined);
  assert.equal(isAllowedProductPreviewUrl('//untrusted.example/demo'), false);
  assert.equal(isAllowedProductPreviewUrl('/demos/../api/'), false);
  assert.equal(isAllowedProductPreviewUrl('/demos/linknest-pro/?redirect=1'), false);
  assert.equal(isAllowedProductPreviewUrl('https://linknest-demo.example.com/app'), true);
  assert.equal(isAllowedProductPreviewUrl('https://project.vercel.app'), false);
  assert.equal(isAllowedProductPreviewUrl('https://vercel.app'), false);
  assert.equal(isAllowedProductPreviewUrl('http://linknest-demo.example.com'), false);
  assert.equal(isAllowedProductPreviewUrl('javascript:alert(1)'), false);
  assert.equal(normalizeProductPreviewUrl(' https://linknest-demo.example.com/app#pricing '), 'https://linknest-demo.example.com/app');
});

test('removes unsafe preview URLs from the public catalog', () => {
  const catalog = mergeProductCatalog([], [
    { id: 'safe', status: 'published', previewUrl: 'https://demo.example.com' },
    { id: 'hidden-provider', status: 'published', previewUrl: 'https://secret-project.vercel.app' },
  ]);

  assert.equal(catalog[0].previewUrl, 'https://demo.example.com/');
  assert.equal(catalog[1].previewUrl, undefined);
});

test('keeps bundled previews tied to the matching product ID', () => {
  const catalog = mergeProductCatalog(
    [{ id: 'finora', status: 'active', previewUrl: '/demos/finora/' }],
    [{ id: 'finora', status: 'published', previewUrl: '/demos/workhub/' }]
  );

  assert.equal(catalog[0].previewUrl, '/demos/finora/');
});

test('ships every built-in product with its own watermarked preview', () => {
  for (const product of PRODUCTS) {
    const expectedPreview = `/demos/${product.id}/`;
    const brandName = product.title.split(' — ')[0];
    const previewHtml = readFileSync(
      new URL(`../public${expectedPreview}index.html`, import.meta.url),
      'utf8'
    );

    assert.equal(product.previewUrl, expectedPreview);
    assert.match(previewHtml, new RegExp(`${brandName} • Preview`));
    assert.match(previewHtml, /preview-watermark\.css/);
    assert.match(previewHtml, /Content-Security-Policy/);
  }
});

test('merges static and Supabase products without dropping either catalog', () => {
  const staticProducts = [
    { id: 'static-one', slug: 'static-one', title: 'Static One', price: 100, status: 'active', image: '/product-images/static.png', gallery: ['/product-images/static.png'] },
    { id: 'static-two', slug: 'static-two', title: 'Static Two', price: 200, status: 'active', image: '/product-images/two.png' },
  ];
  const databaseProducts = [
    {
      id: 'static-one',
      slug: 'static-one',
      title: 'Edited in Admin',
      price: 125,
      status: 'published',
      image: 'file:///var/task/broken.png',
      licenseTypes: [{ id: 'standard', name: 'Standard License' }],
      licenseTerms: 'Legacy terms',
      extendedPrice: 300,
    },
    { id: 'admin-only', slug: 'admin-only', title: 'Admin Product', price: 300, status: 'published', image: 'https://cdn.example/admin.png' },
  ];

  const catalog = mergeProductCatalog(staticProducts, databaseProducts);

  assert.deepEqual(catalog.map((product) => product.id), ['static-one', 'static-two', 'admin-only']);
  assert.equal(catalog[0].title, 'Edited in Admin');
  assert.equal(catalog[0].price, 125);
  assert.equal(catalog[0].image, '/product-images/static.png');
  assert.equal('licenseTypes' in catalog[0], false);
  assert.equal(typeof catalog[0].licenseTerms, 'string');
  assert.equal('extendedPrice' in catalog[0], false);
  assert.equal(catalog[2].image, 'https://cdn.example/admin.png');
});

test('excludes draft, archived, and inactive products from the public catalog', () => {
  const catalog = mergeProductCatalog(
    [{ id: 'active', status: 'active' }, { id: 'archived', status: 'active' }],
    [
      { id: 'archived', status: 'archived' },
      { id: 'draft', status: 'draft' },
      { id: 'inactive', status: 'inactive' },
    ]
  );

  assert.deepEqual(catalog.map((product) => product.id), ['active']);
});

test('keeps all built-in products when Supabase contains only LinkNest', () => {
  const firebaseProducts = [
    {
      ...PRODUCTS.find((product) => product.id === 'linknest-pro'),
      status: 'published',
      image: 'file:///var/task/assets/linknest.jpg',
      gallery: ['file:///var/task/assets/linknest.jpg'],
    },
  ];

  const catalog = mergeProductCatalog(PRODUCTS, firebaseProducts);

  assert.deepEqual(
    catalog.map((product) => product.id),
    PRODUCTS.map(product => product.id)
  );
  assert.equal(catalog.every((product) => isBrowserSafeAssetUrl(product.image)), true);
});

test('refreshes the browser catalog from the public product API', async () => {
  const originalFetch = globalThis.fetch;
  const remoteProduct = { ...PRODUCTS[0], id: 'admin-product', slug: 'admin-product', title: 'Admin Product' };
  let notifications = 0;
  const unsubscribe = ProductService.subscribe(() => notifications += 1);

  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: true,
      products: [remoteProduct],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    await ProductService.refreshProducts(true);

    assert.equal(ProductService.getAllProducts().length, 1);
    assert.equal(ProductService.getProductById('admin-product')?.title, 'Admin Product');
    assert.equal(notifications, 1);
  } finally {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: true,
      products: PRODUCTS,
    }), { status: 200 })) as typeof fetch;
    await ProductService.refreshProducts(true);
    globalThis.fetch = originalFetch;
    unsubscribe();
  }
});
