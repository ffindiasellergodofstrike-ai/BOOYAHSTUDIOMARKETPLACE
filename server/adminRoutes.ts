import { paymentEnvironment } from './razorpay';
import { cashfreeConfig } from './cashfree';
import { supabaseAdmin } from './supabase';
import { hasLivePayment } from '../src/services/PaymentEnvironment';
import { Router, Response, Request } from 'express';
import { Store } from './store';
import { AuditLogger, generateRequestId } from './audit';
import { z } from 'zod';
import crypto from 'crypto';
import multer from 'multer';
import { isAllowedProductPreviewUrl } from './productPreview';
import { deliveryAggregates } from './adminOperations';
import { PROXIED_UPLOAD_LIMIT_BYTES } from '../src/config/uploadLimits';

export const adminRouter = Router();

export function safeCsvCell(value: unknown): string {
  const text = String(value ?? '').replace(/\r\n|\r/g, '\n');
  // Spreadsheet programs can execute cells beginning with these characters.
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Configure Multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PROXIED_UPLOAD_LIMIT_BYTES,
  },
});

// Zod schemas for validation
const previewUrlSchema = z.union([z.literal(''), z.string().trim().max(2048)])
  .optional()
  .refine(
    (value) => !value || isAllowedProductPreviewUrl(value),
    'Live preview must use an HTTPS custom domain. Direct *.vercel.app URLs are not allowed.'
  )
  .transform((value) => value?.trim() || undefined);

const productSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  title: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,120}$/),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  category: z.string().min(1),
  categoryLabel: z.string().optional(),
  productType: z.literal('DOWNLOAD').default('DOWNLOAD'),
  whatsIncluded: z.array(z.string().max(1000)).max(100).optional(),
  version: z.string().optional(),
  licenseTerms: z.string().max(10000).optional(),
  fileSize: z.string().optional(),
  fileFormat: z.string().optional(),
  image: z.string().url().or(z.string().min(1)),
  gallery: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'active', 'archived']).default('published'),
  isFeatured: z.boolean().optional(),
  stock: z.number().int().nonnegative().optional(),
  unlimitedStock: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  faqs: z.array(z.any()).optional(),
  previewUrl: previewUrlSchema,
}).superRefine((product, context) => {
  if (['published','active'].includes(product.status) && (!product.licenseTerms?.trim() || !product.requirements?.length || !product.whatsIncluded?.length || !product.description?.trim() || !product.version || product.price <= 0)) {
    context.addIssue({ code: 'custom', message: 'Published products need a positive price, description, version, included files, requirements and actual license terms.' });
  }
  if (product.previewUrl?.startsWith('/') && product.previewUrl !== `/demos/${product.id}/`) {
    context.addIssue({
      code: 'custom',
      path: ['previewUrl'],
      message: `Built-in preview path must match this product ID: /demos/${product.id}/`,
    });
  }
});

const couponSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  code: z.string().min(2),
  discountPercent: z.number().gt(0).lt(100),
  description: z.string().optional(),
  minSpend: z.number().nonnegative().optional(),
  active: z.boolean().default(true),

  expiresAt: z.string().refine(v => Number.isFinite(Date.parse(v)), 'Invalid expiry').optional(),
});

/**
 * Middleware wrapper to ensure requireAuth and requireAdmin are used.
 * We access them from the request or import them in server/app.ts where router is mounted.
 */

// 1. Admin Me & Dashboard Stats
adminRouter.get('/me', async (req: any, res: Response) => {
  try {
    const profile = await Store.getUserProfile(req.userId);
    const supabaseStatus = await Store.testConnection();
    res.json({
      success: true,
      admin: profile,
      health: {
        supabase: supabaseStatus,
        razorpay: { status: process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'configured' : 'not_configured', environment: paymentEnvironment() },
        cashfree: { status: cashfreeConfig().configured ? 'configured' : 'not_configured', environment: cashfreeConfig().environment },
        resend: { status: process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? 'configured' : 'not_configured' },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch admin profile.' });
  }
});

adminRouter.get('/dashboard/stats', async (req: any, res: Response) => {
  try {
    const orders = await Store.getAllGlobalOrders();
    const products = await Store.getAllProducts();
    const users = await Store.getAllUsers();
    const auditLogs = await AuditLogger.getAllLogs(50);

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    const thirtyDays = 30 * oneDay;

    let revenueToday = 0;
    let revenue7d = 0;
    let revenue30d = 0;
    let totalRevenue = 0;

    let paidCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    const dailyRevenue = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(now - (29 - index) * oneDay).toISOString().slice(0, 10);
      return { name: day, revenue: 0 };
    });
    const revenueByDay = new Map(dailyRevenue.map((day) => [day.name, day]));

    orders.forEach((o: any) => {
      if (o.paymentEnvironment !== 'live' && o.paymentStatus === 'PAID') return;
      const amount = Math.max(0, (Number(o.total) || 0) - (Number(o.refundedAmount) || 0));
      const paidDate = o.paymentVerifiedAt || o.paidAt || o.createdAt || o.date;
      const orderTime = new Date(paidDate || 0).getTime();
      const isPaid = hasLivePayment(o) && ['PAID','PARTIALLY_REFUNDED'].includes(String(o.paymentStatus).toUpperCase());

      if (isPaid) {
        totalRevenue += amount;
        if (Number.isFinite(orderTime)) {
          const dayKey = new Date(orderTime).toISOString().slice(0, 10);
          if (dayKey === new Date(now).toISOString().slice(0, 10)) revenueToday += amount;
          if (now - orderTime <= sevenDays) revenue7d += amount;
          if (now - orderTime <= thirtyDays) revenue30d += amount;
          const day = revenueByDay.get(dayKey);
          if (day) day.revenue += amount;
        }
        paidCount++;
      } else if (String(o.paymentStatus).toUpperCase() === 'FAILED') {
        failedCount++;
      } else {
        pendingCount++;
      }
    });

    res.json({
      success: true,
      stats: {
        revenue: { today: revenueToday, last7d: revenue7d, last30d: revenue30d, total: totalRevenue, daily: dailyRevenue },
        orders: { total: orders.length, paid: paidCount, pending: pendingCount, failed: failedCount },
        productsCount: products.length,
        customersCount: users.length,
        conversionRate: orders.length ? (paidCount / orders.length) * 100 : 0,
        ...deliveryAggregates(orders),
      },
      recentOrders: orders.slice(0, 10),
      recentAuditLogs: auditLogs.slice(0, 15),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats.' });
  }
});

// 2. Products Management CRUD & Actions
adminRouter.get('/products', async (req: any, res: Response) => {
  try {
    const products = await Store.getAllProducts();
    res.json({ success: true, products });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
});

adminRouter.post('/products', async (req: any, res: Response) => {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: parsed.error.issues.map(issue => issue.message).join('; '), errors: parsed.error.format() });
    }

    const productData = {
      ...parsed.data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Check slug uniqueness
    const existing = await Store.getAllProducts();
    if (existing.some((p: any) => p.slug === productData.slug && p.id !== productData.id)) {
      return res.status(400).json({ success: false, message: 'Product slug must be unique.' });
    }

    await Store.saveProduct(productData);

    await AuditLogger.log({
      requestId: generateRequestId(),
      userId: req.userId,
      eventType: 'PRODUCT_VIEWED', // or general admin write
      eventStatus: 'SUCCESS',
      productId: productData.id,
      source: 'ADMIN_PANEL',
      metadata: { action: 'CREATE_PRODUCT', productTitle: productData.title },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, product: productData, message: 'Product created successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
});

adminRouter.put('/products/:id', async (req: any, res: Response) => {
  try {
    const productId = req.params.id;
    const existing = await Store.getProductById(productId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const parsed = productSchema.safeParse({ ...existing, ...req.body, id: productId });
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: parsed.error.issues.map(issue => issue.message).join('; '), errors: parsed.error.format() });
    }

    const updated = {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };

    await Store.saveProduct(updated);

    await AuditLogger.log({
      requestId: generateRequestId(),
      userId: req.userId,
      eventType: 'PRODUCT_VIEWED',
      eventStatus: 'SUCCESS',
      productId,
      source: 'ADMIN_PANEL',
      metadata: { action: 'UPDATE_PRODUCT', before: existing, after: updated },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, product: updated, message: 'Product updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

adminRouter.delete('/products/:id', async (req: any, res: Response) => {
  try {
    const productId = req.params.id;
    const existing = await Store.getProductById(productId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Soft delete via status archived
    existing.status = 'archived';
    existing.updatedAt = new Date().toISOString();
    await Store.saveProduct(existing);

    await AuditLogger.log({
      requestId: generateRequestId(),
      userId: req.userId,
      eventType: 'PRODUCT_VIEWED',
      eventStatus: 'SUCCESS',
      productId,
      source: 'ADMIN_PANEL',
      metadata: { action: 'ARCHIVE_PRODUCT', productId },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, message: 'Product archived successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to archive product.' });
  }
});

adminRouter.post('/products/:id/clone', async (req: any, res: Response) => {
  try {
    const productId = req.params.id;
    const existing = await Store.getProductById(productId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const newId = `${existing.id}-copy-${Math.random().toString(36).substring(2, 6)}`;
    const cloned = {
      ...existing,
      id: newId,
      status: 'draft',
      title: `${existing.title} (Copy)`,
      slug: `${existing.slug}-copy-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await Store.saveProduct(cloned);
    res.json({ success: true, product: cloned, message: 'Product cloned successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to clone product.' });
  }
});

// 3. Image Upload Handler (Real Supabase Storage REST API)
adminRouter.post('/uploads/direct', upload.single('image') as any, async (req: any, res: any) => {
  const requestId = generateRequestId();
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No image file provided.', requestId });
    }

    if (!['image/png','image/jpeg','image/webp'].includes(file.mimetype)) return res.status(400).json({ message: 'Upload PNG, JPEG or WebP images.' });
    const bucket = 'product-images';
    const filename = `${crypto.randomUUID()}.${req.file.mimetype.split('/')[1].replace('jpeg', 'jpg')}`;
    const { error } = await supabaseAdmin().storage.from(bucket).upload(filename, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw new Error('Upload failed');
    const { data } = supabaseAdmin().storage.from(bucket).getPublicUrl(filename);
    res.json({ success: true, url: data.publicUrl });

  } catch (err: any) {
    console.error('[Admin Upload Error]', err);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image to storage. Ensure Supabase product-images bucket is configured.',
      requestId
    });
  }
});

adminRouter.post('/uploads/sign', async (req: any, res: Response) => {
  res.json({
    success: true,
    uploadUrl: `/api/admin/uploads/direct`,
    message: 'Use direct upload endpoint with multipart/form-data.'
  });
});

// 4. Orders Management
adminRouter.get('/orders', async (req: any, res: Response) => {
  try {
    const orders = await Store.getAllGlobalOrders();
    res.json({ success: true, orders });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

adminRouter.get('/orders/:id/timeline', async (req: any, res: Response) => {
  try {
    const orderId = req.params.id;
    const auditLogs = await Store.get<Record<string, any>>(`orderAuditIndex/${orderId}`) || {};
    const order = await Store.getGlobalOrder(orderId);
    const lifecycle = [['PAYMENT_INITIATED',order?.paymentInitiatedAt], ['PAYMENT_VERIFIED',order?.paymentVerifiedAt], ['PRODUCT_ACCESS_GRANTED',order?.deliveredAt], ['REFUND_VERIFIED',order?.refundVerifiedAt], ['CHECKOUT_CLOSED_BY_CUSTOMER',order?.checkoutClosedAt]].filter(([,time]) => time).map(([eventType,timestamp]) => ({ eventType, timestamp, source: 'STORED_ORDER' }));
    const timeline = [...Object.values(auditLogs), ...lifecycle].sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    res.json({ success: true, timeline });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch order timeline.' });
  }
});

adminRouter.put('/orders/:id/status', async (req: any, res: Response) => {
  try {
    const orderId = req.params.id;
    const { status, paymentStatus, deliveryStatus } = req.body;
    const order = await Store.getGlobalOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (status !== undefined || paymentStatus !== undefined || deliveryStatus !== 'REVOKED' ||
        !['PAID','PARTIALLY_REFUNDED'].includes(String(order.paymentStatus).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Only verified paid-order access can be revoked here. Payment status comes from the payment provider.' });
    }

    const updatedOrder = await Store.rpc('revoke_order', `orders/${orderId}`);

    await AuditLogger.log({
      requestId: generateRequestId(),
      userId: req.userId,
      eventType: 'ORDER_UPDATED',
      eventStatus: 'SUCCESS',
      orderId,
      source: 'ADMIN_PANEL',
      metadata: { action: 'REVOKE_DOWNLOAD_ACCESS' },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, order: updatedOrder, message: 'Download access revoked. No refund was initiated.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

// 5. Customers Management
adminRouter.get('/customers', async (req: any, res: Response) => {
  try {
    const users = await Store.getAllUsers();
    const orders = await Store.getAllGlobalOrders();

    const customersWithMetrics = users.map((u: any) => {
      const userOrders = orders.filter((o: any) => o.userId === u.userId);
      const totalSpent = userOrders.reduce(
        (sum: number, o: any) => sum + (hasLivePayment(o) && ['PAID','PARTIALLY_REFUNDED'].includes(String(o.paymentStatus).toUpperCase()) ? Math.max(0,Number(o.total || 0)-Number(o.refundedAmount || 0)) : 0),
        0
      );
      return {
        ...u,
        ordersCount: userOrders.length,
        totalSpent,
      };
    });

    res.json({ success: true, customers: customersWithMetrics });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch customers.' });
  }
});

adminRouter.put('/customers/:userId/status', async (req: any, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    const parsed = z.object({ role: z.enum(['admin','customer']).optional(), blocked: z.boolean().optional() }).strict().safeParse(req.body);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(targetUserId) || !parsed.success) return res.status(400).json({ success: false, message: 'Invalid account update.' });
    const { role, blocked } = parsed.data;
    if (targetUserId === req.userId && (blocked || role === 'customer')) return res.status(400).json({ success: false, message: 'Use another administrator to change your own access.' });
    const profile = await Store.getUserProfile(targetUserId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    if (role) profile.role = role;
    if (blocked !== undefined) { profile.blocked = blocked; profile.status = blocked ? 'suspended' : 'active'; profile.sessionValidAfter = Date.now(); }

    await Store.setUserProfile(targetUserId, profile);
    await AuditLogger.log({ requestId: generateRequestId(), userId: req.userId, eventType: 'ORDER_UPDATED', eventStatus: 'SUCCESS', source: 'ADMIN_PANEL', metadata: { action: 'ACCOUNT_ACCESS_REVIEW', targetUserId, role, blocked } });
    res.json({ success: true, profile, message: 'Customer status updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update customer status.' });
  }
});

// 6. Coupons Management
adminRouter.get('/coupons', async (req: any, res: Response) => {
  try {
    const coupons = await Store.getAllCoupons();
    res.json({ success: true, coupons });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupons.' });
  }
});

adminRouter.post('/coupons', async (req: any, res: Response) => {
  try {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: parsed.error.issues.map(issue => issue.message).join('; '), errors: parsed.error.format() });
    }
    const existing = await Store.getAllCoupons();
    if (existing.some(c => c.id !== parsed.data.id && c.code.toUpperCase() === parsed.data.code.toUpperCase())) return res.status(400).json({ success: false, message: 'Coupon code already exists.' });
    await Store.saveCoupon(parsed.data);
    res.json({ success: true, coupon: parsed.data, message: 'Coupon created successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create coupon.' });
  }
});

adminRouter.delete('/coupons/:id', async (req: any, res: Response) => {
  try {
    await Store.deleteCoupon(req.params.id);
    res.json({ success: true, message: 'Coupon deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to delete coupon.' });
  }
});

// 7. Settings & CMS
adminRouter.get('/settings', async (req: any, res: Response) => {
  try {
    const settings = await Store.getGlobalSettings();
    res.json({ success: true, settings });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
  }
});

adminRouter.put('/settings', async (req: any, res: Response) => {
  try {
    await Store.saveGlobalSettings(req.body);
    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to save settings.' });
  }
});

// 8. CSV Exports
adminRouter.get('/export/orders', async (req: any, res: Response) => {
  try {
    const orders = await Store.getAllGlobalOrders();
    const csvRows = ['Order Number,Invoice Number,Date,Customer Name,Customer Email,Status,Payment Status,Total,Payment Verified At,Delivered At,Email Status'];
    orders.forEach((o: any) => {
      csvRows.push([
        o.orderNumber, o.invoiceNumber, o.date, o.customerName || o.customer?.fullName,
        o.customerEmail || o.customer?.email, o.status, o.paymentStatus, o.total,
        o.paymentVerifiedAt, o.deliveredAt, o.emailDelivery?.status,
      ].map(safeCsvCell).join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=orders_export.csv');
    res.send(csvRows.join('\n'));
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

adminRouter.get('/export/customers', async (req: any, res: Response) => {
  try {
    const users = await Store.getAllUsers();
    const csvRows = ['Name,Email,Mobile,Role,Joined Date'];
    users.forEach((u: any) => {
      csvRows.push([u.name, u.email, u.mobile, u.role || 'customer', u.joinedDate].map(safeCsvCell).join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers_export.csv');
    res.send(csvRows.join('\n'));
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

adminRouter.get('/support-requests', async (_req, res) => {
  try { res.json({ success: true, requests: await Store.get('supportRequests') || {} }); }
  catch { res.status(503).json({ success: false, message: 'Support inbox unavailable.' }); }
});

// Owner-only evidence export. Review necessity and redact before provider submission.
adminRouter.get('/orders/:id/evidence', async (req, res) => {
  const order = await Store.getGlobalOrder(req.params.id);
  if (!order) return res.status(404).json({ success: false });
  const downloads = Object.values(await Store.get<Record<string, any>>('downloadLogs') || {}).filter(row => row.orderId === order.id);
  const events = Object.values(await Store.get<Record<string, any>>('paymentEvents') || {}).filter(row => row.orderId === order.id);
  const evidence = {
    order: { id: order.id, userId: order.userId, customerEmail: order.customerEmail, customerName: order.customerName,
      total: order.total, currency: order.currency, createdAt: order.createdAt, items: order.items,
      paymentStatus: order.paymentStatus, paymentProvider: order.paymentProvider, razorpayOrderId: order.razorpayOrderId, cashfreeOrderId: order.cashfreeOrderId, cfOrderId: order.cfOrderId, paymentId: order.paymentId,
      paymentInitiatedAt: order.paymentInitiatedAt, paymentVerifiedAt: order.paymentVerifiedAt, deliveredAt: order.deliveredAt,
      deliveryStatus: order.deliveryStatus, policyVersion: order.policyVersion, policyAcceptedAt: order.policyAcceptedAt,
      payments: order.payments, paymentHistory: order.paymentHistory, disputes: order.disputes,
      refundedAmount: order.refundedAmount, duplicatePaymentReview: order.duplicatePaymentReview,
      emailDelivery: order.emailDelivery, refundEmailDelivery: order.refundEmailDelivery },
    policiesAccepted: order.policyVersion ? await Store.get(`policyDocuments/${order.policyVersion}`) : null,
    events, downloadAuthorizations: downloads,
    limitations: 'A signed URL authorization does not prove completed download or receipt. Add only necessary, redacted support correspondence separately. This export is not automatically submitted.',
  };
  res.set('Content-Disposition', `attachment; filename="evidence-${order.id}.json"`).json(evidence);
});
adminRouter.post('/orders/:id/restore-access', async (req: any, res) => {
  const parsed = z.object({ reason: z.string().trim().min(10).max(1000) }).safeParse(req.body);
  if (!parsed.success || !await Store.getGlobalOrder(req.params.id)) return res.status(400).json({ success: false, message: 'Valid order and review reason required.' });
  try {
    const order = await Store.rpc('restore_order_access', `orders/${req.params.id}`);
    await AuditLogger.log({ requestId: generateRequestId(), userId: req.userId, orderId: order.id, eventType: 'ORDER_UPDATED', eventStatus: 'SUCCESS', source: 'ADMIN_PANEL', metadata: { action: 'RESTORE_ACCESS_AFTER_REVIEW', reason: parsed.data.reason } });
    res.json({ success: true, order });
  } catch { res.status(409).json({ success: false, message: 'Reconcile first. Refunds, unpaid orders or unresolved disputes cannot be restored here.' }); }
});
adminRouter.get('/audit-logs', async (_req, res) => res.json({ success: true, logs: await AuditLogger.getAllLogs(200) }));
