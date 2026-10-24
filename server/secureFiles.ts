import { sellerSource } from './marketplace';
import crypto from 'crypto';
import { Readable } from 'node:stream';
import { Response as ExpressResponse } from 'express';
import { File as MegaFile } from 'megajs';
import { FirebaseRtdb } from './firebaseRtdb';
import { generateRequestId } from './audit';

export interface DownloadTokenData {
  tokenId: string;
  userId: string;
  productId: string;
  productTitle: string;
  orderId: string;
  purchaseId: string;
  expiresAt: number; // Unix timestamp ms
  used: boolean;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface ProductFileSource {
  stream: Readable;
  contentLength?: number;
}

// In-memory token storage + fallback
const downloadTokens = new Map<string, DownloadTokenData>();

export class SecureFileManager {
  /**
   * Generates a short-lived (15 minute) single-use download token
   */
  public static async generateToken(params: {
    userId: string;
    productId: string;
    productTitle: string;
    orderId: string;
    purchaseId: string;
    requestId?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: number; downloadUrl: string }> {
    const tokenId = `DL-TOK-${crypto.randomBytes(24).toString('base64url')}`;
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins
    const reqId = params.requestId || generateRequestId();

    const data: DownloadTokenData = {
      tokenId,
      userId: params.userId,
      productId: params.productId,
      productTitle: params.productTitle,
      orderId: params.orderId,
      purchaseId: params.purchaseId,
      expiresAt,
      used: false,
      requestId: reqId,
      ip: params.ip,
      userAgent: params.userAgent,
    };

    downloadTokens.set(tokenId, data);
    await FirebaseRtdb.set(`downloadTokens/${tokenId}`, data);

    return {
      token: tokenId,
      expiresAt,
      downloadUrl: `/api/downloads/stream?token=${tokenId}`,
    };
  }

  /**
   * Validates and consumes token, returning token data or error message
   */
  public static async validateAndConsumeToken(tokenId: string): Promise<{ valid: boolean; tokenData?: DownloadTokenData; error?: string }> {
    let data = downloadTokens.get(tokenId);
    if (!data) {
      const remoteData = await FirebaseRtdb.get<DownloadTokenData>(`downloadTokens/${tokenId}`);
      if (remoteData) {
        data = remoteData;
        downloadTokens.set(tokenId, data);
      }
    }

    if (!data) {
      return { valid: false, error: 'Invalid or expired download token.' };
    }

    if (Date.now() > data.expiresAt) {
      return { valid: false, error: 'Download link has expired. Please request a new download link.' };
    }

    if (data.used) {
      return { valid: false, error: 'This download link has already been used. Please request a fresh download link.' };
    }

    // Mark used
    data.used = true;
    downloadTokens.set(tokenId, data);
    await FirebaseRtdb.set(`downloadTokens/${tokenId}`, data);

    return { valid: true, tokenData: data };
  }

  public static getProductDownloadEnvironmentKey(productId: string): string {
    const normalizedId = productId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    return `PRODUCT_DOWNLOAD_URL_${normalizedId}`;
  }

  public static isMegaFileUrl(sourceUrl: URL): boolean {
    return (
      (sourceUrl.hostname === 'mega.nz' || sourceUrl.hostname === 'mega.co.nz') &&
      sourceUrl.pathname.startsWith('/file/')
    );
  }

  private static async verifyZipStream(source: Readable): Promise<Readable> {
    const iterator = source[Symbol.asyncIterator]();
    const chunks: Buffer[] = [];
    let bytesRead = 0;

    while (bytesRead < 4) {
      const result = await iterator.next();
      if (result.done) break;
      const chunk = Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value);
      chunks.push(chunk);
      bytesRead += chunk.length;
    }

    const initialBytes = Buffer.concat(chunks);
    const validSignature =
      initialBytes.length >= 4 &&
      initialBytes[0] === 0x50 &&
      initialBytes[1] === 0x4b &&
      ((initialBytes[2] === 0x03 && initialBytes[3] === 0x04) ||
        (initialBytes[2] === 0x05 && initialBytes[3] === 0x06) ||
        (initialBytes[2] === 0x07 && initialBytes[3] === 0x08));

    if (!validSignature) {
      source.destroy();
      throw new Error('Configured download source is not a valid ZIP file.');
    }

    async function* replay(): AsyncGenerator<Buffer> {
      try {
        yield initialBytes;
        while (true) {
          const result = await iterator.next();
          if (result.done) return;
          yield Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value);
        }
      } finally {
        await iterator.return?.();
      }
    }

    return Readable.from(replay());
  }

  /**
   * Opens and verifies a server-only HTTPS ZIP source. MEGA shared-file URLs
   * are decrypted on the server; no source URL is returned to the browser.
   */
  public static async openProductFile(productId: string): Promise<ProductFileSource> {
    const environmentKey = this.getProductDownloadEnvironmentKey(productId);
    const isSellerFile = productId.startsWith('seller_');
    const configuredUrl = isSellerFile ? await sellerSource(productId) : process.env[environmentKey] || process.env.PRODUCT_DOWNLOAD_URL;

    if (!configuredUrl) {
      throw new Error(`Download source is not configured. Set ${environmentKey} in Vercel.`);
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(configuredUrl);
    } catch {
      throw new Error(`${environmentKey} must contain a valid HTTPS URL.`);
    }

    if (sourceUrl.protocol !== 'https:') {
      throw new Error(`${environmentKey} must use HTTPS.`);
    }

    if (sourceUrl.hostname === 'mega.nz' || sourceUrl.hostname === 'mega.co.nz') {
      if (!this.isMegaFileUrl(sourceUrl) || !sourceUrl.hash) {
        throw new Error(`${environmentKey} must contain a complete MEGA file link, including its key.`);
      }

      const megaFile = MegaFile.fromURL(configuredUrl);
      if (megaFile.directory) {
        throw new Error(`${environmentKey} must point to a MEGA file, not a folder.`);
      }

      await megaFile.loadAttributes();
      const contentLength = megaFile.size;
      if (!Number.isSafeInteger(contentLength) || contentLength! <= 0) {
        throw new Error('Configured MEGA file has an invalid size.');
      }

      return {
        stream: await this.verifyZipStream(megaFile.download({})),
        contentLength,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(sourceUrl, {
        method: 'GET',
        redirect: isSellerFile ? 'error' : 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok || !upstream.body) {
      throw new Error(`Configured download source returned HTTP ${upstream.status}.`);
    }

    const contentLengthHeader = upstream.headers.get('content-length');
    const contentLength = !upstream.headers.has('content-encoding') &&
      contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : undefined;

    return {
      stream: await this.verifyZipStream(Readable.fromWeb(upstream.body as any)),
      contentLength,
    };
  }

  /**
   * Proxies the configured ZIP through the authenticated API response.
   */
  public static streamProductFileToResponse(source: ProductFileSource, filename: string, res: ExpressResponse): void {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    };

    if (Number.isSafeInteger(source.contentLength) && source.contentLength! > 0) {
      headers['Content-Length'] = String(source.contentLength);
    }

    res.writeHead(200, headers);
    source.stream.on('error', (error) => res.destroy(error));
    source.stream.pipe(res);
  }
}
