import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUSINESS } from '../src/config/business';
import { policyData, POLICY_REDIRECTS } from '../src/data/policyData';

const identity = [
  'MANISH KUMAR SONKAR',
  'S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR, Varanasi, Varanasi, Uttar Pradesh, 221003',
  'connectbooyahstudio@gmail.com',
  '+91 7393845435',
  'https://wa.me/917393845435',
];
const section = (slug: string, id: string) => policyData[slug].sections.find(item => item.id === id)!.content;

test('every public policy identifies the supplied sole merchant and grievance contact consistently', () => {
  assert.equal(BUSINESS.owner, identity[0]);
  assert.equal(BUSINESS.address, identity[1]);
  assert.equal(BUSINESS.email, identity[2]);
  assert.equal(BUSINESS.phone, identity[3]);
  assert.equal(BUSINESS.phoneHref, identity[4]);
  assert.equal(BUSINESS.gstin, '', 'do not invent a GST registration');
  for (const policy of Object.values(policyData)) {
    for (const required of identity) {
      assert.ok(policy.subtitle.includes(required), `${policy.slug}: identity missing from header`);
      assert.ok(section(policy.slug, 'business-identity').includes(required), `${policy.slug}: identity missing from body`);
    }
    const content = JSON.stringify(policy);
    assert.deepEqual([...new Set(content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))], [BUSINESS.email], `${policy.slug}: unexpected merchant email`);
    assert.match(content, /Grievance contact: MANISH KUMAR SONKAR/);
  }
});

test('digital delivery, remedies and ownership have explicit terms without waiving statutory or open-source rights', () => {
  assert.match(section('terms', 'delivery-records'), /24 hours/);
  assert.match(section('terms', 'delivery-records'), /No physical shipping/);
  assert.match(section('terms', 'delivery-records'), /does not prove/);
  assert.match(section('terms', 'support-grievances'), /48 hours/);
  assert.match(section('terms', 'support-grievances'), /one month/);
  assert.match(section('refund', 'eligible-scenarios'), /Wrong or missing files/);
  assert.match(section('refund', 'refund-procedure'), /2 business days/);
  assert.match(section('refund', 'refund-procedure'), /5 business days/);
  assert.match(section('refund', 'refund-procedure'), /5–7 business days/);
  assert.match(section('refund', 'refund-procedure'), /not a limit on a statutory claim/);
  assert.match(section('terms', 'copyright-ip'), /created by and owned by MANISH KUMAR SONKAR/);
  assert.match(section('terms', 'copyright-ip'), /does not claim ownership of third-party software/);
  for (const [oldSlug, target] of Object.entries(POLICY_REDIRECTS)) assert.ok(policyData[target], `${oldSlug}: redirect target missing`);
  for (const policy of Object.values(policyData)) {
    const copy = readFileSync(new URL(`../docs/policies/${policy.slug}.md`, import.meta.url), 'utf8');
    for (const item of policy.sections) assert.ok(copy.includes(item.content), `${policy.slug}: documentation is stale`);
  }
});
