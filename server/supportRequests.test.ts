import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from './app';
import { Store } from './store';

test('support request returns only a copy of the validated, persisted submission; failed persistence never acknowledges receipt', async context => {
  context.mock.method(Store, 'rpc', async () => true);
  let saved: any, fail = false;
  context.mock.method(Store, 'set', async (key: string, value: any) => {
    if (fail) throw new Error('private storage error');
    assert.match(key, /^supportRequests\/BS-[a-f0-9]{16}$/);
    saved = value;
    return value;
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/contact`;
  const submit = (body: any) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { name: ' Buyer ', email: 'buyer@example.test', message: ' My order is missing. ', reference: 'another-customer-reference', role: 'admin' };
  const response = await submit(input);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.reference, saved.reference);
  assert.deepEqual(result.receipt, { name: 'Buyer', email: input.email, message: 'My order is missing.', reference: saved.reference, submittedAt: saved.createdAt });
  assert.equal(saved.status, 'open');
  assert.ok(!JSON.stringify(result).includes('another-customer-reference'));
  assert.equal(result.receipt.role, undefined);
  assert.equal((await submit({ ...input, message: 'tiny' })).status, 400);
  fail = true;
  const failed = await submit(input);
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.equal(body.receipt, undefined);
  assert.equal(body.reference, undefined);
  assert.ok(!JSON.stringify(body).includes('private storage error'));
});
