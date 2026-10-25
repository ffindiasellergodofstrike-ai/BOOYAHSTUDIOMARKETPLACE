import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
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
    const sourceUrl = String(form.get('sourceUrl') || '').trim();
    if (!sourceUrl) { setMessage('Enter a direct HTTPS ZIP download link.'); return; }
    setBusy(listing.id); setMessage('');
    try {
      await MarketplaceService.importListing(listing.id, sourceUrl);
      setMessage(`${listing.title}: ZIP imported into private Storage. Submit the draft for review before selling.`);
      await load();
    } catch (err: any) { setMessage(err?.message || 'The ZIP could not be imported. Try uploading the file from your creator workspace.'); }
    finally { setBusy(''); }
  };
  const listings = workspace?.products || [];
  return <main className="market-page"><div className="studio-container">
    <button className="market-breadcrumb" onClick={() => navigate('/creator')}><ArrowLeft size={15}/> Creator workspace</button>
    <MarketPageHeading kicker="Product delivery" title="Choose where your files" emphasis="come from." description="Upload a ZIP up to 10 MB in your creator workspace, or import a direct HTTPS ZIP link into private Supabase Storage. Buyers receive protected access to the approved private copy." />
    {!isAuthenticated ? <Notice tone="info">Sign in to manage your product delivery links.</Notice> : loading ? <MarketLoading label="Loading your product drafts…"/> : error ? <MarketError message={error} onRetry={() => void load()}/> : <>
      <div className="market-inline-notice"><strong>Private file import:</strong> the link must return the ZIP directly, without a share page, redirects, sign-in or a password. Files over 10 MB and unsafe destinations are rejected. The ZIP is copied into the private products bucket and requires review.</div>
      {message && <Notice tone="success">{message}</Notice>}
      {listings.length ? <div className="market-listing-list">{listings.map(listing => <article className="market-listing" key={listing.id}>
        <img className="market-listing-thumb" src={listing.image} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>
        <div className="market-listing-main"><StatusPill value={listing.status}/><h3>{listing.title}</h3><p className="market-note">{listing.file?.uploaded ? 'File attached · review required before sale' : 'No private ZIP attached'}</p>
          {(listing.status === 'pending' || listing.file?.published) ? <p className="market-note">This file is under review or already published. Keep valid purchases accessible; create a new product draft for a different archive.</p> : <form className="market-form" onSubmit={event => void save(event, listing)}><label className="market-field"><span>Direct HTTPS ZIP download link</span><input name="sourceUrl" type="url" required placeholder="https://your-host.example/product.zip" autoComplete="off"/><small>Share-page links do not work. You can always upload the ZIP directly from your creator workspace.</small></label><div className="market-form-actions"><button className="btn btn-primary" type="submit" disabled={busy === listing.id}>{busy === listing.id ? 'Importing private ZIP…' : 'Import ZIP privately'} <Download size={15}/></button></div></form>}
        </div>
      </article>)}</div> : <div className="market-empty"><h2>No products yet</h2><p>Create a product draft in your creator workspace before setting up its delivery.</p><button className="btn btn-primary" onClick={() => navigate('/creator')}>Open creator workspace</button></div>}
    </>}
  </div></main>;
};
export default CreatorDeliveryPage;
