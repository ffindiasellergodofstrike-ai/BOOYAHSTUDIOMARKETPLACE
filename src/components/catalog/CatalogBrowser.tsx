import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductService, ProductFilters } from '../../services/ProductService';
import { useProductCatalog } from '../../hooks/useProductCatalog';
import { useCatalogRefresh } from '../../hooks/useCatalogRefresh';
import { ProductGrid } from '../ProductGrid';
import '../../styles/catalog.css';

export function CatalogBrowser({ searchMode = false }: { searchMode?: boolean }) {
  const catalog = useProductCatalog();
  const { refreshing, unavailable, retry } = useCatalogRefresh();
  const { searchParams, navigate } = useApp();
  const [query, setQuery] = useState(searchParams.q || '');
  const [category, setCategory] = useState(searchParams.category || 'all');
  const [tag, setTag] = useState(searchParams.tag || '');
  const [priceLimit, setPriceLimit] = useState<number | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<NonNullable<ProductFilters['sortBy']>>('popular');
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { setQuery(searchParams.q || ''); }, [searchParams.q]);
  useEffect(() => { setCategory(searchParams.category || 'all'); }, [searchParams.category]);
  useEffect(() => { setTag(searchParams.tag || ''); }, [searchParams.tag]);
  const categories = useMemo(() => {
    const map = new Map<string, { slug: string; label: string; count: number }>();
    for (const product of catalog) {
      const current = map.get(product.category);
      if (current) current.count++;
      else map.set(product.category, { slug: product.category, label: product.categoryLabel || product.category, count: 1 });
    }
    return [...map.values()];
  }, [catalog]);
  const tags = useMemo(() => [...new Set(catalog.flatMap(product => product.tags || []))], [catalog]);
  const ceiling = Math.max(100, Math.ceil(Math.max(0, ...catalog.map(product => product.price)) / 100) * 100);
  const hasRatings = catalog.some(product => Number(product.rating) > 0);
  const filters: ProductFilters = { query: query.trim() || undefined, category: category === 'all' ? undefined : category, tag: tag || undefined, maxPrice: priceLimit ?? undefined, minRating: minRating || undefined, sortBy: sort };
  const { products, total } = ProductService.searchProducts(filters);
  const activeCount = Number(category !== 'all') + Number(Boolean(tag)) + Number(priceLimit !== null) + Number(minRating > 0);
  const reset = () => { setQuery(''); setCategory('all'); setTag(''); setPriceLimit(null); setMinRating(0); setSort('popular'); if (searchMode) navigate('/search'); };
  function submit(event: React.FormEvent) { event.preventDefault(); if (searchMode) navigate('/search', undefined, query.trim() ? { q: query.trim() } : {}); }
  return <div className="catalog-page studio-container">
    <header className="catalog-heading"><div><p className="catalog-kicker">{searchMode ? 'FIND YOUR NEXT START' : 'THE BOOYAHSTUDIO COLLECTION'}</p><h1>{searchMode ? <>A good idea starts<br />with a <em>little exploring.</em></> : <>Made for your<br /><em>next big idea.</em></>}</h1><p>{searchMode ? 'Search the collection. Find something you can make your own.' : 'Thoughtful templates and digital tools, ready for your personal touch. Explore the details, try a demo, and find your fit.'}</p></div><div className="catalog-heading-note"><span><Check size={17} />One-time purchase</span><span><Check size={17} />Editable source files</span><button type="button" onClick={() => navigate('/faq')}>Have a question? <ArrowUpRight size={16} /></button></div></header>
    <form className="catalog-search-form" onSubmit={submit} role="search"><Search size={21} aria-hidden="true" /><label className="sr-only" htmlFor="catalog-search">Search products</label><input id="catalog-search" type="search" autoComplete="off" placeholder="Search templates, styles or technologies…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="catalog-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={19} /></button>}<button type="submit" className="catalog-primary">Search<ArrowUpRight size={17} /></button></form>
    {searchMode && <div className="catalog-suggestions"><span>A few places to start</span>{tags.slice(0, 5).map(item => <button key={item} type="button" onClick={() => { setQuery(item); navigate('/search', undefined, { q: item }); }}>{item}</button>)}</div>}
    <div className="catalog-mobile-toolbar"><button id="mobile-filter-btn" type="button" className="catalog-filter-toggle" aria-expanded={filtersOpen} aria-controls="catalog-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={17} />{filtersOpen ? 'Hide filters' : 'Filter collection'}{activeCount > 0 && <span>{activeCount}</span>}</button>{refreshing && <span className="catalog-refresh" role="status"><i />Refreshing collection</span>}</div>
    <div className="catalog-browse-layout"><aside id="catalog-filters" className={`catalog-filter-panel ${filtersOpen ? 'is-open' : ''}`}><div className="catalog-filter-title"><h2><Filter size={17} />A little more specific</h2>{activeCount > 0 && <button type="button" onClick={reset}>Reset</button>}</div><fieldset><legend>Collection</legend><button type="button" className={category === 'all' ? 'is-active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}><span>All products</span><span>{catalog.length}</span></button>{categories.map(item => <button key={item.slug} type="button" className={category === item.slug ? 'is-active' : ''} aria-pressed={category === item.slug} onClick={() => setCategory(item.slug)}><span>{item.label}</span><span>{item.count}</span></button>)}</fieldset><fieldset><legend>Your budget</legend><div className="catalog-price-value">{priceLimit === null ? 'Any price' : `Up to ₹${priceLimit.toLocaleString('en-IN')}`}</div><input aria-label="Maximum product price" type="range" min={0} max={ceiling} step={10} value={priceLimit ?? ceiling} onChange={event => { const value = Number(event.target.value); setPriceLimit(value >= ceiling ? null : value); }} /><div className="catalog-range-label"><span>₹0</span><span>₹{ceiling.toLocaleString('en-IN')}+</span></div></fieldset>{hasRatings && <fieldset><legend>Minimum rating</legend><select aria-label="Minimum rating" value={minRating} onChange={event => setMinRating(Number(event.target.value))}><option value={0}>Any rating</option><option value={4.5}>4.5 stars & up</option><option value={4.8}>4.8 stars & up</option></select></fieldset>}<fieldset><legend>Made with</legend><div className="catalog-filter-tags">{tags.slice(0, 16).map(item => <button key={item} type="button" aria-pressed={tag === item} className={tag === item ? 'is-active' : ''} onClick={() => setTag(tag === item ? '' : item)}>{item}</button>)}</div></fieldset><p className="catalog-filter-help">Take your time. Every listing includes its details, license and a preview where available.</p></aside><section className="catalog-result-area" aria-label="Product results">{activeCount > 0 && <div className="catalog-active-filters">{category !== 'all' && <button type="button" onClick={() => setCategory('all')}>{categories.find(item => item.slug === category)?.label || category}<X size={13} /></button>}{tag && <button type="button" onClick={() => setTag('')}>{tag}<X size={13} /></button>}{priceLimit !== null && <button type="button" onClick={() => setPriceLimit(null)}>Up to ₹{priceLimit}<X size={13} /></button>}{minRating > 0 && <button type="button" onClick={() => setMinRating(0)}>{minRating}+ stars<X size={13} /></button>}</div>}{refreshing && <p className="catalog-desktop-refresh catalog-refresh" role="status"><i />Checking the latest collection…</p>}{unavailable && <p className="catalog-update-note" role="status">You're viewing the saved collection. <button type="button" disabled={refreshing} onClick={() => void retry()}>{refreshing ? 'Checking…' : 'Try again'}</button></p>}<ProductGrid products={products} totalCount={total} currentSort={sort} onSortChange={setSort} onResetFilters={reset} title={searchMode && query ? `Results for “${query}”` : undefined} emptyTitle={query ? 'No match this time' : 'Nothing matches these filters'} emptyDescription="Try a shorter search, a different style, or clear the filters to explore everything." /></section></div>
  </div>;
}
