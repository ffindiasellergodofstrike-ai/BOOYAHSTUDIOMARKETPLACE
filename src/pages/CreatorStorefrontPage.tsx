import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mail, MapPin, Package, Phone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useProductCatalog } from '../hooks/useProductCatalog';
import { ProductCard } from '../components/ProductCard';
import type { Product } from '../types';
import { MarketplaceService, type CreatorCard } from '../services/MarketplaceService';
import { CreatorAvatar, MarketEmpty, MarketError, MarketLoading } from '../components/marketplace/MarketplaceShared';
import { MembershipOffers } from '../components/marketplace/MembershipOffers';

export const CreatorStorefrontPage: React.FC = () => {
  const { currentPath, navigate } = useApp();
  const catalog = useProductCatalog();
  let slug = currentPath.split('/')[2] || 'booyahstudio';
  try { slug = decodeURIComponent(slug); } catch { /* A malformed address should render the normal unavailable state. */ }
  const [creator, setCreator] = useState<CreatorCard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false);
    try { const data = await MarketplaceService.creator(slug); setCreator(data.creator); setProducts(data.products || []); }
    catch (err: any) { setError(err?.status === 404 ? 'This creator page is not available.' : 'We could not refresh this collection. Please try again.'); setMissing(err?.status === 404); setCreator(null); }
    finally { setLoading(false); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);
  const companyFallback = !!error && !missing && slug === 'booyahstudio';
  const profile = companyFallback ? { id: 'booyahstudio', slug, displayName: 'Booyahstudio', headline: 'A better starting point for your next big idea.', bio: 'Original digital products, thoughtfully made by Booyahstudio. Explore our collection of ready-to-use resources and make something your own.', isPlatform: true } as CreatorCard : creator;
  const items = companyFallback ? catalog.filter(p => !p.sellerId || p.sellerId === 'booyahstudio') : products;
  return <main className="market-page"><div className="studio-container">
    <button className="market-breadcrumb" onClick={() => navigate('/creators')}><ArrowLeft size={15}/> All creators</button>
    {loading ? <MarketLoading label="Opening the collection…"/> : <>
      {error && <MarketError message={error} onRetry={missing ? undefined : load}/>}
      {profile && <>
        <section className="storefront-hero"><CreatorAvatar creator={profile} size="large"/><div>{profile.isPlatform && <span className="creator-platform-label">THE STUDIO COLLECTION</span>}<h1>{profile.displayName}</h1><p>{profile.headline}</p>{profile.bio && <p>{profile.bio}</p>}</div></section>
        {profile.publicBusiness && <section className="market-seller-information" aria-labelledby="seller-information-heading"><h2 id="seller-information-heading">Seller information</h2><strong>{profile.publicBusiness.businessName}</strong><address><p><MapPin size={15}/><span>{profile.publicBusiness.businessAddress}</span></p><p><Mail size={15}/><a href={`mailto:${profile.publicBusiness.supportEmail}`}>{profile.publicBusiness.supportEmail}</a></p><p><Phone size={15}/><a href={`tel:${profile.publicBusiness.supportPhone.replace(/[^+0-9]/g, '')}`}>{profile.publicBusiness.supportPhone}</a></p></address><p>Grievance contact: {profile.publicBusiness.grievanceName}, at the support contacts above.</p><p className="market-note">Original work belongs to its publisher. Review each product’s included files, requirements and licence before purchasing. <a href="/policies/terms">Buyer terms</a> · <a href="/policies/refund">Refund & cancellation policy</a></p></section>}
        <div className="market-section-heading"><div><h2>Made for your next move.</h2><p>{items.length} original {items.length === 1 ? 'product' : 'products'} to make a little more possible.</p></div></div>
        {items.length ? <div className="market-product-grid">{items.map(product => <ProductCard key={product.id} product={product}/>)}</div> : <MarketEmpty title="Something good is in the making" description="This creator has not published a product yet. Come back soon for their first collection." icon={Package}/>}
        <MembershipOffers creatorId={profile.id} creatorName={profile.displayName}/>
      </>}
    </>}
  </div></main>;
};
export default CreatorStorefrontPage;
