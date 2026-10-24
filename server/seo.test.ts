import test from 'node:test';
import assert from 'node:assert/strict';
import { getSEOPageData, injectSEOMetadata } from '../src/seo/seoMetadata';
import { PRODUCTS } from '../src/data/products';
test('private and missing routes are not indexed; current catalog drives product metadata', () => {
 for (const route of ['/account','/wishlist','/search','/admin','/checkout','/forgot-password','/product/missing','/missing']) assert.equal(getSEOPageData(route).noindex,true);
 const product={...PRODUCTS[0],id:'new-template',slug:'new-template',title:'New template',price:725};
 const page=getSEOPageData('/product/new-template',{},[product]);
 assert.equal(page.statusCode,200);assert.match(page.title,/New template/);
 assert.match(JSON.stringify(page.jsonLd),/"price":725/);
 const hostile=injectSEOMetadata('<html><head><title>Old</title></head></html>',{...page,jsonLd:[{name:'</script><script>bad()</script>'}]});
 assert.doesNotMatch(hostile,/<script>bad/);
});
