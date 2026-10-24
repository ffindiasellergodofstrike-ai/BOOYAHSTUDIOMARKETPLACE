import React, { useEffect, useRef } from 'react';
import { ArrowRight, ChevronRight, Heart, LogOut, Search, ShoppingBag, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Brand } from './Brand';
import { useApp } from '../context/AppContext';

export const MobileMenu: React.FC = () => {
  const { isMobileMenuOpen, setIsMobileMenuOpen, navigate, cartCount, wishlistCount, currentUser, isAuthenticated, signOut, setIsQuickSearchOpen, currentPath } = useApp();
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsMobileMenuOpen(false); }
      if (event.key !== 'Tab') return;
      const focusable = drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [isMobileMenuOpen, setIsMobileMenuOpen]);
  const go = (path: string) => { setIsMobileMenuOpen(false); navigate(path); };
  return (
    <AnimatePresence>
      {isMobileMenuOpen && <React.Fragment key="mobile-navigation">
        <motion.div className="mobile-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMobileMenuOpen(false)} aria-hidden="true" />
        <motion.div ref={drawer} id="mobile-menu-container" className="mobile-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-menu-title" initial={{ x: reduceMotion ? 0 : '100%' }} animate={{ x: 0 }} exit={{ x: reduceMotion ? 0 : '100%', opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .24, ease: 'easeOut' }}>
          <div className="mobile-drawer-head"><span className="studio-brand"><Brand /></span><h2 id="mobile-menu-title" className="sr-only">Navigation</h2><button ref={closeButton} id="close-mobile-menu-btn" className="icon-button" aria-label="Close menu" onClick={() => setIsMobileMenuOpen(false)}><X size={21} /></button></div>
          <div className="mobile-drawer-body">
            <button className="mobile-search" onClick={() => { setIsMobileMenuOpen(false); setIsQuickSearchOpen(true); }}><Search size={18} /> Find a template <ArrowRight size={16} /></button>
            <nav className="mobile-links" aria-label="Main navigation">{[['/', 'Home'], ['/products', 'Explore products'], ['/creators', 'Meet the creators'], ['/pricing', 'Start selling'], ['/about', 'Our story'], ['/faq', 'Help & FAQs'], ['/contact', 'Contact & support']].map(([path, label]) => <button key={path} aria-current={currentPath === path ? 'page' : undefined} onClick={() => go(path)}>{label}<ChevronRight size={16} /></button>)}</nav>
            <div className="mobile-bag-links"><button onClick={() => go('/wishlist')}><Heart size={18} /> Wishlist <span>{wishlistCount}</span></button><button onClick={() => go('/cart')}><ShoppingBag size={18} /> Your cart <span>{cartCount}</span></button></div>
            <div className="mobile-drawer-user">
              {isAuthenticated ? <><strong>Hello, {currentUser?.name?.split(' ')[0] || 'there'}.</strong><p>Your purchases, all in one place.</p><div className="mobile-links">{[['/account', 'My account'], ['/account/orders', 'Orders'], ['/account/downloads', 'Downloads'], ['/memberships', 'Memberships'], ['/creator', 'My storefront'], ...(currentUser?.role === 'admin' ? [['/admin', 'Manage store']] : [])].map(([path, label]) => <button key={path} onClick={() => go(path)}>{label}<ChevronRight size={15} /></button>)}<button onClick={() => { setIsMobileMenuOpen(false); signOut(); }}>Sign out <LogOut size={16} /></button></div></> : <><strong>Make room for your next idea.</strong><p>Sign in to find your purchases and downloads.</p><button className="btn btn-primary w-full" onClick={() => go('/login')}>Sign in <ArrowRight size={16} /></button><button className="text-button" onClick={() => go('/register')}>Create an account <ChevronRight size={15} /></button></>}
            </div>
          </div>
          <div className="mobile-drawer-foot">Thoughtful templates. A better head start.</div>
        </motion.div>
      </React.Fragment>}
    </AnimatePresence>
  );
};
