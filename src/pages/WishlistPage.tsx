import React from 'react';
import { Heart, Trash2, ShoppingBag, ArrowUpRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ProductCard } from '../components/ProductCard';
import '../styles/catalog.css';
export const WishlistPage: React.FC = () => {
  const { wishlistItems, clearWishlist, addToCart, cartItems, navigate } = useApp();
  const { showToast } = useToast();
  const addAll = () => {
    wishlistItems.filter(item => !cartItems.some(cart => cart.product.id === item.productId)).forEach(item => addToCart(item.product, 1));
    showToast('success', 'Ready when you are', 'Your saved products are in your cart.');
  };
  return <div className="catalog-page studio-container"><header className="catalog-heading"><div><p className="catalog-kicker"><Heart size={15} />THE ONES YOU LOVE</p><h1>A little list of<br /><em>good possibilities.</em></h1><p>Keep your favourites together. Come back when the idea is ready.</p></div>{wishlistItems.length > 0 && <div className="catalog-wishlist-actions"><button id="add-all-cart-btn" type="button" className="catalog-primary" onClick={addAll}><ShoppingBag size={17} />Add all to cart</button><button id="clear-wishlist-btn" type="button" className="catalog-secondary" onClick={clearWishlist}><Trash2 size={16} />Clear list</button></div>}</header>{wishlistItems.length ? <><div className="catalog-results-bar"><p className="catalog-result-count"><strong>{wishlistItems.length}</strong> saved {wishlistItems.length === 1 ? 'product' : 'products'}</p><button type="button" className="catalog-text-link" onClick={() => navigate('/products')}>Keep exploring<ArrowUpRight size={16} /></button></div><div className="catalog-grid">{wishlistItems.map(item => <ProductCard key={item.productId} product={item.product} />)}</div></> : <div className="catalog-empty"><span className="catalog-empty-icon"><Heart size={30} strokeWidth={1.4} /></span><p className="catalog-kicker">SAVE A LITTLE INSPIRATION</p><h2>Your favourites belong here.</h2><p>Tap the heart on any product to save it for later. Your next idea might be one click away.</p><button type="button" className="catalog-primary" onClick={() => navigate('/products')}>Explore the collection<ArrowUpRight size={17} /></button></div>}</div>;
};
