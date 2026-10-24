import { PDFDocument, StandardFonts } from 'pdf-lib';
import { BUSINESS } from '../src/config/business';
import { sendOrderEmail, type EmailSendResult } from './orderEmail';
import { hasVerifiedEasebuzzFunding } from './paymentAccess';

/** Payment receipt only. No tax registration or classification is inferred. */
export async function buildInvoicePdf(order: any): Promise<Buffer> {
  const status = String(order?.paymentStatus || '').toUpperCase();
  if (order?.paymentEnvironment !== 'live' || !['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(status) ||
      !['cashfree', 'razorpay', 'easebuzz'].includes(String(order?.paymentProvider || '').toLowerCase()) || !order?.transactionId ||
      (String(order.paymentProvider).toLowerCase() === 'easebuzz' && !hasVerifiedEasebuzzFunding(order))) {
    throw new Error('Verified Live payment required');
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage(), y = 790;
  const line = (value: string) => {
    const words = String(value).normalize('NFKD').replace(/[^\x20-\x7E]/g, ' ').split(/\s+/);
    let text = '';
    const draw = () => { if (y < 45) { page = pdf.addPage(); y = 790; } page.drawText(text, { x: 40, y, size: 10, font }); y -= 17; text = ''; };
    for (const word of words) { if (font.widthOfTextAtSize(`${text} ${word}`, 10) > 510 && text) draw(); text += (text ? ' ' : '') + word; }
    draw();
  };
  line(`${BUSINESS.owner} | ${BUSINESS.name}`);
  if (BUSINESS.legalName) line(`Legal name: ${BUSINESS.legalName}`);
  if (BUSINESS.gstin) line(`GSTIN: ${BUSINESS.gstin}`);
  line(BUSINESS.address);
  line(`Customer support and grievances: ${BUSINESS.email} | WhatsApp ${BUSINESS.phone}`);
  line(`Grievance contact: ${BUSINESS.owner}, at the same email and address.`);
  y -= 15;
  line('PAYMENT RECEIPT (not a GST tax invoice)');
  line(`Order: ${order.id}`);
  line(`Payment: ${order.transactionId}`);
  line(`Verified: ${order.paymentVerifiedAt || order.createdAt || 'See your order in your account'}`);
  line(`Customer: ${order.customerEmail || order.customer?.email || ''}`);
  y -= 10;
  for (const item of order.items || []) line(`${item.productTitle || item.product?.title || item.productId} | By ${item.sellerName || item.product?.sellerName || BUSINESS.name} | Qty ${item.quantity || 1} | INR ${Number(item.price).toFixed(2)}${item.refunded ? ' | Refunded' : ''}`);
  y -= 10;
  line(`Discount: INR ${Number(order.discount || 0).toFixed(2)}`);
  line(`Amount originally paid: INR ${Number(order.total).toFixed(2)}`);
  if (['PARTIALLY_REFUNDED', 'REFUNDED'].includes(status)) {
    line(`Current payment status: ${status === 'REFUNDED' ? 'Refunded' : 'Partly refunded'}`);
    if (Number(order.refundedAmount) > 0) line(`Confirmed refund recorded: INR ${Number(order.refundedAmount).toFixed(2)}`);
    line('Refund credit timing depends on the payment provider and bank. Current download access is shown in your account.');
  }
  line('For applicable tax documentation, contact the merchant. Download purchased files from your account.');
  return Buffer.from(await pdf.save());
}

/**
 * Compatibility entry point. Live confirmations use the authoritative durable
 * sender. Caller-supplied file URLs or attachments must never bypass access checks.
 */
export async function sendPurchaseConfirmationEmail(order: any, _items: any[] = [], _options: any = {}): Promise<EmailSendResult> {
  if (order?.paymentEnvironment === 'live') return sendOrderEmail(order);
  if (order?.paymentEnvironment !== 'test') return { status: 'skipped' };
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return { status: 'not_configured' };
  const recipient = String(order?.customerEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { status: 'review_required' };
  const reference = String(order?.id || '').replace(/[\r\n]/g, ' ');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: recipient,
        subject: `${BUSINESS.name}: Test payment (Order ${reference})`,
        text: `Test payment recorded for order ${reference}. You will not receive any product files.`,
        html: '<p>This is a test payment. No product files or purchase receipt will be issued.</p>',
        reply_to: BUSINESS.email,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    return response.ok && typeof result?.id === 'string' ? { status: 'sent' } : { status: 'unavailable' };
  } catch { return { status: 'unavailable' }; }
}
