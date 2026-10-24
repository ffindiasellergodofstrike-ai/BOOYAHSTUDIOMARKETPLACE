import React, { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowRight, Code2, FileCode, LayoutTemplate, Wrench, GraduationCap, Tag } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProductService } from '../services/ProductService';
import { Product } from '../types';
import { useProductCatalog } from '../hooks/useProductCatalog';

interface SearchBarProps {
  className?: string;
  variant?: 'header' | 'hero' | 'standalone';
  placeholder?: string;
  autoFocus?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  className = '',
  variant = 'header',
  placeholder = 'Search scripts, templates, courses, tools...',
  autoFocus = false,
}) => {
  const catalog = useProductCatalog();
  const { navigate } = useApp();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length >= 2) {
      const result = ProductService.searchProducts({ query: query.trim() });
      setSuggestions(result.products.slice(0, 5));
      setIsOpen(true);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  }, [query, catalog]);

  // Click outside to close suggestion dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (query.trim()) {
      setIsOpen(false);
      navigate('/search', undefined, { q: query.trim() });
    }
  };

  const handleSelectProduct = (slug: string) => {
    setIsOpen(false);
    setQuery('');
    navigate('/product/:slug', { slug });
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'php-scripts':
        return Code2;
      case 'source-code':
        return FileCode;
      case 'templates':
        return LayoutTemplate;
      case 'tools':
        return Wrench;
      case 'courses':
        return GraduationCap;
      default:
        return Tag;
    }
  };

  const isHero = variant === 'hero';

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full">
        <div className="absolute left-3.5 sm:left-4 pointer-events-none text-slate-400 flex items-center">
          <Search className={isHero ? 'w-5 h-5 text-blue-600' : 'w-4 h-4 text-slate-400'} />
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full rounded-xl transition-all font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
            isHero
              ? 'pl-10 sm:pl-11 pr-20 sm:pr-24 py-3 sm:py-4 text-xs sm:text-base bg-white border-2 border-slate-200 focus:border-blue-500 shadow-lg'
              : 'pl-9 sm:pl-10 pr-14 sm:pr-16 py-2 text-xs sm:text-sm bg-slate-100/90 hover:bg-slate-100 border border-slate-200/80 focus:bg-white focus:border-blue-500 shadow-sm'
          }`}
        />

        <div className="absolute right-2 sm:right-2.5 flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}

          {isHero ? (
            <button
              type="submit"
              className="px-2.5 py-1.5 sm:px-4 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs sm:text-sm transition-colors flex items-center gap-1 shadow-sm"
            >
              <span>Search</span>
              <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          ) : (
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded">
              <span className="text-xs">⌘</span>K
            </kbd>
          )}
        </div>
      </form>

      {/* Autocomplete Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="p-2 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs text-slate-500 px-3">
            <span>Matching Products ({suggestions.length})</span>
            <button
              onClick={() => handleSearchSubmit()}
              className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
            >
              <span>View all matching results</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {suggestions.map((item) => {
              const Icon = getCategoryIcon(item.category);
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectProduct(item.slug)}
                  className="p-3 hover:bg-blue-50/60 cursor-pointer transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-900 text-blue-400 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate group-hover:text-blue-600">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="capitalize">{item.categoryLabel}</span>
                        <span>•</span>
                        <span>v{item.version || '1.0'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-emerald-600">${item.price.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
