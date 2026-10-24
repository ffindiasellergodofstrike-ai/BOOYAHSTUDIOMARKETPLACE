/** Leave room for multipart fields below Vercel's 4.5 MB function request cap.
 * Paid ZIPs upload directly to private Storage, never through this proxy limit.
 */
export const PROXIED_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
export const PROXIED_UPLOAD_LIMIT_LABEL = '4 MB';
