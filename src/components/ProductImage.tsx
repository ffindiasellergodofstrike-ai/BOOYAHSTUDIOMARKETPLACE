import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, ArrowUpRight } from 'lucide-react';
import { Product } from '../types';
import '../styles/catalog.css';

interface ProductImageProps { product: Product; className?: string; size?: 'sm' | 'md' | 'lg' | 'hero'; }
export const ProductImage: React.FC<ProductImageProps> = ({ product, className = '', size = 'md' }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [product.id, product.image]);
  const [name] = product.title.split(' — ');
  return <div className={`catalog-image ${loaded ? 'is-loaded' : ''} ${failed || !product.image ? 'is-fallback' : ''} ${className}`} aria-busy={Boolean(product.image && !failed && !loaded)}>
    {product.image && !failed ? <img src={product.image} alt={product.title} decoding="async" loading={size === 'hero' ? 'eager' : 'lazy'} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : <div className="catalog-image-fallback"><ImageIcon size={30} strokeWidth={1.3} aria-hidden="true" /><span>{product.categoryLabel}</span><strong>{name}</strong><ArrowUpRight size={24} aria-hidden="true" /></div>}
  </div>;
};
