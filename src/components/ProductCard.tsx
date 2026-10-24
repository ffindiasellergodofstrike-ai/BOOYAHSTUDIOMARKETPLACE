import React from 'react';
import { ArrowUpRight, Check, ShoppingBag } from 'lucide-react';
import { Product } from '../types';
import { ProductImage } from './ProductImage';
import { WishlistButton } from './WishlistButton';
import { useApp } from '../context/AppContext';
import '../styles/catalog.css';

interface ProductCardProps { product: Product; variant?: 'grid' | 'list' | 'compact'; }
export const ProductCard: React.FC<ProductCardProps> = ({ product, variant = 'grid' }) => {
  const { navigate, addToCart, cartItems } = useApp();
  const isInCart = cartItems.some(item => item.product.id === product.id);
  const [name, subtitle] = product.title.split(' — ');
  const details = () => navigate(`/product/${product.slug}`);
  const format = product.fileFormat?.includes('React') ? 'React' : product.fileFormat?.includes('HTML') ? 'HTML / CSS' : product.categoryLabel;
  return <article id={`product-card-${product.id}`} className={`studio-product-card catalog-product-card ${variant === 'list' ? 'product-list' : ''}`}>
    <div className={`product-visual product-visual-${product.id}`}>
      <button type="button" className="product-image-link" onClick={details} aria-label={`View ${product.title}`}><ProductImage product={product} className="studio-product-image" /><span className="image-hover-label">Take a closer look <ArrowUpRight size={16} /></span></button>
      <span className="product-category">{product.categoryLabel}</span>
      <div className="product-wishlist"><WishlistButton product={product} size="sm" /></div>
    </div>
    <div className="product-content">
      <div className="catalog-card-kicker"><span>{format}</span>{product.version && <span>v{product.version.replace(/^v/i, '')}</span>}</div>
      <div className="product-title-row"><h3><button type="button" onClick={details}>{name}</button></h3><ArrowUpRight size={18} aria-hidden="true" /></div>
      {subtitle && <p className="product-subtitle">{subtitle}</p>}
      <button type="button" className="product-publisher" onClick={() => navigate(`/store/${product.creatorSlug || 'booyahstudio'}`)}>By {product.sellerName || 'Booyahstudio'} <ArrowUpRight size={12} /></button>
      <p className="product-description">{product.shortDescription}</p>
      <div className="product-bottom"><div className="product-price">₹{product.price.toLocaleString('en-IN')}{product.originalPrice && product.originalPrice > product.price && <del>₹{product.originalPrice.toLocaleString('en-IN')}</del>}<small>One-time purchase</small></div><div className="product-card-actions"><button type="button" className={`product-cart ${isInCart ? 'is-added' : ''}`} onClick={() => { if (isInCart) navigate('/cart'); else addToCart(product, 1); }} aria-label={isInCart ? `View ${name} in cart` : `Add ${name} to cart`} title={isInCart ? 'In your cart' : 'Add to cart'}>{isInCart ? <Check size={18} /> : <ShoppingBag size={18} />}</button><button type="button" className="product-details" onClick={details}>View details <ArrowUpRight size={16} /></button></div></div>
    </div>
  </article>;
};
