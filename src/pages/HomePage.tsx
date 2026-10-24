import React, { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Code2, Download, Layers3, LayoutGrid, LifeBuoy, Search, Sparkles, X } from 'lucide-react';
import { ProductCard } from '../components/ProductCard';
import { useProductCatalog } from '../hooks/useProductCatalog';
import { useApp } from '../context/AppContext';

const collections = [
  { label: 'All templates', query: '' },
  { label: 'Original collection', query: 'original collection' },
  { label: 'Portfolios', query: 'portfolio' },
  { label: 'Productivity', query: 'productivity' },
  { label: 'SaaS & AI', query: 'saas' },
  { label: 'E-commerce', query: 'e-commerce' },
  { label: 'Education', query: 'education' },
  { label: 'Digital resources', query: 'template' },
];

export const HomePage: React.FC = () => {
  const products = useProductCatalog();
  const { navigate } = useApp();
  const [collection, setCollection] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('featured');
  const visibleProducts = useMemo(() => {
    const result = products.filter(product => {
      const text = `${product.title} ${product.shortDescription} ${product.tags.join(' ')}`.toLowerCase();
      return text.includes(collection) && text.includes(query.toLowerCase().trim());
    });
    if (sort === 'price-low') result.sort((a, b) => a.price - b.price);
    if (sort === 'price-high') result.sort((a, b) => b.price - a.price);
    return result;
  }, [products, collection, query, sort]);
  const featured = products.find(product => product.id === 'signal-deck') || products[0];
  const secondary = products.find(product => product.id === 'margin-portfolio') || products[1];
  const browse = () => document.getElementById('collection')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });

  return (
    <div className="studio-home">
      <section className="studio-hero studio-container">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> SMALL DETAILS. BIG POSSIBILITIES.</div>
          <h1>Your next big idea.<br />A better<br /><span>head start.</span><Sparkles className="heading-spark" aria-hidden="true" /></h1>
          <p>Discover thoughtful templates and digital goods from independent creators. Find your next starting point—or share something you’ve made.</p>
          <div className="hero-buttons"><button className="studio-button primary" onClick={browse}>Explore the collection <ArrowUpRight size={18} /></button><button className="text-button" onClick={() => navigate('/creators')}>Meet the creators <ArrowRight size={16} /></button></div>
          <div className="hero-checks"><span><Check size={14} /> Full source code</span><span><Check size={14} /> One-time purchase</span><span><Check size={14} /> Make it yours</span></div>
        </div>
        <div className="hero-showcase">
          {featured && <button className="market-featured-image" onClick={() => navigate('/product/:slug', { slug: featured.slug })} aria-label={`Explore ${featured.title}`}><img src={featured.image} alt={`${featured.title} preview`} fetchPriority="high" /><span className="market-featured-label">Featured this week <ArrowUpRight size={15}/></span></button>}
          <div className="market-featured-copy"><div><span className="eyebrow">A GOOD PLACE TO BEGIN</span><strong>{featured?.title.split(' — ')[0] || 'Find your next idea'}</strong><span>{featured ? `₹${featured.price.toLocaleString('en-IN')} · Instant digital delivery` : 'Explore original digital products'}</span></div>{secondary && <button className="market-secondary-pick" onClick={() => navigate('/product/:slug', { slug: secondary.slug })} aria-label={`Explore ${secondary.title}`}><img src={secondary.image} alt=""/><span><small>ALSO WORTH A LOOK</small><strong>{secondary.title.split(' — ')[0]}</strong></span><ArrowUpRight size={17}/></button>}</div>
        </div>
      </section>

      <section className="benefit-strip" aria-label="What comes with your template"><div className="studio-container benefit-inner">{[[Code2, 'Your code. Your creative freedom.'], [Download, 'Your files, in your account.'], [Layers3, 'A foundation you can build on.'], [LifeBuoy, 'A little help along the way.']].map(([Icon, label]) => { const BenefitIcon = Icon as typeof Code2; return <div key={String(label)}><BenefitIcon size={19} /><span>{String(label)}</span></div>; })}</div></section>

      <section className="studio-container collection-section" id="collection">
        <div className="section-heading"><div><div className="eyebrow">THE COLLECTION</div><h2>Good things start here<span>.</span></h2><p>Find the right foundation for whatever you’re building next.</p></div><button className="text-button" onClick={() => navigate('/products')}>View all products <ArrowUpRight size={17} /></button></div>
        <div className="collection-toolbar"><div className="collection-tabs" role="group" aria-label="Filter templates">{collections.map(item => <button key={item.label} onClick={() => setCollection(item.query)} aria-pressed={collection === item.query} className={collection === item.query ? 'active' : ''}>{item.query === '' && <LayoutGrid size={14} />}{item.label}</button>)}</div><div className="collection-search"><Search size={16} /><input type="search" aria-label="Search the collection" placeholder="Find your next idea…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</div></div>
        <div className="collection-meta"><span role="status">{visibleProducts.length} thoughtfully crafted {visibleProducts.length === 1 ? 'product' : 'products'}</span><label>Sort by: <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort products"><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label></div>
        {visibleProducts.length ? <div className="studio-product-grid">{visibleProducts.map(product => <ProductCard key={product.id} product={product} />)}</div> : <div className="collection-empty"><Search size={30} /><h3>No templates found</h3><p>Try a different search or explore the full collection.</p><button className="studio-button primary" onClick={() => { setQuery(''); setCollection(''); }}>Reset filters <ArrowRight size={16} /></button></div>}
        <div className="collection-footnote"><span><Code2 size={15} /> Beautiful on the outside. Flexible on the inside.</span><span>Made for makers, creators & ambitious ideas.</span></div>
      </section>

      <section className="studio-container how-section" aria-labelledby="how-heading">
        <div className="section-heading"><div><div className="eyebrow">FROM IDEA TO SOMETHING REAL</div><h2 id="how-heading">A little less starting from scratch<span>.</span></h2><p>Find your fit. Add your own touch. Build what’s next.</p></div></div>
        <div className="how-grid">{[
          ['01', 'Find your starting point', 'Browse the collection and explore a live demo to see what feels right for your project.'],
          ['02', 'Make it yours', 'Choose your template and complete checkout. Your purchase details stay together in your account.'],
          ['03', 'Download & start creating', 'Once payment is confirmed, download your files from your account and follow the included instructions.'],
        ].map(([step, title, description]) => <article className="how-card" key={step}><span>{step}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className="studio-container"><div className="studio-callout"><div className="callout-icon"><Sparkles size={30} /></div><div><div className="eyebrow">MADE SOMETHING WORTH SHARING?</div><h2>Your craft.<br />Your own little corner.</h2><p>Create your storefront, publish digital products, and offer memberships to your community.</p></div><button className="studio-button light" onClick={() => navigate('/creator')}>Start creating <ArrowUpRight size={18} /></button><span className="callout-decoration" aria-hidden="true">✳</span></div></section>
    </div>
  );
};
