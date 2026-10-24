import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Save } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MarketplaceService, type CreatorListing, type CreatorWorkspace } from '../services/MarketplaceService';
import { MarketError, MarketLoading, MarketPageHeading, StatusPill } from '../components/marketplace/MarketplaceShared';
import { Notice } from '../components/ui/Notice';

export const CreatorDeliveryPage: React.FC = () => {
  const { isAuthenticated, navigate } = useApp();
  const [workspace, setWorkspace] = useState<CreatorWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    setLoading(true); setError('');
    try { setWorkspace(await MarketplaceService.me()); }
    catch (err: any) { setError(err?.message || 'Delivery links could not be loaded.'); }
    finally { setLoading(false); }
  }, [isAuthenticated]);
  useEffect(() => { void load(); }, [load]);
  const save = async (event: React.FormEvent<HTMLFormElement>, listing: CreatorListing) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const externalFileUrl = String(form.get('externalFileUrl') || '').trim();
    setBusy(listing.id); setMessage('');
    try {
      await MarketplaceService.updateListing(listing.id, { externalFileUrl });
      setMessage(`${listing.title}: external delivery link saved. The product returned to draft for review.`);
      await load();
    } catch (err: any) { setMessage(err?.message || 'The external link could not be saved.'); }
    finally { setBusy(''); }
  };
  const listings = workspace?.products || [];
  return <main className="market-page"><div className="studio-container">
    <button className="market-breadcrumb" onClick={() => navigate('/creator')}><ArrowLeft size={15}/> Creator workspace</button>
    <MarketPageHeading kicker="Product delivery" title="Choose where your files" emphasis="come from." description="Upload a ZIP up to 10 MB to private Supabase Storage, or use an HTTPS direct-download link from Google Drive, Dropbox, or another host. External links are revealed after verified access, but the external host controls privacy and availability." />
    {!isAuthenticated ? <Notice tone="info">Sign in to manage your product delivery links.</Notice> : loading ? <MarketLoading label="Loading your product drafts…"/> : error ? <MarketError message={error} onRetry={() => void load()}/> : <>
      <div className="market-inline-notice"><strong>External links:</strong> use a direct download link you control, with no password, personal information, or misleading redirects. Public links can be forwarded and may be changed or removed by the host. A saved link is reviewed before the product can be published.</div>
      {message && <Notice tone="success">{message}</Notice>}
      {listings.length ? <div className="market-listing-list">{listings.map(listing => <article className="market-listing" key={listing.id}>
        <img className="market-listing-thumb" src={listing.image} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>
        <div className="market-listing-main"><StatusPill value={listing.status}/><h3>{listing.title}</h3><p className="market-note">{listing.file?.uploaded ? 'Private ZIP attached' : 'No private ZIP attached'}{listing.externalFileUrl ? ' · External link saved' : ''}</p>
          <form className="market-form" onSubmit={event => void save(event, listing)}><label className="market-field"><span>Direct HTTPS file link</span><input name="externalFileUrl" type="url" defaultValue={listing.externalFileUrl || ''} placeholder="https://drive.google.com/…" autoComplete="url"/><small>Leave blank to remove the external link. Choose either this link or a private ZIP, not both.</small></label><div className="market-form-actions"><button className="btn btn-primary" type="submit" disabled={busy === listing.id || listing.status === 'pending'}>{busy === listing.id ? 'Saving…' : 'Save delivery link'} <Save size={15}/></button>{listing.externalFileUrl && <a className="text-button" href={listing.externalFileUrl} target="_blank" rel="noopener noreferrer">Preview link <ExternalLink size={14}/></a>}</div></form>
        </div>
      </article>)}</div> : <div className="market-empty"><h2>No products yet</h2><p>Create a product draft in your creator workspace before setting up its delivery.</p><button className="btn btn-primary" onClick={() => navigate('/creator')}>Open creator workspace</button></div>}
    </>}
  </div></main>;
};
export default CreatorDeliveryPage;
