import serverless from 'serverless-http';
import { isIP } from 'node:net';

export interface NetlifyEvent {
  path?: string;
  rawPath?: string;
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer | null;
  isBase64Encoded?: boolean;
  [key: string]: any;
}
export interface NetlifyResult {
  statusCode: number;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  isBase64Encoded?: boolean;
  body: string;
}
const prefix = '/.netlify/functions/api';
const route = (path = '/') => path === prefix ? '/' : path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;

/** Netlify's event is the original request, not a parsed/re-serialized JSON body. */
export function createNetlifyHandler(app: serverless.Application) {
  const handler = serverless(app, { binary: ['application/pdf', 'application/octet-stream', 'image/*'] });
  return async (input: NetlifyEvent, context: Record<string, any> = {}): Promise<NetlifyResult> => {
    const headers = { ...input.headers };
    const suppliedIp = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-nf-client-connection-ip')?.[1];
    // Only the Netlify-specific edge header is used, never a customer X-Forwarded-For value.
    const sourceIp = suppliedIp && isIP(suppliedIp) ? suppliedIp :
      isIP(String(input.requestContext?.identity?.sourceIp || '')) ? input.requestContext.identity.sourceIp : '0.0.0.0';
    const event = {
      ...input, path: route(input.path), rawPath: input.rawPath ? route(input.rawPath) : undefined,
      requestPath: typeof input.requestPath === 'string' ? route(input.requestPath) : undefined,
      // No JSON normalization: signature verification receives exactly the provider's UTF-8/base64 bytes.
      body: input.body ?? '', headers,
      queryStringParameters: { ...input.queryStringParameters },
      multiValueQueryStringParameters: input.multiValueQueryStringParameters ? Object.fromEntries(
        Object.entries(input.multiValueQueryStringParameters).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) : undefined,
      requestContext: { ...input.requestContext, identity: { ...input.requestContext?.identity, sourceIp } },
    };
    const result = await handler(event, context) as NetlifyResult;
    // Dynamic HTML is also reachable through the direct function URL. Preserve
    // the private-page cache boundary even when CDN redirect headers do not run.
    if (/text\/html/i.test(result.headers?.['content-type'] || '')) {
      result.headers = { ...result.headers, 'cache-control': 'private, no-store' };
    }
    return result;
  };
}

/** Background work uses the same protected application endpoint in-process, outside the 60s HTTP window. */
export async function runNetlifyReconciliation(handler: ReturnType<typeof createNetlifyHandler>, input: NetlifyEvent, context: Record<string, any> = {}) {
  const headers = input.headers || {};
  const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return { authorized: false, completed: false };
  const result = await handler({ path: '/api/jobs/reconcile', httpMethod: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{}', isBase64Encoded: false }, context);
  let body: any;
  try { body = JSON.parse(result.body); } catch { throw new Error('Reconciliation returned an invalid response.'); }
  if (result.statusCode !== 200 || body?.success !== true) throw new Error('Reconciliation did not complete. Check the private operation logs.');
  return { authorized: true, completed: true, status: body.status || 'completed' };
}
