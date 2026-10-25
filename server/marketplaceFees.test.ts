import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedCommissionForItems, membershipCommissionPaise } from './marketplaceFees';

test('marketplace fee is INR20 for each sold item, independent of price and quantity manipulation', () => {
  assert.deepEqual(fixedCommissionForItems([{ productId: 'first' }], 49900), { commissionModel: 'fixed_per_item', unitCommissionPaise: 2000, commissionItemCount: 1, commissionBps: 0, grossPaise: 49900, commissionPaise: 2000, sellerPaise: 47900 });
  const two = fixedCommissionForItems([{ productId: 'first', quantity: 1 }, { productId: 'second', quantity: 1 }], 15000);
  assert.equal(two.commissionPaise, 4000); assert.equal(two.sellerPaise, 11000);
  for (const items of [[], [{ productId: 'same' }, { productId: 'same' }], [{ productId: 'first', quantity: 2 }], [{ productId: 'first', quantity: 0 }], [{ productId: '../secret' }]]) assert.throws(() => fixedCommissionForItems(items, 99900));
  for (const amount of [NaN, 0, 1999, 2000, 2000.5, Infinity]) assert.throws(() => fixedCommissionForItems([{ productId: 'first' }], amount));
  assert.equal(fixedCommissionForItems([{ productId: 'first' }], 2001).sellerPaise, 1);
});

test('membership fee snapshots retain old percentage contracts and enforce a fixed fee for new ones', () => {
  assert.equal(membershipCommissionPaise(19900, { commissionBps: 1000 }), 1990);
  assert.equal(membershipCommissionPaise(19900, { commissionModel: 'fixed_per_item', commissionPaise: 2000 }), 2000);
  assert.throws(() => membershipCommissionPaise(2000, { commissionModel: 'fixed_per_item', commissionPaise: 2000 }));
  assert.throws(() => membershipCommissionPaise(19900, { commissionModel: 'fixed_per_item', commissionPaise: 1 }));
  assert.throws(() => membershipCommissionPaise(19900, { commissionBps: -1 }));
});
