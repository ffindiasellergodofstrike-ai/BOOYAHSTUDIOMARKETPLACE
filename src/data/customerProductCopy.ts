export const DELIVERY_FAQ = {
  question: 'How will I receive my purchase?',
  answer: 'After captured-payment verification, sign in to your account to request an expiring download link. A confirmation email may also be sent. If access is missing, contact connectbooyahstudio@gmail.com with your order reference.',
};

/** Older database records can override bundled listings; migrate only obsolete store copy. */
export function customerProductFaqs(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => item?.question === 'What happens in test checkout?' ? { ...DELIVERY_FAQ } : item);
}
export function customerProductDescription(value: unknown): string {
  return typeof value === 'string' ? value.replace(' Gateway approval depends on your merchant account, final content and integration; it is not included with this template.', '') : '';
}
