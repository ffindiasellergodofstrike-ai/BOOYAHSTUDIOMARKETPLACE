import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseFetch, SUPABASE_REQUEST_TIMEOUT_MS } from './supabase';

test('Supabase SDK transport bounds requests while retaining method, headers, body and caller cancellation', async context => {
  const controller = new AbortController();
  const body = JSON.stringify({ example: 'synthetic' }), headers = new Headers({ authorization: 'Bearer synthetic-test-only', 'content-type': 'application/json' });
  let observed: RequestInit | undefined;
  context.mock.method(globalThis, 'fetch', async (_input: any, init: RequestInit) => { observed = init; return Response.json({ ok: true }); });
  const response = await supabaseFetch('https://project.example.test/rest/v1/rpc/example', { method: 'POST', headers, body, signal: controller.signal });
  assert.equal(response.status, 200); assert.equal(SUPABASE_REQUEST_TIMEOUT_MS, 10000);
  assert.equal(observed?.method, 'POST'); assert.equal(observed?.body, body); assert.equal(observed?.headers, headers);
  assert.ok(observed?.signal instanceof AbortSignal); assert.notEqual(observed?.signal, controller.signal);
  controller.abort(); assert.equal(observed?.signal?.aborted, true);
});
test('Supabase transport retains cancellation carried by a Request input', async context => {
  const controller = new AbortController(), request = new Request('https://project.example.test/auth/v1/user', { signal: controller.signal });
  controller.abort(); let checked = false;
  context.mock.method(globalThis, 'fetch', async (input: any, init: RequestInit) => {
    assert.equal(input, request); assert.equal(init.signal?.aborted, true); checked = true;
    throw new DOMException('Synthetic cancellation', 'AbortError');
  });
  await assert.rejects(supabaseFetch(request), { name: 'AbortError' }); assert.equal(checked, true);
});
