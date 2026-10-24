import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { AdminService } from '../../services/AdminService';
import { adminButton, adminDate, adminInput } from './AdminManagementShared';

export function AdminProductFileUpload({ productId, isNew }: { productId: string; isNew: boolean }) {
  const [metadata, setMetadata] = useState<any>(null);
  const [maxSizeBytes, setMaxSizeBytes] = useState(50 * 1024 * 1024);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [replace, setReplace] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    if (isNew) return;
    setChecking(true); setError('');
    try { const result = await AdminService.getProductFile(productId); setMetadata(result.file); if (Number.isSafeInteger(result.maxSizeBytes) && result.maxSizeBytes > 0) setMaxSizeBytes(result.maxSizeBytes); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not inspect the private product file.'); }
    finally { setChecking(false); }
  }, [productId, isNew]);
  useEffect(() => { void load(); return () => { controller.current?.abort(); }; }, [load]);
  const upload = async () => {
    if (!archive || !metadata || !reviewed || reason.trim().length < 10 || (metadata.exists && !replace)) return;
    setBusy(true); setError(''); setMessage('Preparing private upload…');
    controller.current = new AbortController();
    try {
      if (!archive.name.toLowerCase().endsWith('.zip')) throw new Error('Choose a ZIP archive.');
      if (archive.size < 22 || archive.size > maxSizeBytes) throw new Error(`Choose a valid ZIP up to ${Math.floor(maxSizeBytes / (1024 * 1024))}MB.`);
      const header = new Uint8Array(await archive.slice(0, 4).arrayBuffer());
      if (header.length < 4 || header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 3 || header[3] !== 4) throw new Error('Choose a non-empty ZIP archive with a valid ZIP header.');
      const prepared = await AdminService.prepareProductFileUpload(productId, { fileName: archive.name, size: archive.size, reviewed: true, replaceExisting: replace, reason: reason.trim() });
      if (controller.current.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const form = new FormData(); form.append('cacheControl', '0'); form.append('', archive, archive.name);
      setMessage('Uploading directly to private storage…');
      const response = await fetch(prepared.upload.signedUrl, { method: 'PUT', body: form, credentials: 'omit', signal: controller.current.signal });
      if (!response.ok) throw new Error('Private storage did not accept the file. Check your connection and retry.');
      setMessage('Verifying and publishing the private ZIP…');
      await AdminService.completeProductFileUpload(productId, { uploadId: prepared.upload.uploadId, reviewed: true, reason: reason.trim() });
      setMessage('Private product ZIP is ready. Future verified downloads use this file.');
      setArchive(null); setReviewed(false); setReplace(false); setReason(''); if (input.current) input.current.value = '';
      await load();
    } catch (failure) {
      setMessage('');
      setError(failure instanceof Error && failure.name === 'AbortError' ? 'Upload cancelled. The product file was not published.' : failure instanceof Error ? failure.message : 'Could not upload this product file.');
    } finally { setBusy(false); controller.current = null; }
  };
  return <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
    <h4 className="font-semibold text-sm">Private downloadable ZIP</h4>
    {isNew ? <p className="text-xs text-slate-500">Save this product first, then reopen Edit Product to upload its private ZIP.</p> : <>
      {checking && <p className="flex gap-2 items-center text-xs text-slate-500"><Loader2 className="w-3 h-3 animate-spin" />Checking private storage…</p>}
      {metadata && <p className="text-xs text-slate-500">{metadata.exists ? `Ready: ${metadata.path || `${productId}.zip`} · ${Number(metadata.size || 0).toLocaleString()} bytes · updated ${adminDate(metadata.updatedAt)}` : `No private file uploaded for ${productId}.zip yet.`}</p>}
      {error && <p className="text-sm text-rose-600" role="alert">{error} {!busy && <button type="button" onClick={load} className="underline">Recheck storage</button>}</p>}
      <label className="block text-sm">ZIP archive<input ref={input} type="file" accept=".zip,application/zip,application/x-zip-compressed" disabled={busy || checking || !metadata} onChange={e => { setArchive(e.target.files?.[0] || null); setMessage(''); }} className="block w-full text-xs mt-2" /></label>
      {archive && <><label className="block text-sm">Upload/replacement reason<textarea rows={2} maxLength={1000} minLength={10} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe this product file or version update (at least 10 characters)" className={`${adminInput} mt-1`} /></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} className="mt-0.5" /><span>I reviewed this archive and confirm it matches the product description and license.</span></label>{metadata?.exists && <label className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"><input type="checkbox" checked={replace} disabled={busy} onChange={e => setReplace(e.target.checked)} className="mt-0.5" /><span>Replace the existing private ZIP. Existing buyers' future downloads will receive this version.</span></label>}<button type="button" onClick={upload} disabled={busy || checking || !metadata || !reviewed || reason.trim().length < 10 || (metadata.exists && !replace)} className={adminButton}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{busy ? 'Uploading…' : metadata?.exists ? 'Replace private ZIP' : 'Upload private ZIP'}</button></>}
      {message && <p className="text-xs text-blue-600 dark:text-blue-300" role="status">{message}</p>}
      <p className="text-xs text-slate-500">ZIP limit: {Math.floor(maxSizeBytes / (1024 * 1024))}MB. File bytes go directly to private Supabase Storage. The server checks the staged archive before making it available to buyers.</p>
    </>}
  </section>;
}
