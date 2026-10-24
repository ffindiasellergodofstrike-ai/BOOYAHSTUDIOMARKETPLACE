/** Unknown/legacy environments never authorize paid-file delivery. */
export const hasLivePayment = (order: { paymentEnvironment?: string } | null | undefined): boolean => order?.paymentEnvironment === 'live';
export const isTestPayment = (order: { paymentEnvironment?: string } | null | undefined): boolean => order?.paymentEnvironment === 'test';
