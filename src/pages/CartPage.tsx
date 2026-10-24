import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, CheckCircle2, Tag, X, AlertCircle, ShoppingBag, Download, LifeBuoy } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { CartItem } from '../components/CartItem';
import '../styles/purchase.css';

export const CartPage: React.FC = () => {
  const { cartItems, cartSummary, applyCoupon, removeCoupon, appliedCoupon, navigate } = useApp();
  const { showToast } = useToast();
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault(); setCouponError('');
    if (!couponCode.trim()) return;
    const result = applyCoupon(couponCode.trim());
    if (result.success) { showToast('success', 'A little extra, on us', `You saved ₹${result.discount.toFixed(2)} with ${couponCode.toUpperCase()}.`); setCouponCode(''); }
    else { setCouponError(result.message); }
  };
  if (!cartItems.length) return <section className="purchase-page purchase-empty"><span className="purchase-empty-icon"><ShoppingBag size={32} /></span><span className="purchase-eyebrow">SOMETHING GOOD STARTS HERE</span><h1>Your bag has<br />room for an <em>idea.</em></h1><p>Find a template that feels right for your next project. We’ll keep it here until you’re ready.</p><button className="purchase-button purchase-button-primary" onClick={() => navigate('/products')}>Explore the collection <ArrowUpRight size={18} /></button></section>;
  return <section className="purchase-page cart-page">
    <div className="purchase-page-heading"><div><span className="purchase-eyebrow">PICKED WITH YOUR NEXT PROJECT IN MIND</span><h1>Your bag<span>.</span></h1><p>A few good things. One step closer to your next idea.</p></div><button className="purchase-text-link" onClick={() => navigate('/products')}>Keep exploring <ArrowUpRight size={17} /></button></div>
    <div className="purchase-two-column">
      <div className="purchase-bag"><div className="purchase-card-heading"><h2>Your picks</h2><span>{cartSummary.itemCount} {cartSummary.itemCount === 1 ? 'item' : 'items'}</span></div>{cartItems.map(item => <CartItem key={item.product.id} item={item} />)}<div className="purchase-bag-footer"><Download size={18} /><p>All digital. Your files will be waiting in your account after payment.</p></div></div>
      <aside className="purchase-summary"><span className="purchase-eyebrow">THE LITTLE DETAILS</span><h2>Order summary</h2><dl className="purchase-totals"><div><dt>Subtotal</dt><dd>₹{cartSummary.subtotal.toFixed(2)}</dd></div>{cartSummary.discount > 0 && <div className="purchase-discount"><dt>Discount ({appliedCoupon?.code})</dt><dd>−₹{cartSummary.discount.toFixed(2)}</dd></div>}<div><dt>Digital delivery</dt><dd>No extra charge</dd></div><div className="purchase-grand-total"><dt>Total</dt><dd>₹{cartSummary.total.toFixed(2)}</dd></div></dl>
        <div className="purchase-coupon"><label htmlFor="cart-promo-code">Have a promo code?</label>{appliedCoupon ? <div className="purchase-applied-coupon"><span><Tag size={16} /><strong>{appliedCoupon.code}</strong> · {appliedCoupon.discountPercent}% off</span><button onClick={removeCoupon} aria-label="Remove coupon"><X size={16} /></button></div> : <form onSubmit={handleApplyCoupon}><div className="purchase-coupon-field"><input id="cart-promo-code" autoComplete="off" value={couponCode} onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError(''); }} placeholder="Enter your code" /><button type="submit" disabled={!couponCode.trim()}>Apply</button></div>{couponError && <p role="alert" className="purchase-field-error"><AlertCircle size={14} />{couponError}</p>}</form>}</div>
        <button id="proceed-checkout-btn" onClick={() => navigate('/checkout')} className="purchase-button purchase-button-primary purchase-button-full">Continue to checkout <ArrowRight size={18} /></button><p className="purchase-summary-note"><CheckCircle2 size={15} />One-time purchase. Make it yours.</p><div className="purchase-summary-help"><LifeBuoy size={18} /><div><strong>Have a question?</strong><button onClick={() => navigate('/contact')}>We’re happy to help <ArrowUpRight size={13} /></button></div></div>
      </aside>
    </div>
  </section>;
};
