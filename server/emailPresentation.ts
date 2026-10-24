import { BUSINESS } from '../src/config/business';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const amount = (value: unknown): string => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';

/** Presentation only. The caller has already verified the order and trusted origin. */
export function renderOrderEmailHtml(order: any, refund: boolean, trustedOrigin: string): string {
  const origin = new URL(trustedOrigin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid email origin.');
  const accountUrl = new URL(refund ? '/account/orders' : '/account/downloads', origin).toString();
  const title = refund ? 'Your refund is confirmed.' : 'A good idea starts here.';
  const preview = refund ? 'An update on your Booyahstudio order.' : 'Your order is confirmed. Your downloads are ready in your account.';
  const intro = refund
    ? 'We have recorded a refund for your order. You can review your current purchases and access in your account.'
    : 'Thanks for choosing Booyahstudio. Your purchase is confirmed, and your files are waiting in your account.';
  const orderReference = escapeHtml(order.orderNumber || order.id);
  const currency = escapeHtml(order.currency || 'INR');
  const items = (Array.isArray(order.items) ? order.items : []).map((item: any) => `<tr><td style="padding:16px 0;border-bottom:1px solid #eae7df;font-size:15px;line-height:1.6;color:#292c25;">${escapeHtml(item.productTitle || item.product?.title || item.productId || 'Digital product')}<br><span style="font-size:12px;color:#767a6f;">By ${escapeHtml(item.sellerName || item.product?.sellerName || BUSINESS.name)}</span>${item.refunded ? '<br><span style="font-size:12px;color:#767a6f;">Refunded · further downloads restricted</span>' : ''}</td><td width="90" align="right" style="padding:16px 0;border-bottom:1px solid #eae7df;font-size:12px;color:#767a6f;vertical-align:top;">${item.refunded ? 'Refunded' : 'Digital item'}</td></tr>`).join('');
  const refundRow = Number(order.refundedAmount) > 0 ? `<tr><td style="padding:12px 0 0;font-size:13px;color:#6f7468;">Confirmed refund</td><td align="right" style="padding:12px 0 0;font-size:14px;font-weight:700;color:#292c25;">INR ${amount(order.refundedAmount)}</td></tr>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f4ee;font-family:Arial,Helvetica,sans-serif;color:#292c25;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preview}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f4ee;"><tr><td align="center" style="padding:36px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;"><tr><td style="padding:0 8px 24px;font-size:22px;font-weight:700;letter-spacing:-.7px;">${escapeHtml(BUSINESS.name)}<span style="color:#c84c20;">.</span></td></tr>
<tr><td style="background:#fffefa;border:1px solid #e6e3d9;border-top:4px solid #c84c20;border-radius:16px;padding:32px 24px;">
<p style="margin:0 0 20px;font-size:10px;font-weight:700;letter-spacing:2px;color:#8b664e;">${refund ? 'AN UPDATE ON YOUR ORDER' : 'THANK YOU FOR YOUR ORDER'}</p>
<h1 style="margin:0 0 18px;font-size:32px;font-weight:700;line-height:1.2;letter-spacing:-1px;color:#292c25;">${title}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#686f61;">${intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f3ec;border:1px solid #e9e6dd;border-radius:10px;"><tr><td style="padding:16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-size:12px;color:#6f7468;">Order</td><td align="right" style="font-size:13px;font-weight:700;color:#292c25;word-break:break-word;">${orderReference}</td></tr><tr><td style="padding-top:12px;font-size:13px;color:#6f7468;">Amount paid</td><td align="right" style="padding-top:12px;font-size:18px;font-weight:700;color:#292c25;">${currency} ${amount(order.total)}</td></tr>${refundRow}</table></td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 24px;">${items}</table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#c84c20" style="background:#c84c20;border-radius:7px;mso-padding-alt:16px 24px;"><a href="${escapeHtml(accountUrl)}" style="display:inline-block;padding:16px 24px;border:1px solid #c84c20;border-radius:7px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${refund ? 'View your order' : 'Download your files'} &nbsp; &#8594;</a></td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#767a6f;">${refund ? 'Bank credit timing depends on your payment provider and bank. Your account shows which products remain available.' : 'Sign in with the email address you used at checkout, then choose Download beside your file. Your purchases and receipts are saved in your account.'}</p>
<div style="margin-top:28px;padding-top:20px;border-top:1px solid #eae7df;"><p style="margin:0;font-size:11px;line-height:1.8;color:#8a8e83;">Payment reference: ${escapeHtml(order.transactionId)}<br>Payment provider: ${escapeHtml(order.paymentProvider)}</p></div>
</td></tr>
<tr><td style="padding:24px 8px 0;"><p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#686f61;">A question about your order? <a href="mailto:${escapeHtml(BUSINESS.email)}" style="color:#a94421;text-decoration:underline;">We are here to help.</a></p><p style="margin:0;font-size:11px;line-height:1.8;color:#8a8e83;">${escapeHtml(BUSINESS.name)} · ${escapeHtml(BUSINESS.owner)}<br>${escapeHtml(BUSINESS.address)}<br>Customer support &amp; grievances: <a href="mailto:${escapeHtml(BUSINESS.email)}" style="color:#a94421;">${escapeHtml(BUSINESS.email)}</a><br>WhatsApp: <a href="${escapeHtml(BUSINESS.phoneHref)}" style="color:#a94421;">${escapeHtml(BUSINESS.phone)}</a><br>Grievance contact: ${escapeHtml(BUSINESS.owner)}, at the same email and address.<br>&copy; ${new Date().getFullYear()} ${escapeHtml(BUSINESS.owner)} · ${escapeHtml(BUSINESS.name)}. Each publisher retains rights to their original work. Product use is subject to its supplied license.${BUSINESS.legalName ? `<br>Legal name: ${escapeHtml(BUSINESS.legalName)}` : ''}${BUSINESS.gstin ? `<br>GSTIN: ${escapeHtml(BUSINESS.gstin)}` : ''}</p></td></tr>
</table></td></tr></table></body></html>`;
}
