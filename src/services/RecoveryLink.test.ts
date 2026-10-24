import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecoveryLink } from './RecoveryLink';

const accessToken = 'syntheticHeader.syntheticPayload.syntheticSignature';
const refreshToken = 'synthetic-refresh-token';
const session = `#access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery&expires_in=3600`;

test('default Supabase recovery fragments open the new-password flow without retaining credentials in the URL', () => {
 const result = readRecoveryLink('?redirect=checkout&email=private@example.test', session);
 assert.deepEqual(result.credentials, { accessToken });
 assert.ok(!JSON.stringify(result).includes(refreshToken));
 assert.equal(result.message, '');
 assert.equal(result.cleanUrl, '/forgot-password?redirect=checkout');
 assert.ok(!result.cleanUrl.includes(accessToken));
 assert.ok(!result.cleanUrl.includes(refreshToken));
});

test('custom token-hash links remain supported and use only the allowed return hint', () => {
 const result = readRecoveryLink('?token_hash=synthetic-recovery-hash&redirect=https://attacker.example', '');
 assert.deepEqual(result.credentials, { tokenHash: 'synthetic-recovery-hash' });
 assert.equal(result.cleanUrl, '/forgot-password');
 assert.deepEqual(readRecoveryLink('?token_hash=synthetic-recovery-hash', session).credentials, { tokenHash: 'synthetic-recovery-hash' });
});

test('malformed or non-recovery sessions and expired provider links display an explicit recovery error', () => {
 for (const [search, fragment] of [
  ['', session.replace('type=recovery', 'type=signup')],
  ['', session.replace('type=recovery', 'type=magiclink')],
  ['', session.replace('&type=recovery', '')],
  ['', '#type=recovery&access_token=invalid&refresh_token=synthetic-refresh-token'],
  ['', `${session}&access_token=duplicate`],
  ['', `${session}&type=recovery`],
  [`?access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery`, ''],
  ['?token_hash=short', ''],
  ['?token_hash=synthetic-recovery-hash&token_hash=another-recovery-hash', ''],
  ['?token_hash=synthetic-recovery-hash&type=signup', ''],
  ['', '#error=access_denied&error_code=otp_expired&error_description=private-provider-detail'],
  ['?error_code=otp_expired', session],
 ]) {
  const result = readRecoveryLink(search, fragment);
  assert.equal(result.credentials, null, search || fragment);
  assert.match(result.message, /invalid, expired or incomplete/);
  assert.equal(result.cleanUrl, '/forgot-password');
  assert.ok(!result.message.includes('private-provider-detail'));
 }
});

test('a valid recovery access fragment needs no refresh token and never retains supplied refresh tokens', () => {
 assert.deepEqual(readRecoveryLink('', `#type=recovery&access_token=${accessToken}`).credentials, { accessToken });
 assert.deepEqual(readRecoveryLink('', session).credentials, { accessToken });
 assert.ok(!JSON.stringify(readRecoveryLink('', session)).includes(refreshToken));
});

test('ordinary requests remain the email form and unsupported PKCE links do not silently loop', () => {
 assert.deepEqual(readRecoveryLink(), { credentials: null, message: '', cleanUrl: '/forgot-password' });
 const unsupported = readRecoveryLink('?code=synthetic-private-code&redirect=/admin');
 assert.equal(unsupported.credentials, null);
 assert.match(unsupported.message, /unsupported format/);
 assert.equal(unsupported.cleanUrl, '/forgot-password');
});


test('recovery navigation preserves only safe download and order hints without credentials', () => {
 for (const hint of ['downloads', 'orders']) {
  const link = readRecoveryLink(`?redirect=${hint}&token_hash=synthetic-recovery-hash&email=private@example.test`, '');
  assert.equal(link.cleanUrl, `/forgot-password?redirect=${hint}`);
  assert.deepEqual(link.credentials, { tokenHash: 'synthetic-recovery-hash' });
 }
 for (const hint of ['/account/downloads', '//attacker.test', '__proto__']) {
  assert.equal(readRecoveryLink(`?redirect=${encodeURIComponent(hint)}`, session).cleanUrl, '/forgot-password');
 }
});
