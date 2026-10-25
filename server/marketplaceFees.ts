/** INR20 for each distinct digital item sold; subscriptions to platform plans are not product sales. */
export const MARKETPLACE_ITEM_FEE_PAISE = 2000;
export interface FixedMarketplaceFee {
  commissionModel: 'fixed_per_item';
  unitCommissionPaise: number;
  commissionItemCount: number;
  commissionBps: 0;
  grossPaise: number;
  commissionPaise: number;
  sellerPaise: number;
}
export function fixedCommissionForItems(items: readonly any[], grossPaise: number): FixedMarketplaceFee {
  if (!Array.isArray(items) || !items.length || items.length > 30 || !Number.isSafeInteger(grossPaise) || grossPaise <= 0) throw new Error('Invalid marketplace sale.');
  const ids = new Set<string>();
  for (const item of items) {
    const id = item?.productId || item?.product?.id || item?.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || ids.has(id) || (item.quantity !== undefined && item.quantity !== 1)) throw new Error('Each digital product may be sold once per order.');
    ids.add(id);
  }
  const commissionPaise = MARKETPLACE_ITEM_FEE_PAISE * ids.size;
  if (grossPaise <= commissionPaise) throw new Error('The sale total must exceed the INR20 platform fee for each item.');
  return { commissionModel: 'fixed_per_item', unitCommissionPaise: MARKETPLACE_ITEM_FEE_PAISE, commissionItemCount: ids.size, commissionBps: 0, grossPaise, commissionPaise, sellerPaise: grossPaise - commissionPaise };
}

/** Frozen subscription splits preserve historical percentage contracts; new membership sales use a flat item fee. */
export function membershipCommissionPaise(grossPaise: number, split: { commissionModel?: string; commissionPaise?: number; commissionBps?: number }): number {
  if (!Number.isSafeInteger(grossPaise) || grossPaise <= 0) throw new Error('Invalid membership amount.');
  if (split.commissionModel === 'fixed_per_item') {
    if (split.commissionPaise !== MARKETPLACE_ITEM_FEE_PAISE || grossPaise <= MARKETPLACE_ITEM_FEE_PAISE) throw new Error('Invalid fixed membership commission.');
    return MARKETPLACE_ITEM_FEE_PAISE;
  }
  const bps = split.commissionBps;
  if (!Number.isSafeInteger(bps) || bps! < 0 || bps! > 10000) throw new Error('Invalid legacy membership commission.');
  return Math.floor(grossPaise * bps! / 10000);
}
