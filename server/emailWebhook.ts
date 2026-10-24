import crypto from 'node:crypto';
import { Resend } from 'resend';
import type { Express } from 'express';
import { Store } from './store';

const EVENTS: Record<string, string> = {
  'email.sent': 'accepted', 'email.delivery_delayed': 'delayed', 'email.delivered': 'delivered',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed',
};
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

export function verifyResendEvent(rawBody: unknown, headers: { id?: string; timestamp?: string; signature?: string }): any | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !Buffer.isBuffer(rawBody) || !headers.id || !headers.timestamp || !headers.signature) return null;
  try {
    return new Resend(process.env.RESEND_API_KEY || 'verification-only').webhooks.verify({
      payload: rawBody.toString('utf8'), webhookSecret: secret,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
    });
  } catch { return null; }
}

export function registerEmailWebhookRoutes(app: Express) {
  app.post('/api/emails/resend/webhook', async (req: any, res) => {
    if (!process.env.RESEND_WEBHOOK_SECRET) return res.status(503).json({ success: false, message: 'Email event verification is not configured.' });
    const eventId = req.get('svix-id');
    const event = verifyResendEvent(req.rawBody, { id: eventId, timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature') });
    if (!event) return res.status(400).json({ success: false });
    const providerStatus = EVENTS[event.type];
    if (!providerStatus) return res.json({ success: true });
    const emailId = event.data?.email_id;
    const createdAt = event.created_at;
    if (typeof emailId !== 'string' || !SAFE_ID.test(emailId) || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return res.status(400).json({ success: false });
    try {
      let index = await Store.get<any>(`emailProviderIndex/${emailId}`);
      // Auth emails share the Resend account but have no store-order mapping. Do not store their payloads or tokens.
      if (!index) {
        // Our signed outbound tags permit recovery when delivery beats persistence of the send response.
        const notificationId = event.data?.tags?.store_notification;
        const orderId = event.data?.tags?.store_order;
        if (typeof notificationId !== 'string' || !SAFE_ID.test(notificationId) || typeof orderId !== 'string' || !SAFE_ID.test(orderId)) return res.json({ success: true, ignored: true });
        const record = await Store.get<any>(`notifications/${notificationId}`);
        if (!record || record.orderId !== orderId || record.notificationId !== notificationId || (record.emailId && record.emailId !== emailId) || !record.payload?.to || !Array.isArray(event.data?.to) || !event.data.to.some((to: unknown) => typeof to === 'string' && to.toLowerCase() === record.payload.to.toLowerCase())) return res.status(503).json({ success: false });
        await Store.update(`notifications/${notificationId}`, { status: 'sent', emailId });
        index = { notificationId, orderId, kind: record.kind };
        await Store.set(`emailProviderIndex/${emailId}`, index);
      }
      if (!SAFE_ID.test(index.notificationId || '')) return res.status(400).json({ success: false });
      await Store.rpc('email_provider_event', `notifications/${index.notificationId}`, {
        notificationId: index.notificationId, emailId, providerStatus,
        eventId: crypto.createHash('sha256').update(String(eventId)).digest('hex'),
        eventCreatedAt: createdAt, receivedAt: new Date().toISOString(),
      });
      return res.json({ success: true });
    } catch { return res.status(503).json({ success: false }); }
  });
}
