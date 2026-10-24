import { safePreviousUrl } from '../services/AuthNavigation';
import React, { createContext, useContext, useState, useEffect, useTransition } from 'react';
import { CartItem, WishlistItem, User, Coupon, Product } from '../types';
import { CartService } from '../services/CartService';
import { WishlistService } from '../services/WishlistService';
import { AuthService, RegisterPayload, ResetPasswordPayload } from '../services/AuthService';
import { useToast } from './ToastContext';

interface NavigationState {
  path: string;
  params: Record<string, string>;
  searchParams: Record<string, string>;
}

export interface CartSummary {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  itemCount: number;
}

export interface AppContextType {
  // Navigation & Route
  currentPath: string;
  routeParams: Record<string, string>;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
  navigate: (path: string, params?: Record<string, string>, search?: Record<string, string>) => void;
  goBack: () => void;
  
  // Cart
  cartItems: CartItem[];
  cartCount: number;
  cartTotals: { subtotal: number; discount: number; tax: number; total: number };
  cartSummary: CartSummary;
  appliedCoupon: Coupon | null;
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  applyCoupon: (code: string) => { success: boolean; message: string; discount: number };
  removeCoupon: () => void;
  clearCart: () => void;

  // Wishlist
  wishlistItems: WishlistItem[];
  wishlistCount: number;
  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (product: Product) => void;
  removeFromWishlist: (productId: string) => void;
  clearWishlist: () => void;
  moveWishlistToCart: (productId: string) => void;
  moveAllWishlistToCart: () => void;

  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  signIn: (identifier: string, password?: string) => Promise<{ success: boolean; user?: User; message?: string }>;
  register: (payload: RegisterPayload) => Promise<{ success: boolean; user?: User; message?: string }>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<{ success: boolean; message: string }>;
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; user?: User }>;
  signOut: () => void;

  // UI state
  isNavigating: boolean;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  isQuickSearchOpen: boolean;
  setIsQuickSearchOpen: (open: boolean) => void;
  activeQuickSearchQuery: string;
  setActiveQuickSearchQuery: (query: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function parsePath(pathname: string, search: string): NavigationState {
  let path = pathname || '/';
  if (!path.startsWith('/')) path = '/' + path;

  // Extract query params
  const searchObj: Record<string, string> = {};
  if (search) {
    const usp = new URLSearchParams(search);
    usp.forEach((value, key) => {
      searchObj[key] = value;
    });
  }

  // Parse path params (e.g. /product/:slug, /category/:slug)
  const params: Record<string, string> = {};
  const segments = path.split('/').filter(Boolean);

  if (segments[0] === 'product' && segments[1]) {
    params.slug = segments[1];
  } else if (segments[0] === 'category' && segments[1]) {
    params.slug = segments[1];
  }

  return {
    path,
    params,
    searchParams: searchObj,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();

  // Navigation State
  const [navState, setNavState] = useState<NavigationState>(() => {
    return parsePath(window.location.pathname, window.location.search);
  });

  // Cart State
  const [cartItems, setCartItems] = useState<CartItem[]>(() => CartService.getItems());
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(() => CartService.getAppliedCoupon());

  // Wishlist State
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>(() => WishlistService.getItems());

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(() => AuthService.getCurrentUser());

  // Mobile Menu & Quick Search
  const [isNavigating, startNavigation] = useTransition();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [activeQuickSearchQuery, setActiveQuickSearchQuery] = useState('');

  // Handle browser popstate (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      setNavState(parsePath(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Subscribe to CartService
  useEffect(() => {
    const unsubscribe = CartService.subscribe((items, coupon) => {
      setCartItems(items);
      setAppliedCoupon(coupon);
    });
    return unsubscribe;
  }, []);

  // Subscribe to WishlistService
  useEffect(() => {
    const unsubscribe = WishlistService.subscribe((items) => {
      setWishlistItems(items);
    });
    return unsubscribe;
  }, []);

  // Subscribe to AuthService
  useEffect(() => {
    const unsubscribe = AuthService.subscribe((user) => {
      setCurrentUser(user);
    });
    return unsubscribe;
  }, []);

  // Navigation Function
  const navigate = (newPath: string, params?: Record<string, string>, search?: Record<string, string>) => {
    let target = newPath;
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        target = target.replace(`:${key}`, val);
      });
    }

    let queryString = '';
    if (search && Object.keys(search).length > 0) {
      const sp = new URLSearchParams(search);
      queryString = '?' + sp.toString();
    }

    const fullUrl = target + queryString;
    
    // Store previous path for manual back navigation
    localStorage.setItem('ff_previous_path', safePreviousUrl(window.location.pathname, window.location.search));
    
    window.history.pushState({}, '', fullUrl);
    setIsMobileMenuOpen(false);
    setIsQuickSearchOpen(false);
    startNavigation(() => setNavState(parsePath(target, queryString)));
  };

  const goBack = () => {
    const storedPrevious = localStorage.getItem('ff_previous_path');
    const prev = storedPrevious ? safePreviousUrl(storedPrevious.split('?')[0], storedPrevious.includes('?') ? '?' + storedPrevious.split('?').slice(1).join('?') : '') : null;
    setIsMobileMenuOpen(false);
    setIsQuickSearchOpen(false);
    if (prev && prev !== window.location.pathname) {
      window.history.pushState({}, '', prev);
      const [pathname, query = ''] = prev.split('?');
      startNavigation(() => setNavState(parsePath(pathname, query ? '?' + query : '')));
    } else if (window.history.length > 1) window.history.back();
    else {
      window.history.pushState({}, '', '/');
      startNavigation(() => setNavState(parsePath('/', '')));
    }
  };

  // Keyboard shortcut (Cmd+K / Ctrl+K) for quick search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsQuickSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cart operations
  const addToCart = (product: Product, quantity = 1) => {
    const alreadyInCart = cartItems.some((item) => item.product.id === product.id);
    
    if (alreadyInCart) {
      showToast('info', 'Already in Cart', `${product.title} is already in your shopping cart.`);
      return;
    }

    CartService.addItem(product, quantity);
    showToast('success', 'Added to Cart', `${product.title} added to your shopping cart.`);
  };

  const removeFromCart = (productId: string) => {
    CartService.removeItem(productId);
    showToast('info', 'Item Removed', 'Product removed from your cart.');
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    CartService.updateQuantity(productId, quantity);
  };

  const applyCoupon = (code: string): { success: boolean; message: string; discount: number } => {
    const result = CartService.applyCoupon(code);
    const totals = CartService.getTotals();
    return {
      success: result.success,
      message: result.message,
      discount: totals.discount,
    };
  };

  const removeCoupon = () => {
    CartService.removeCoupon();
    showToast('info', 'Coupon Removed', 'Promotional code has been detached.');
  };

  const clearCart = () => {
    CartService.clearCart();
  };

  const cartTotals = CartService.getTotals();
  const cartCount = CartService.getItemCount();
  const cartSummary: CartSummary = {
    ...cartTotals,
    itemCount: cartCount,
  };

  // Wishlist operations
  const isInWishlist = (productId: string) => WishlistService.isInWishlist(productId);

  const toggleWishlist = (product: Product) => {
    const added = WishlistService.toggleWishlist(product);
    if (added) {
      showToast('success', 'Saved to Wishlist', `${product.title} added to your saved list.`);
    } else {
      showToast('info', 'Removed from Wishlist', `${product.title} removed from your saved list.`);
    }
  };

  const removeFromWishlist = (productId: string) => {
    WishlistService.removeFromWishlist(productId);
    showToast('info', 'Removed', 'Product removed from wishlist.');
  };

  const clearWishlist = () => {
    WishlistService.clearWishlist();
    showToast('info', 'Wishlist Cleared', 'All saved items removed.');
  };

  const moveWishlistToCart = (productId: string) => {
    const ok = WishlistService.moveToCart(productId);
    if (ok) {
      showToast('success', 'Moved to Cart', 'Product moved directly to your shopping cart.');
    }
  };

  const moveAllWishlistToCart = () => {
    WishlistService.moveAllToCart();
    showToast('success', 'All Items Moved', 'All wishlist items were transferred to your cart.');
  };

  const wishlistCount = wishlistItems.length;

  // Auth operations
  const signIn = async (identifier: string, password?: string) => {
    return AuthService.signIn(identifier, password || '');
  };

  const register = async (payload: RegisterPayload) => {
    return AuthService.register(payload);
  };

  const resetPassword = async (payload: ResetPasswordPayload) => {
    return AuthService.requestPasswordReset(payload);
  };

  const updateProfile = async (data: Partial<User>) => {
    return AuthService.updateProfile(data);
  };

  const signOut = async () => {
    if (await AuthService.signOut()) showToast('info', 'Signed Out', 'You have been signed out.');
    else showToast('error', 'Sign out incomplete', 'Please retry while connected to the internet.');
  };

  return (
    <AppContext.Provider
      value={{
        currentPath: navState.path,
        routeParams: navState.params,
        pathParams: navState.params,
        searchParams: navState.searchParams,
        navigate,
        goBack,

        cartItems,
        cartCount,
        appliedCoupon,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        applyCoupon,
        removeCoupon,
        clearCart,
        cartTotals,
        cartSummary,

        wishlistItems,
        wishlistCount,
        isInWishlist,
        toggleWishlist,
        removeFromWishlist,
        clearWishlist,
        moveWishlistToCart,
        moveAllWishlistToCart,

        currentUser,
        isAuthenticated: !!currentUser,
        signIn,
        register,
        resetPassword,
        updateProfile,
        signOut,

        isNavigating,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        isQuickSearchOpen,
        setIsQuickSearchOpen,
        activeQuickSearchQuery,
        setActiveQuickSearchQuery,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
