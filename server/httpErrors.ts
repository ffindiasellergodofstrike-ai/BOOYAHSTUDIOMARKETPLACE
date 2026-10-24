import crypto from 'node:crypto';
import type { ErrorRequestHandler } from 'express';

/** Preserve actionable client errors; never leak provider messages, SQL or secrets. */
export const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return _next(error);
  const requestId = crypto.randomUUID();
  const tooLarge = error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE';
  const invalidBody = error?.type === 'entity.parse.failed' || error?.type === 'request.aborted' || error?.type === 'entity.verify.failed';
  const invalidUpload = typeof error?.code === 'string' && error.code.startsWith('LIMIT_');
  const status = tooLarge ? 413 : invalidBody || invalidUpload ? 400 : 503;
  const message = tooLarge ? 'The upload or request is too large. Use the size shown by the form; large product ZIPs must upload directly to private Storage.'
    : invalidBody ? 'The request body is invalid or incomplete. Refresh and try again.'
    : invalidUpload ? 'The uploaded form has invalid fields or too many files.'
    : 'Service temporarily unavailable. Please retry or contact support with this reference.';
  // Query strings, headers, user input and exception messages can contain secrets.
  // Emit only a bounded route category and correlation reference to runtime logs.
  console.error(JSON.stringify({ event: 'API_REQUEST_FAILED', requestId, status, method: req.method,
    route: req.path.startsWith('/api/') ? '/api/' : 'page', errorType: tooLarge ? 'PAYLOAD_TOO_LARGE' : invalidBody || invalidUpload ? 'INVALID_BODY' : 'SERVICE_ERROR' }));
  res.status(status).set('Cache-Control', 'private, no-store').set('X-Request-ID', requestId).json({ success: false, message, requestId });
};
