import React, { useMemo, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../context/AppContext';
import { ProductService } from '../services/ProductService';
import { useProductCatalog } from '../hooks/useProductCatalog';
const formatCurrency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);

export const QuickSearchModal: React.FC = () => {
  const catalog = useProductCatalog();
  const { isQuickSearchOpen, setIsQuickSearchOpen, navigate } = useApp();
  const [query, setQuery] = useState('');
  const results = useMemo(() => query.trim() ? ProductService.searchProducts({ query: query.trim() }).products.slice(0, 6) : catalog.filter(product => product.isFeatured).slice(0, 4), [query, catalog]);
  const close = () => { setIsQuickSearchOpen(false); setQuery(''); };
  const searchAll = () => { const q = query.trim(); close(); navigate('/search', undefined, q ? { q } : undefined); };
  return <Modal isOpen={isQuickSearchOpen} onClose={close} title="Find your next starting point" maxWidth="2xl">
    <div className="quick-search">
      <form className="quick-search-input" role="search" onSubmit={event => { event.preventDefault(); searchAll(); }}><Search size={20} /><label htmlFor="quick-product-search" className="sr-only">Search templates</label><input id="quick-product-search" type="search" autoComplete="off" autoFocus placeholder="A portfolio, a store, a new idea…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17} /></button>}</form>
      <div className="quick-search-categories" aria-label="Browse categories">{ProductService.getCategories().map(category => <button key={category.id} onClick={() => { close(); navigate(`/category/${category.slug}`); }}>{category.name}</button>)}</div>
      <div className="quick-search-label" role="status">{query.trim() ? `${results.length} matching ${results.length === 1 ? 'template' : 'templates'}` : 'A few places to start'}</div>
      <div className="quick-search-results">{results.length ? results.map(product => <button key={product.id} onClick={() => { close(); navigate(`/product/${product.slug}`); }}><img src={product.image} alt="" loading="lazy" /><span><strong>{product.title}</strong><small>{product.shortDescription}</small></span><b>{formatCurrency(product.price)}</b><ArrowRight size={17} /></button>) : <div className="quick-search-empty"><Search size={26} /><p>No matches yet.</p><span>Try another word or browse the full collection.</span></div>}</div>
      <div className="quick-search-foot"><span>Esc to close</span><button className="text-button" onClick={searchAll}>See all results <ArrowRight size={16} /></button></div>
    </div>
  </Modal>;
};
