/** Customer order views exclude provider-issued seller routing references. */
export function customerOrder<T extends Record<string, any>>(order: T): T {
  if (!order?.marketplace) return order;
  const { providerAccountId: _privateReference, ...marketplace } = order.marketplace;
  return { ...order, marketplace };
}
