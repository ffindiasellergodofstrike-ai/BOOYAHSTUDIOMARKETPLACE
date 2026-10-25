import { policyVersion, policyDocuments } from './policies';
import { SUPPORTED_POLICY_SLUGS } from '../src/data/policyData';
import { appOrigin } from './config';
import 'express-async-errors';
import { seoMiddleware } from './seoMiddleware';
import { renderRobots, renderSitemap } from '../src/seo/publicPages';
import fs from 'node:fs';
import { hasLivePayment } from '../src/services/PaymentEnvironment';
import { BUSINESS } from '../src/config/business';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { isIP } from 'node:net';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { AuthServiceServer, registerAuthRoutes } from './auth';
import { Store } from './store';
import { AuditLogger, generateRequestId } from './audit';
import { PRODUCTS, COUPONS } from '../src/data/products';
import { adminRouter } from './adminRoutes';
import { adminOperationsRouter } from './adminOperations';
import { adminManagementRouter } from './adminManagement';
import { apiErrorHandler } from './httpErrors';
import { mergeProductCatalog } from './productCatalog';
import { isPaidOrderForProduct, hasVerifiedEasebuzzFunding } from './paymentAccess';
import { buildInvoicePdf } from './purchaseEmail';
import { registerRazorpayRoutes, paymentEnvironment, razorpayRequest, matchesPaymentReference, syncPayment as syncRazorpayPayment } from './razorpay';
import { registerCashfreeRoutes, cashfreeConfig, syncCashfreeOrder } from './cashfree';
import { registerCashfreeDisputeRoutes } from './cashfreeDisputes';
import { registerDownloadRoutes } from './downloads';
import { retryOrderEmails } from './orderEmail';
import { registerEmailWebhookRoutes } from './emailWebhook';
import { registerCreatorMarketplaceRoutes, filterMarketplaceCatalog, prepareCreatorOrder } from './creatorMarketplace';
import { registerGatewayControlRoutes, getPublicGatewayConfig, getActiveGateway, assertGatewayForNewOrder, gatewayProviders } from './gatewayControl';
import { registerEasebuzzRoutes, syncEasebuzzOrder } from './easebuzzGateway';
import { registerCreatorGatewayRoutes } from './gatewaySplits';
import { registerSubscriptionRoutes, reconcileSubscriptions } from './subscriptions';
import { customerOrder } from './customerOrder';
import { registerDisputeAutomationRoutes, reconcileDisputes } from './disputeAutomation';
const getConfiguredAppUrl = appOrigin;

const getPaymentRequestIp = (req: Request): string => {
  // Vercel sets this header from the client connection and prevents spoofing.
  const forwarded = process.env.VERCEL
    ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for']
    : undefined;
  const candidate = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || '')
    .split(',')[0].trim();
  return isIP(candidate) ? candidate : '';
};

const getProductCatalog = async (): Promise<any[]> => {
  const databaseProducts = process.env.SUPABASE_URL ? await Store.getAllProducts() : [];
  return filterMarketplaceCatalog(mergeProductCatalog(PRODUCTS, databaseProducts));
};

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  username?: string;
}

export const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Block direct access to internal data, private archives, server source code, and configuration files
const BLOCKED_PATH_PATTERNS = [
  /^\/(\.data|\.env|demofiles|templates|owner-files|supabase|docs|server|scripts|build)(\/|$)/i,
  /^\/api\/index(\.ts|\.js)?$/i,
  /\.zip$/i,
  /\.ya?ml$/i,
  /\.lock$/i,
  /\.py$/i,
  /\.sh$/i,
  /\.mjs$/i,
  /^\/(package|tsconfig|components|metadata|database\.rules|vercel)\.json$/i,
  /^\/server\.ts$/i,
];

app.use((req: Request, res: Response, next: NextFunction) => {
  let safePath = req.path;
  try {
    safePath = path.posix.normalize(decodeURIComponent(req.path));
  } catch {
    return res.status(400).send('Bad Request');
  }

  if (safePath.includes('..')) {
    return res.status(404).send('Not Found');
  }

  if (BLOCKED_PATH_PATTERNS.some(pattern => pattern.test(safePath))) {
    return res.status(404).send('Not Found');
  }

  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.replace(/\/+$/, '') === getConfiguredAppUrl()) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const url = new URL(origin);
        if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
          return callback(null, true);
        }
      } catch {
        // Reject malformed origins.
      }
    }
    return callback(null, false);
  },
  credentials: true,
}));

app.use(cookieParser());
app.use(['/login', '/forgot-password'], (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use('/api', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'private, no-store');
  const signedWebhook = ['/payments/razorpay/webhook', '/payments/cashfree/webhook', '/payments/cashfree/disputes/webhook', '/emails/resend/webhook', '/payments/easebuzz/return', '/payments/easebuzz/webhook', '/marketplace/subscriptions/webhooks/cashfree', '/marketplace/subscriptions/webhooks/razorpay', '/marketplace/subscriptions/easebuzz/return'].includes(req.path);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !signedWebhook) {
    const origin = req.get('origin');
    if ((origin && origin !== getConfiguredAppUrl()) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ message: 'Cross-site request denied.' });
  }
  next();
});
app.use(express.json({
  limit: '2mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use('/demos', (_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send(renderRobots());
});
app.get('/sitemap.xml', async (_req: Request, res: Response) => {
  const [products, creatorRecords] = await Promise.all([getProductCatalog(), process.env.SUPABASE_URL ? Store.get<Record<string, any>>('marketplace/creators').catch(() => null) : Promise.resolve(null)]);
  const creatorSlugs = Object.values(creatorRecords || {}).filter(creator => creator.status === 'approved' && /^[a-z0-9][a-z0-9-]{2,49}$/.test(creator.slug)).map(creator => creator.slug);
  res.type('application/xml').send(renderSitemap(products, creatorSlugs));
});

app.use(seoMiddleware);

// Shared database rate limiter
const authRateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = getPaymentRequestIp(req) || req.ip || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 20;

    const allowed = await Store.rpc('rate', `rateLimits/${crypto.createHash('sha256').update(`${req.path}:${ip}`).digest('hex')}`, { now, windowMs, maxAttempts });
    if (!allowed) return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    next();
  } catch {
    // Do not permit unlimited login guesses when the shared limiter is down.
    res.status(503).json({ success: false, message: 'Authentication is temporarily unavailable.' });
  }
};

// Authentication Middleware via Opaque Session Cookie "sid"
const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const sid = req.cookies?.sid;
  if (!sid) {
    return res.status(401).json({ success: false, message: 'Authentication session required.' });
  }

  const payload = await AuthServiceServer.verifyOpaqueSession(sid);
  if (!payload || !payload.userId) {
    res.clearCookie('sid', { path: '/' });
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }

  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.username = payload.username;
  next();
};

const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  await requireAuth(req, res, async () => {
    try {
      const profile = await Store.getUserProfile(req.userId!);
      if (!profile || profile.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Administrative privileges required for this action.' });
      }
      next();
    } catch {
      return res.status(503).json({ success: false, message: 'Administrative access could not be verified. Please retry.' });
    }
  });
};

// ============================================
// SYSTEM & HEALTH ENDPOINTS
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public Product API: static products and Admin/Supabase products are merged.
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, products: await getProductCatalog(), coupons: (process.env.SUPABASE_URL ? await Store.getAllCoupons() : COUPONS).filter(c => c.active !== false && (!c.expiresAt || new Date(c.expiresAt).getTime() > Date.now())) });
  } catch {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, message: 'Product catalog is temporarily unavailable.' });
    }
    res.json({ success: true, products: mergeProductCatalog(PRODUCTS, []) });
  }
});

app.get('/api/products/:slugOrId', async (req: Request, res: Response) => {
  try {
    const identifier = req.params.slugOrId.toLowerCase();
    const list = await getProductCatalog();
    const found = list.find((p: any) => p.id.toLowerCase() === identifier || p.slug.toLowerCase() === identifier);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, product: found });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch product.' });
  }
});

app.post('/api/newsletter/subscribe', authRateLimiter, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  }
  try {
    const key = crypto.createHash('sha256').update(email).digest('hex');
    const path = `newsletterSubscribers/${key}`;
    const existing = await Store.get<any>(path);
    const now = new Date().toISOString();
    await Store.set(path, {
      email, subscribedAt: existing?.subscribedAt || now, lastConsentAt: now, status: 'subscribed',
    });
    res.json({ success: true, message: 'Your subscription was saved.' });
  } catch {
    res.status(503).json({ success: false, message: 'Could not save your subscription. Please retry.' });
  }
});

// Mount Admin Router with requireAdmin
app.post('/api/contact', authRateLimiter, async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email().max(254), message: z.string().trim().min(10).max(4000) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Enter a valid name, email, and message (10–4,000 characters).' });
  try {
    const reference = `BS-${crypto.randomBytes(8).toString('hex')}`;
    const submittedAt = new Date().toISOString();
    await Store.set(`supportRequests/${reference}`, { ...input.data, reference, createdAt: submittedAt, status: 'open' });
    // Return only this validated submission; no lookup by a public reference exposes another complaint.
    res.status(201).json({ success: true, reference, receipt: { ...input.data, reference, submittedAt } });
  } catch { res.status(503).json({ message: 'Support requests are temporarily unavailable.' }); }
});

app.use('/api/admin', requireAdmin, adminOperationsRouter, adminManagementRouter, adminRouter);

// ============================================
// AUTH ENDPOINTS (OPAQUE SESSIONS + COOKIES)
// ============================================
registerAuthRoutes(app, authRateLimiter);

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await Store.getUserProfile(req.userId!);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }
    res.json({ success: true, user: profile });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
});

app.post('/api/auth/logout', async (req: AuthenticatedRequest, res) => {
  try {
    const sid = req.cookies?.sid;
    if (sid) {
      await AuthServiceServer.destroyOpaqueSession(sid);
    }
    res.clearCookie('sid', { path: '/' });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch {
    res.status(503).json({ success: false, message: 'Sign out could not be completed. Please retry.' });
  }
});

// ============================================
// USER SYNC, CART, WISHLIST & ORDERS
// ============================================
app.get('/api/user/sync-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const [profile, cart, wishlist, orders, downloads, settings] = await Promise.all([
      Store.getUserProfile(userId),
      Store.getUserCart(userId),
      Store.getUserWishlist(userId),
      Store.getUserOrders(userId),
      Store.getUserDownloads(userId),
      Store.getUserSettings(userId),
    ]);
    res.json({ success: true, data: { profile, cart, wishlist, orders: orders.map(customerOrder), downloads, settings } });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to sync user data.' });
  }
});

app.put('/api/user/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    company: z.string().trim().max(150).optional(),
    country: z.string().trim().min(2).max(100).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ success: false, message: 'Only name, company and country can be updated.' });
  }
  try {
    const profile = await Store.getUserProfile(req.userId!);
    if (!profile) return res.status(404).json({ success: false, message: 'Account not found.' });
    const updatedAt = new Date().toISOString();
    await Store.updateUserProfile(req.userId!, { ...parsed.data, updatedAt });
    res.json({ success: true, user: { ...profile, ...parsed.data, updatedAt } });
  } catch {
    res.status(503).json({ success: false, message: 'Could not save profile changes.' });
  }
});

app.get('/api/user/cart', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await Store.getUserCart(req.userId!);
    res.json({ success: true, items });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch cart.' });
  }
});

app.post('/api/user/cart', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item !== 'object')) return res.status(400).json({ success: false, message: 'Invalid saved selections.' });
    await Store.setUserCart(req.userId!, items || []);
    res.json({ success: true, items });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save cart.' });
  }
});

app.get('/api/user/wishlist', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await Store.getUserWishlist(req.userId!);
    res.json({ success: true, items });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch wishlist.' });
  }
});

app.post('/api/user/wishlist', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item !== 'object')) return res.status(400).json({ success: false, message: 'Invalid saved selections.' });
    await Store.setUserWishlist(req.userId!, items || []);
    res.json({ success: true, items });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save wishlist.' });
  }
});

app.get('/api/user/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const orders = await Store.getUserOrders(req.userId!);
    res.json({ success: true, orders: orders.map(customerOrder) });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

app.get('/api/user/downloads', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const downloads = await Store.getUserDownloads(req.userId!);
    const checked = await Promise.all(downloads.map(async (download: any) => {
      if (!download?.orderId || !download?.productId) return null;
      const order = await Store.getGlobalOrder(download.orderId);
      return isPaidOrderForProduct(order, req.userId!, download.productId) ? download : null;
    }));
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.json({ success: true, downloads: checked.filter(Boolean) });
  } catch {
    res.status(503).json({ success: false, message: 'Could not fetch downloads.' });
  }
});

app.get('/api/orders/:orderId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const order = await Store.getUserOrderById(req.userId!, req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.json({ success: true, order: customerOrder(order) });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch order.' });
  }
});

app.get('/api/orders/:orderId/invoice', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const order = await Store.getUserOrderById(req.userId!, req.params.orderId);
    if (!order) return res.status(404).send('Order not found.');
    const provider = String(order.paymentProvider || '').toLowerCase();
    if (!hasLivePayment(order) || !['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(String(order.paymentStatus).toUpperCase()) ||
        !['razorpay','cashfree','easebuzz'].includes(provider) || !order.transactionId ||
        (provider === 'easebuzz' && !hasVerifiedEasebuzzFunding(order))) {
      return res.status(403).send('A verified paid order is required for an invoice.');
    }
    const invoice = await buildInvoicePdf(order);
    const invoiceNumber = String(order.invoiceNumber || `INV-${order.id}`)
      .replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNumber}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).send(invoice);
  } catch {
    return res.status(503).send('Invoice is temporarily unavailable.');
  }
});

// Secure Order Creation with strict validation
const handleOrderCreation = async (req: AuthenticatedRequest, res: Response) => {
  const requestId = generateRequestId();
  try {
    const userId = req.userId!;
    const { items, customer, discountCode } = req.body;
    const selectedProvider = req.body.paymentProvider || await getActiveGateway();
    if (!gatewayProviders.includes(selectedProvider)) return res.status(409).json({ success: false, message: 'Checkout is currently unavailable. Please contact support.', requestId });
    let gateway;
    try { gateway = await assertGatewayForNewOrder(selectedProvider); }
    catch { return res.status(409).json({ success: false, message: 'This payment provider is currently unavailable. Refresh checkout and try again.', requestId }); }
    const customerInput = z.object({ fullName: z.string().trim().min(1).max(100), email: z.string().email().max(254), phone: z.string().max(20).optional(), company: z.string().max(150).optional(), country: z.string().max(100).optional() }).safeParse(customer);
    if (!customerInput.success || (discountCode !== undefined && (typeof discountCode !== 'string' || discountCode.length > 100))) return res.status(400).json({ success: false, message: 'Provide valid checkout details.' });
    const buyerProfile = await Store.getUserProfile(userId);
    const buyerEmail = String(buyerProfile?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({ success: false, message: 'Add a valid email to your account before checkout.', requestId });
    }
    if (customer?.email && String(customer.email).trim().toLowerCase() !== buyerEmail) {
      return res.status(400).json({ success: false, message: 'Checkout email must match your account email.', requestId });
    }
    if (!items || !Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ success: false, message: 'Cart items are required.', requestId });
    }

    let calculatedSubtotal = 0;
    const validatedItems: any[] = [];
    let primaryProductId = '';
    let primaryProductName = '';

    const productList = await getProductCatalog();

    for (const ci of items) {
      const rawId = ci.productId || ci.product?.id || ci.id;
      const matchedProduct = productList.find((p: any) => p.id === rawId || p.slug === rawId);
      if (!matchedProduct) {
        return res.status(400).json({ success: false, message: `Unknown product ID: ${rawId}`, requestId });
      }

      const quantity = ci.quantity === undefined ? 1 : Number(ci.quantity);
      if (!Number.isInteger(quantity) || quantity !== 1) {
        return res.status(400).json({ success: false, message: 'Each digital product may be purchased once per order.', requestId });
      }

      if (!primaryProductId) {
        primaryProductId = matchedProduct.id;
        primaryProductName = matchedProduct.title;
      }

      if (validatedItems.some(item => item.productId === matchedProduct.id)) return res.status(400).json({ success: false, message: 'Duplicate product in cart.' });
      if (!Number.isFinite(matchedProduct.price) || matchedProduct.price <= 0) throw new Error('Invalid product price');
      const serverPrice = matchedProduct.price;
      calculatedSubtotal += serverPrice * quantity;

      validatedItems.push({
        sellerId: matchedProduct.sellerId || 'booyahstudio',
        sellerName: matchedProduct.sellerName || BUSINESS.name,
        creatorSlug: matchedProduct.creatorSlug || 'booyahstudio',
        productId: matchedProduct.id,
        productTitle: matchedProduct.title,
        productSlug: matchedProduct.slug,
        productImage: matchedProduct.image,
        category: matchedProduct.categoryLabel || matchedProduct.category,
        productType: matchedProduct.productType || 'DOWNLOAD',
        price: serverPrice,
        quantity,
        downloadUrl: `/api/downloads/${matchedProduct.id}`,
        fileSize: matchedProduct.fileSize || '',
        version: matchedProduct.version || '',
        fileFormat: matchedProduct.fileFormat || 'ZIP',
        downloadStatus: 'UNAVAILABLE',
        downloadLimit: 20,
        downloadCount: 0,
        product: matchedProduct,
      });
    }

    let calculatedDiscount = 0;
    if (discountCode) {
      const coupon = (await Store.getAllCoupons()).find((c) => c.code.toUpperCase() === String(discountCode).toUpperCase());
      if (coupon) {
        const nowMs = Date.now();
        const isActive = coupon.active !== false;
        const isNotExpired = !coupon.expiresAt || new Date(coupon.expiresAt).getTime() > nowMs;
        const meetsMinSpend = !coupon.minSpend || calculatedSubtotal >= coupon.minSpend;

        if (isActive && isNotExpired && meetsMinSpend) {
          calculatedDiscount = Math.round(calculatedSubtotal * coupon.discountPercent) / 100;
        }
      }
    }

    if (discountCode && calculatedDiscount <= 0) return res.status(400).json({ success: false, message: 'This discount is unavailable. Remove it and review your total before retrying.' });
    const calculatedTotal = Math.max(0, calculatedSubtotal - calculatedDiscount);
    if (!Number.isFinite(calculatedTotal) || calculatedTotal <= 0) {
      return res.status(400).json({ success: false, message: 'Order total must be a positive amount.', requestId });
    }
    let marketplace;
    try {
      marketplace = await prepareCreatorOrder(validatedItems, selectedProvider, Math.round(calculatedTotal * 100));
      await assertGatewayForNewOrder(selectedProvider, { marketplace });
    } catch (error: any) {
      return res.status(409).json({ success: false, message: error?.name === 'MarketplaceError' ? error.message : 'This creator is not ready to accept payments. Please try again later.', requestId });
    }
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(9).toString('hex').toUpperCase();
    const orderId = `BS-${todayStr}-${randomHex}`;
    const now = new Date().toISOString();

    const newOrder = {
      id: orderId,
      orderId,
      orderNumber: orderId,
      userId,
      date: now.split('T')[0],
      createdAt: now,
      updatedAt: now,
      customerEmail: buyerEmail,
      customerName: customer?.fullName || 'Customer',
      productId: primaryProductId,
      productNameSnapshot: primaryProductName,
      status: 'PENDING',
      paymentStatus: 'PENDING',
      orderStatus: 'PENDING',
      deliveryStatus: 'PENDING',
      downloadStatus: 'UNAVAILABLE',
      amount: calculatedTotal,
      currency: 'INR',
      customer: {
        fullName: customer?.fullName || 'Customer',
        email: buyerEmail,
        phone: customer?.phone || '',
        company: customer?.company || '',
        country: 'India',
      },
      items: validatedItems,
      subtotal: calculatedSubtotal,
      discount: calculatedDiscount,
      discountCode: discountCode || '',
      tax: 0,
      taxTreatment: 'Displayed order total; payment receipt only',
      policyVersion,
      total: calculatedTotal,
      paymentMethod: selectedProvider === 'cashfree' ? 'Cashfree' : selectedProvider === 'razorpay' ? 'Razorpay' : 'Easebuzz',
      paymentProvider: selectedProvider === 'cashfree' ? 'Cashfree' : selectedProvider === 'razorpay' ? 'Razorpay' : 'Easebuzz',
      paymentEnvironment: gateway.environment,
      ...(marketplace ? { marketplace } : {}),
      checkoutStartedAt: now,
      requestId,
    };

    await Store.saveGlobalOrder(newOrder);

    await AuditLogger.log({
      requestId,
      userId,
      orderId,
      productId: primaryProductId,
      eventType: 'ORDER_CREATED',
      eventStatus: 'SUCCESS',
      source: 'API',
      metadata: { amount: calculatedTotal, currency: 'INR', itemsCount: validatedItems.length },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ success: true, order: customerOrder(newOrder), requestId });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create order.', requestId });
  }
};

app.post('/api/orders/create', requireAuth, authRateLimiter, handleOrderCreation);
app.post('/api/user/orders', requireAuth, authRateLimiter, handleOrderCreation);

// ============================================

app.get('/api/config/payments', async (_req, res) => {
  res.json({ success: true, ...await getPublicGatewayConfig() });
});
registerCreatorMarketplaceRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerGatewayControlRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerSubscriptionRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerEasebuzzRoutes(app, requireAuth, authRateLimiter);
registerCreatorGatewayRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerDisputeAutomationRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerCashfreeRoutes(app, requireAuth, authRateLimiter);
registerCashfreeDisputeRoutes(app, requireAuth, requireAdmin, authRateLimiter);
registerEmailWebhookRoutes(app);
registerRazorpayRoutes(app, requireAuth, authRateLimiter);
registerDownloadRoutes(app, requireAuth);
// These retired integrations must not be activated by stale environment variables.
app.all(['/api/payments/payu/*', '/api/payments/paddle/*', '/api/config/paddle'], (_req, res) => res.status(410).json({ success:false, message:'This payment integration is retired. Use the configured checkout.' }));

app.post('/api/admin/cashfree/orders/:orderId/refunds/:refundId/allocate', requireAdmin, async (req:any,res) => {
  const input = z.object({ reviewed:z.literal(true), reason:z.string().trim().min(10).max(1000), allocations:z.array(z.object({productId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),amountPaise:z.number().int().positive()})).min(1).max(30) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({success:false,message:'A review reason and exact item refund allocations are required.'});
  const order = await Store.getGlobalOrder(req.params.orderId);
  if (!order || String(order.paymentProvider).toLowerCase() !== 'cashfree') return res.status(404).json({success:false});
  try {
    const saved = await Store.rpc('allocate_cashfree_refund',`orders/${order.id}`,{refund_id:req.params.refundId,itemAllocations:input.data.allocations.map(item=>({productId:item.productId,amount:item.amountPaise})),reviewedBy:req.userId,reason:input.data.reason});
    res.json({success:true,order:saved});
  } catch { res.status(409).json({success:false,message:'Allocation must match a confirmed unallocated refund and the item paid totals.'}); }
});

// Schedule this authenticated endpoint in your hosting provider. It never initiates a refund.
app.all(['/api/jobs/reconcile', '/api/payments/easebuzz/reconcile-cron'], async(req,res) => {
  if (!process.env.CRON_SECRET || req.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(403).json({success:false});
  const orders = await Store.getAllGlobalOrders();
  const candidates = orders.filter(order => {
    const provider = String(order.paymentProvider).toLowerCase();
    return ['PENDING','FAILED','PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus) && (
      (provider === 'cashfree' && order.cashfreeOrderId && order.paymentEnvironment === cashfreeConfig().environment) ||
      (provider === 'razorpay' && order.razorpayOrderId && order.paymentEnvironment === paymentEnvironment()) ||
      (provider === 'easebuzz' && order.easebuzzTxnId && order.paymentEnvironment === (process.env.EASEBUZZ_ENV === 'prod' ? 'live' : 'test')));
  })
    .sort((a,b) => String(a.reconciliationAttemptAt || '').localeCompare(String(b.reconciliationAttemptAt || ''))).slice(0,5);
  const paymentsTask = Promise.allSettled(candidates.map(async order => {
    await Store.rpc('order_note',`orders/${order.id}`,{reconciliationAttemptAt:new Date().toISOString()});
    const provider = String(order.paymentProvider).toLowerCase();
    if (provider === 'cashfree') return syncCashfreeOrder(order);
    if (provider === 'easebuzz') return syncEasebuzzOrder(order);
    const remote = await razorpayRequest(`orders/${order.razorpayOrderId}/payments`);
    let saved = order;
    for (const payment of remote.items || []) if (matchesPaymentReference(payment, saved)) saved = await syncRazorpayPayment(saved, payment);
    return saved;
  }));
  // Independent bounded work runs together within the serverless execution window.
  const [paymentsResult, emailsResult, subscriptionsResult, disputesResult] = await Promise.allSettled([paymentsTask, retryOrderEmails(5), reconcileSubscriptions(3), reconcileDisputes(3)]);
  const results = paymentsResult.status === 'fulfilled' ? paymentsResult.value : [];
  const failedModules = [paymentsResult, emailsResult, subscriptionsResult, disputesResult].filter(result => result.status === 'rejected').length;
  const reviewRequired = failedModules + results.filter(result=>result.status==='rejected').length;
  const outcome = {completedAt:new Date().toISOString(),status:reviewRequired ? 'completed_with_review' : 'completed',reconciled:results.filter(result=>result.status==='fulfilled').length,reviewRequired,
    emails:emailsResult.status === 'fulfilled' ? emailsResult.value : {status:'review_required'},
    subscriptions:subscriptionsResult.status === 'fulfilled' ? subscriptionsResult.value : {status:'review_required'},
    disputes:disputesResult.status === 'fulfilled' ? disputesResult.value : {status:'review_required'}};
  await Store.set('operations/reconciliationLastRun',outcome);
  res.json({success:true,...outcome});
});

app.use('/api', (_req, res) => res.status(404).json({ success: false, message: 'Endpoint not found.' }));
app.use(apiErrorHandler);
export default app;
