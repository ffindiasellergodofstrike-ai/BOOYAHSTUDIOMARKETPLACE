import crypto from 'crypto';
import type { Express, RequestHandler } from 'express';
import { FirebaseRtdb } from './firebaseRtdb';

export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddleProductPriceMapping {
  productId: string;
  productTitle: string;
  paddlePriceId?: string;
  defaultAmountInr: number;
}

// Default mapping for existing catalog products.
// Each product can also have its Paddle Price ID configured via environment variables:
// PADDLE_PRICE_LINKNEST_PRO, PADDLE_PRICE_NEURA_AI, PADDLE_PRICE_FINORA, etc.
export const DEFAULT_PRODUCT_PADDLE_MAPPING: Record<string, PaddleProductPriceMapping> = {
  'linknest-pro': {
    productId: 'linknest-pro',
    productTitle: 'LinkNest Pro — Bio Link & Digital Store',
    defaultAmountInr: 550,
  },
  'neura-ai': {
    productId: 'neura-ai',
    productTitle: 'NeuraAI — Premium AI SaaS Template',
    defaultAmountInr: 750,
  },
  'finora': {
    productId: 'finora',
    productTitle: 'Finora — Premium Fintech Template',
    defaultAmountInr: 1100,
  },
  'learnify': {
    productId: 'learnify',
    productTitle: 'Learnify — Premium LMS Template',
    defaultAmountInr: 1400,
  },
  'velora': {
    productId: 'velora',
    productTitle: 'Velora — Complete E-Commerce Template',
    defaultAmountInr: 5500,
  },
  'workhub': {
    productId: 'workhub',
    productTitle: 'WorkHub — Freelancer Marketplace Template',
    defaultAmountInr: 7500,
  },
};

export function getPaddleEnvironment(): PaddleEnvironment {
  const env = (process.env.PADDLE_ENVIRONMENT || process.env.VITE_PADDLE_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return env === 'production' || env === 'live' ? 'production' : 'sandbox';
}

export function getPaddleClientToken(): string {
  return (
    process.env.PADDLE_CLIENT_TOKEN ||
    process.env.VITE_PADDLE_CLIENT_TOKEN ||
    ''
  ).trim();
}

export function getPaddleApiKey(): string {
  return (process.env.PADDLE_API_KEY || '').trim();
}

export function getPaddleWebhookSecret(): string {
  return (process.env.PADDLE_WEBHOOK_SECRET || '').trim();
}

export function getPaddleApiBaseUrl(env: PaddleEnvironment = getPaddleEnvironment()): string {
  return env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
}

/**
 * Resolves the Paddle Price ID for a product ID from environment variables or custom config.
 * Format for env var: PADDLE_PRICE_<PRODUCT_ID_UPPER_SNAKE>
 * e.g. linknest-pro -> PADDLE_PRICE_LINKNEST_PRO
 */
export function getPaddlePriceIdForProduct(productId: string): string | undefined {
  if (!productId) return undefined;
  const envKey = `PADDLE_PRICE_${productId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const envPriceId = process.env[envKey]?.trim();
  if (envPriceId) return envPriceId;

  const defaultItem = DEFAULT_PRODUCT_PADDLE_MAPPING[productId];
  if (defaultItem?.paddlePriceId) return defaultItem.paddlePriceId;

  // Fallback to a single global price ID if configured
  if (process.env.PADDLE_DEFAULT_PRICE_ID?.trim()) {
    return process.env.PADDLE_DEFAULT_PRICE_ID.trim();
  }

  return undefined;
}

/**
 * Returns complete client-safe Paddle configuration including price mapping.
 */
export function getClientPaddleConfig(): {
  environment: PaddleEnvironment;
  clientToken: string;
  isConfigured: boolean;
  prices: Record<string, string>;
} {
  const env = getPaddleEnvironment();
  const token = getPaddleClientToken();
  const prices: Record<string, string> = {};

  for (const productId of Object.keys(DEFAULT_PRODUCT_PADDLE_MAPPING)) {
    const priceId = getPaddlePriceIdForProduct(productId);
    if (priceId) {
      prices[productId] = priceId;
    }
  }

  const isConfigured = Boolean(token && Object.keys(prices).length > 0);

  return {
    environment: env,
    clientToken: token,
    isConfigured,
    prices,
  };
}

/**
 * Verifies the Paddle webhook signature according to official Paddle Billing documentation.
 *
 * The `Paddle-Signature` header format:
 * `ts=1671552777;h1=eb38f517814b80a4242ec67f781bb703b41d08e1a8a29b6f5cf07f6f59239460`
 *
 * Signature payload:
 * `${ts}:${rawRequestBody}`
 *
 * HMAC: SHA256 using the webhook secret
 */
export function verifyPaddleWebhookSignature(
  rawBody: string | Buffer | undefined,
  signatureHeader: string | undefined,
  webhookSecret: string = getPaddleWebhookSecret(),
  maxAgeSeconds: number = 300
): { isValid: boolean; reason?: string; timestamp?: number } {
  if (!webhookSecret) {
    return { isValid: false, reason: 'Paddle webhook secret is not configured.' };
  }

  if (!rawBody) {
    return { isValid: false, reason: 'Missing raw request body for signature verification.' };
  }

  if (!signatureHeader) {
    return { isValid: false, reason: 'Missing Paddle-Signature header.' };
  }

  const rawString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  // Parse key-value pairs from the header: "ts=12345;h1=abcde;h1=fghij"
  const parts = signatureHeader.split(';');
  let ts: string | undefined;
  const hashes: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key === 'ts' && value) {
      ts = value;
    } else if (key === 'h1' && value) {
      hashes.push(value);
    }
  }

  if (!ts || hashes.length === 0) {
    return { isValid: false, reason: 'Malformed Paddle-Signature header format.' };
  }

  const timestampNum = parseInt(ts, 10);
  if (Number.isNaN(timestampNum)) {
    return { isValid: false, reason: 'Invalid timestamp in Paddle-Signature header.' };
  }

  // Tolerance check (anti-replay)
  if (maxAgeSeconds > 0) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNum) > maxAgeSeconds) {
      return {
        isValid: false,
        reason: `Webhook timestamp is too old or in the future (drift: ${Math.abs(nowSeconds - timestampNum)}s).`,
        timestamp: timestampNum,
      };
    }
  }

  // Compute expected HMAC SHA-256 hash: `${ts}:${rawBody}`
  const signedPayload = `${ts}:${rawString}`;
  const expectedHash = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedHash, 'utf8');

  for (const receivedHash of hashes) {
    const receivedBuffer = Buffer.from(receivedHash, 'utf8');
    if (
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      return { isValid: true, timestamp: timestampNum };
    }
  }

  return { isValid: false, reason: 'Signature mismatch.' };
}

/**
 * Optional server-side transaction retrieval from Paddle REST API
 */
export async function fetchPaddleTransaction(
  transactionId: string,
  apiKey: string = getPaddleApiKey(),
  env: PaddleEnvironment = getPaddleEnvironment()
): Promise<{ success: boolean; data?: any; message?: string }> {
  if (!apiKey) {
    return { success: false, message: 'PADDLE_API_KEY is not configured.' };
  }

  if (!transactionId) {
    return { success: false, message: 'Transaction ID is required.' };
  }

  const baseUrl = getPaddleApiBaseUrl(env);
  try {
    const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, message: `Paddle API error (HTTP ${response.status}): ${errText}` };
    }

    const payload = await response.json();
    return { success: true, data: payload.data };
  } catch (err: any) {
    return { success: false, message: err.message || 'Failed to connect to Paddle API.' };
  }
}

export function registerPaddleRoutes(app: Express, requireAuth: RequestHandler) {
  app.get('/api/config/paddle', (_req, res) => {
    res.json({ success: true, ...getClientPaddleConfig() });
  });

  app.post('/api/payments/paddle/initiate', requireAuth, async (req: any, res) => {
    const { orderId, agreeTerms } = req.body || {};
    if (agreeTerms !== true) {
      return res.status(400).json({ success: false, message: 'Terms agreement required.' });
    }
    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }
    const order = await FirebaseRtdb.getUserOrderById(req.userId, orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const priceId = getPaddlePriceIdForProduct(order.productId);
    res.json({ success: true, priceId, orderId: order.id });
  });

  app.post('/api/payments/paddle/webhook', async (req: any, res) => {
    const signatureHeader = req.headers['paddle-signature'] || req.get('paddle-signature');
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const verification = verifyPaddleWebhookSignature(rawBody, signatureHeader);
    if (!verification.isValid) {
      return res.status(400).json({ success: false, message: verification.reason || 'Invalid signature' });
    }

    const { event_id, event_type, data } = req.body || {};
    if (!event_id) {
      return res.status(400).json({ success: false, message: 'Missing event_id' });
    }

    const existing = await FirebaseRtdb.getPaymentEvent(event_id);
    if (existing) {
      return res.json({ success: true, message: 'Event already processed.' });
    }

    await FirebaseRtdb.savePaymentEvent(event_id, { processedAt: new Date().toISOString() });

    if (event_type === 'transaction.completed' && data) {
      const orderId = data.custom_data?.orderId;
      if (!orderId) {
        return res.status(400).json({ success: false, message: 'Missing orderId in custom_data' });
      }

      const order = await FirebaseRtdb.getGlobalOrder(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const receivedAmountMinor = parseInt(data.details?.totals?.total || '0', 10);
      const expectedAmountMinor = Math.round((order.total || 0) * 100);

      if (receivedAmountMinor < expectedAmountMinor) {
        return res.json({ success: false, message: 'Underpaid transaction' });
      }

      const isLive = getPaddleEnvironment() === 'production';
      order.paymentStatus = 'PAID';
      order.paymentProvider = 'Paddle';
      order.paddleTransactionId = data.id;
      order.downloadStatus = 'UNAVAILABLE';
      order.paymentEnvironment = isLive ? 'live' : 'test';
      order.deliveryStatus = isLive ? 'DELIVERED' : 'TEST_ONLY';

      await FirebaseRtdb.saveGlobalOrder(order);
      return res.json({ success: true, status: 'PAID' });
    }

    res.json({ success: true, message: 'Event recorded.' });
  });

  app.post('/api/payments/paddle/reconcile/:orderId', requireAuth, async (req: any, res) => {
    const order = await FirebaseRtdb.getUserOrderById(req.userId, req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    res.json({ success: true, status: order.paymentStatus || 'PENDING' });
  });
}
