import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useProductCatalog } from '../hooks/useProductCatalog';
import { MarketplaceService, type CreatorCard } from '../services/MarketplaceService';
import { CreatorProfileCard, MarketEmpty, MarketError, MarketLoading, MarketPageHeading } from '../components/marketplace/MarketplaceShared';

export const CreatorDirectoryPage: React.FC = () => {
  const { navigate } = useApp();
  const catalog = useProductCatalog();
  const [creators, setCreators] = useState<CreatorCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await MarketplaceService.creators(); setCreators(data.creators || []); }
    catch { setError('The creator directory is taking a moment. You can still explore our studio collection.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const company: CreatorCard = { id: 'booyahstudio', slug: 'booyahstudio', displayName: 'Booyahstudio', headline: 'Thoughtfully made digital products for your next big idea.', isPlatform: true, productCount: catalog.filter(p => !p.sellerId || p.sellerId === 'booyahstudio').length };
  const visible = useMemo(() => (error ? [company] : creators).filter(c => `${c.displayName} ${c.headline || ''} ${c.bio || ''}`.toLowerCase().includes(query.toLowerCase().trim())), [creators, query, error, company.productCount]);
  return <main className="market-page"><div className="studio-container">
    <MarketPageHeading kicker="Independent ideas. Shared possibilities." title="Good things, made" emphasis="by creative people." description="Discover digital products from the people who make them. Find a useful starting point, a fresh perspective, or your next favourite creator.">
      <button className="btn btn-secondary" onClick={() => navigate('/creator')}>Start creating <ArrowRight size={16}/></button>
    </MarketPageHeading>
    <div className="market-toolbar"><label className="market-search"><Search size={19}/><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a creator or an idea" aria-label="Search creators"/></label><span className="market-count">{!loading && `${visible.length} ${visible.length === 1 ? 'creator' : 'creators'} to explore`}</span></div>
    {loading ? <MarketLoading label="Finding your next favourite creator…"/> : <>
      {error && <MarketError message={error} onRetry={load}/>}
      {visible.length ? <div className="creator-grid">{visible.map(creator => <CreatorProfileCard key={creator.id} creator={creator}/>)}</div> : <MarketEmpty title={query ? 'No creators found' : 'A fresh space for fresh ideas'} description={query ? 'Try a different name or a broader search.' : 'Our creator community is just getting started. Have something useful to share? Make yourself at home.'} icon={Sparkles} action={query ? 'Clear search' : 'Become a creator'} onAction={() => query ? setQuery('') : navigate('/creator')}/>}
    </>}
    <div className="market-inline-notice">Every product has a creator behind it. Explore their story, see what is included, and choose the right fit before you buy.</div>
  </div></main>;
};
export default CreatorDirectoryPage;
