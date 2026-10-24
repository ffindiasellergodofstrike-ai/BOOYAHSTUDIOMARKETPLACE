import test from 'node:test';
import assert from 'node:assert/strict';
import { authDestination, authReturnSearch, safePreviousUrl } from './AuthNavigation';
test('authentication return navigation accepts only supported symbolic destinations',()=>{
 for (const [hint, destination] of [['checkout', '/checkout'], ['downloads', '/account/downloads'], ['orders', '/account/orders'], ['creator', '/creator'], ['pricing', '/pricing'], ['memberships', '/memberships']]) {
  assert.equal(authDestination(hint), destination);
  assert.deepEqual(authReturnSearch(hint), { redirect: hint });
 }
 for(const unsafe of ['https://attacker.test','//attacker.test','/admin','/account/downloads','__proto__','constructor','toString',undefined])assert.equal(authDestination(unsafe),'/account');
 assert.deepEqual(authReturnSearch('checkout'),{redirect:'checkout'});assert.deepEqual(authReturnSearch('/admin'),{});
});
test('local navigation history strips recovery/session material and external destinations',()=>{
 assert.equal(safePreviousUrl('/forgot-password','?token_hash=secret&redirect=checkout'),'/forgot-password?redirect=checkout');
 assert.equal(safePreviousUrl('/login','?code=secret&access_token=abc&refresh_token=def&confirmation_url=private&reset=success'),'/login?reset=success');
 assert.equal(safePreviousUrl('//attacker.test','?token_hash=secret'),'/');
 assert.equal(safePreviousUrl('/\\attacker.test'),'/');
 assert.equal(safePreviousUrl('/products','?category=templates'),'/products?category=templates');
});
