import React from 'react';
import { Trash2 } from 'lucide-react';
import { CartItem as CartItemType } from '../types';
import { ProductImage } from './ProductImage';
import { useApp } from '../context/AppContext';

interface CartItemProps { item: CartItemType; }
export const CartItem: React.FC<CartItemProps> = ({ item }) => {
  const { removeFromCart, navigate } = useApp();
  const { product, price, quantity } = item;
  return <article id={`cart-item-${product.id}`} className="purchase-cart-item">
    <button className="purchase-cart-thumbnail" aria-label={`View ${product.title}`} onClick={() => navigate('/product/:slug', { slug: product.slug })}><ProductImage product={product} className="w-full h-full object-cover" /></button>
    <div className="purchase-cart-description"><span className="purchase-eyebrow">{product.categoryLabel}</span><h3><button onClick={() => navigate('/product/:slug', { slug: product.slug })}>{product.title}</button></h3><p>{product.version ? `Version ${product.version} · ` : ''}Qty: {quantity}</p><button id={`remove-cart-item-${product.id}`} onClick={() => removeFromCart(product.id)} className="purchase-remove" aria-label={`Remove ${product.title} from cart`}><Trash2 size={14} />Remove</button></div>
    <strong className="purchase-cart-price">₹{(price * quantity).toFixed(2)}</strong>
  </article>;
};
