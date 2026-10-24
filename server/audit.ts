import { Store } from './store';

export type AuditEventType =
  | 'USER_REGISTERED'
  | 'USER_LOGIN_SUCCESS'
  | 'USER_LOGIN_FAILED'
  | 'USER_LOGOUT'
  | 'PRODUCT_VIEWED'
  | 'PRODUCT_CHECKOUT_STARTED'
  | 'CHECKOUT_STARTED'
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ORDER_CANCELLED'
  | 'ORDER_PAYMENT_VERIFIED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_REDIRECTED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_VERIFICATION_STARTED'
  | 'PAYMENT_VERIFICATION_SUCCESS'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'WEBHOOK_RECEIVED'
  | 'WEBHOOK_VERIFICATION_SUCCESS'
  | 'WEBHOOK_VERIFICATION_FAILED'
  | 'WEBHOOK_DUPLICATE'
  | 'PURCHASE_ACCESS_GRANTED'
  | 'PRODUCT_ACCESS_GRANTED'
  | 'PURCHASE_ACCESS_DENIED'
  | 'DOWNLOAD_PAGE_OPENED'
  | 'DOWNLOAD_AUTHORIZED'
  | 'DOWNLOAD_DENIED'
  | 'DOWNLOAD_STARTED'
  | 'DOWNLOAD_COMPLETED'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_LIMIT_REACHED'
  | 'REFUND_REQUESTED'
  | 'REFUND_PROCESSED'
  | 'ORDER_REFUNDED'
  | 'SYSTEM_ERROR'
  | 'API_ERROR';

export type AuditEventStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'WARNING' | 'DENIED';

export interface AuditLogEntry {
  logId: string;
  userId: string;
  sessionId?: string;
  eventType: AuditEventType;
  eventStatus: AuditEventStatus;
  orderId?: string | null;
  productId?: string | null;
  paymentId?: string | null;
  requestId: string;
  timestamp: string;
  source: string;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

const SENSITIVE_KEY_PATTERNS = [
  'otp',
  'upipin',
  'password',
  'passwordhash',
  'confirmpassword',
  'cardnumber',
  'cardcvc',
  'cvv',
  'secret',
  'token',
  'authorization',
  'jwt',
  'signature',
  'apikey',
  'privatekey',
  'bearer',
  'cookie',
  'authheader',
  'adminkey',
];

export function sanitizeMetadata(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeMetadata(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));

    if (isSensitive) {
      sanitized[key] = '[REDACTED_SENSITIVE_DATA]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeMetadata(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

export function generateRequestId(): string {
  const randHex = Math.random().toString(16).substring(2, 8).toUpperCase();
  const timeHex = Date.now().toString(36).toUpperCase();
  return `REQ-${timeHex}-${randHex}`;
}

export class AuditLogger {
  public static async log(entry: Omit<AuditLogEntry, 'logId' | 'timestamp'>): Promise<AuditLogEntry> {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = new Date().toISOString();

    const fullEntry: AuditLogEntry = {
      logId,
      timestamp,
      userId: entry.userId || 'anonymous',
      sessionId: entry.sessionId || 'session_default',
      eventType: entry.eventType,
      eventStatus: entry.eventStatus,
      orderId: entry.orderId || null,
      productId: entry.productId || null,
      paymentId: entry.paymentId || null,
      requestId: entry.requestId || generateRequestId(),
      source: entry.source || 'SERVER',
      errorCode: entry.errorCode || null,
      errorMessageSafe: entry.errorMessageSafe || null,
      metadata: sanitizeMetadata(entry.metadata || {}),
      ip: entry.ip || '0.0.0.0',
      userAgent: entry.userAgent || 'system',
    };

    // 1. Save to central auditLogs/{logId} in Supabase
    await Store.set(`auditLogs/${logId}`, fullEntry);

    // 2. If orderId is present, also append to orderAuditIndex/{orderId}/{logId} for quick timeline reconstruction
    if (fullEntry.orderId) {
      await Store.set(`orderAuditIndex/${fullEntry.orderId}/${logId}`, fullEntry);
    }

    // 3. Save to user activity log if logged-in user
    if (fullEntry.userId && fullEntry.userId !== 'anonymous') {
      const activityId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const userActivity = {
        activityId,
        eventType: fullEntry.eventType,
        eventStatus: fullEntry.eventStatus,
        orderId: fullEntry.orderId,
        productId: fullEntry.productId,
        requestId: fullEntry.requestId,
        timestamp: fullEntry.timestamp,
        description: `${fullEntry.eventType.replace(/_/g, ' ')} (${fullEntry.eventStatus})`,
      };
      await Store.set(`users/${fullEntry.userId}/activity/${activityId}`, userActivity);
    }

    return fullEntry;
  }

  public static async getLogsForOrder(orderId: string): Promise<AuditLogEntry[]> {
    const data = await Store.get<Record<string, AuditLogEntry>>(`orderAuditIndex/${orderId}`);
    if (!data) {
      // Fallback: query all audit logs
      const all = await Store.get<Record<string, AuditLogEntry>>('auditLogs');
      if (!all) return [];
      return Object.values(all)
        .filter((l) => l.orderId === orderId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    return Object.values(data).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  public static async getAllLogs(limit = 100): Promise<AuditLogEntry[]> {
    const data = await Store.get<Record<string, AuditLogEntry>>('auditLogs');
    if (!data) return [];
    const list = Object.values(data);
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  }
}
