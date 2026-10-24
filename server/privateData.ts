import crypto from 'node:crypto';
function key(): Buffer {
  const raw = process.env.MARKETPLACE_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('Private seller information is unavailable until encryption is configured.');
  return key;
}
export function seal(value: unknown, purpose: string): string {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(v=>v.toString('base64url')).join('.');
}
export function unseal<T>(value: string, purpose: string): T {
  const parts = value.split('.').map(v=>Buffer.from(v,'base64url'));
  if(parts.length!==3) throw new Error('Invalid encrypted record');
  const decipher = crypto.createDecipheriv('aes-256-gcm',key(),parts[0]);
  decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(parts[1]);
  return JSON.parse(Buffer.concat([decipher.update(parts[2]),decipher.final()]).toString('utf8'));
}
export function privateFingerprint(value: string): string {return crypto.createHmac('sha256',key()).update(value).digest('hex');}
