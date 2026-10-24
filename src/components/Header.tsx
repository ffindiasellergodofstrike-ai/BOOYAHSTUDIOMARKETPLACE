import { Brand } from './Brand';
import React, { useEffect, useRef } from 'react';
import { ArrowUpRight, Heart, Menu, Search, ShoppingBag, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const Header: React.FC = () => {
  const { currentPath, navigate, cartCount, wishlistCount, currentUser, isAuthenticated, signOut, setIsMobileMenuOpen, setIsQuickSearchOpen } = useApp();
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (accountMenu.current) accountMenu.current.open = false;
  }, [currentPath]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (accountMenu.current && !accountMenu.current.contains(event.target as Node)) accountMenu.current.open = false;
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, []);
  return (
    <>
      <div className="announcement-bar" role="region" aria-label="Store announcement"><span>A better starting point for your next big idea.</span><button onClick={() => navigate('/products')}>Explore the collection <ArrowUpRight size={13} /></button></div>
      <header className="studio-header">
        <div className="studio-container header-inner">
          <button id="header-logo-btn" className="studio-brand" aria-label="Booyahstudio Home" onClick={() => navigate('/')}><Brand /></button>
          <nav className="desktop-nav" aria-label="Main navigation">
            {[['/', 'Home'], ['/products', 'Explore'], ['/creators', 'Creators'], ['/pricing', 'Start selling']].map(([path, label]) => <button key={path} onClick={() => navigate(path)} aria-current={currentPath === path ? 'page' : undefined}>{label}{currentPath === path && <span className="nav-dot" />}</button>)}
          </nav>
          <div className="header-actions">
            <button id="header-search-trigger-btn" className="icon-button" aria-label="Search products" onClick={() => setIsQuickSearchOpen(true)}><Search size={19} /></button>
            <button id="header-wishlist-btn" className="icon-button header-wishlist" aria-label={`Wishlist with ${wishlistCount} items`} onClick={() => navigate('/wishlist')}><Heart size={19} />{wishlistCount > 0 && <span className="count-badge">{wishlistCount}</span>}</button>
            <button id="header-cart-btn" className="icon-button" aria-label={`Shopping cart with ${cartCount} items`} onClick={() => navigate('/cart')}><ShoppingBag size={19} />{cartCount > 0 && <span className="count-badge">{cartCount}</span>}</button>
            <span className="header-divider" />
            {isAuthenticated ? <details ref={accountMenu} className="account-menu" onKeyDown={event => { if (event.key === 'Escape' && accountMenu.current) { accountMenu.current.open = false; accountMenu.current.querySelector('summary')?.focus(); } }}><summary className="account-button" id="header-account-btn"><UserRound size={16} /><span>My account</span></summary><div className="account-dropdown">{[['My account', '/account'], ['My orders', '/account/orders'], ['My downloads', '/account/downloads'], ['My memberships', '/memberships'], ['My storefront', '/creator'], ['Delivery links', '/creator/delivery']].map(([label, path]) => <button key={path} onClick={() => { if (accountMenu.current) accountMenu.current.open = false; navigate(path); }}>{label}</button>)}{currentUser?.role === 'admin' && <button onClick={() => navigate('/admin')}>Manage store</button>}<button onClick={signOut}>Sign out</button></div></details> : <button className="account-button" id="header-account-btn" onClick={() => navigate('/login')}><UserRound size={16} /><span>Sign in</span></button>}
            <button id="mobile-menu-toggle-btn" className="icon-button mobile-toggle" aria-label="Open navigation menu" aria-haspopup="dialog" onClick={() => setIsMobileMenuOpen(true)}><Menu size={22} /></button>
          </div>
        </div>
      </header>
    </>
  );
};
