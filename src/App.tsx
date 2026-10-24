import React, { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { Header } from './components/Header';
import { MobileMenu } from './components/MobileMenu';
import { Footer } from './components/Footer';
import { QuickSearchModal } from './components/QuickSearchModal';
import { SEOHead } from './components/SEOHead';
import { MotionConfig } from 'motion/react';
import { Spinner } from './components/ui/Spinner';
import { EmptyState } from './components/EmptyState';

// Pages
import { HomePage } from './pages/HomePage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailsPage } from './pages/ProductDetailsPage';
import { CategoryPage } from './pages/CategoryPage';
import { SearchPage } from './pages/SearchPage';
import { CartPage } from './pages/CartPage';
import { WishlistPage } from './pages/WishlistPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { AccountPage } from './pages/AccountPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { FAQPage } from './pages/FAQPage';
import { PolicyDetailsPage } from './pages/policies/PolicyDetailsPage';
import { CreatorHubPage } from './pages/CreatorHubPage';
import { CreatorDirectoryPage } from './pages/CreatorDirectoryPage';
import { CreatorStorefrontPage } from './pages/CreatorStorefrontPage';
import { PricingPage } from './pages/PricingPage';
import { CustomerMemberships } from './components/CustomerMemberships';
import {
  SUPPORTED_POLICY_SLUGS,
  POLICY_REDIRECTS,
  type SupportedPolicySlug,
} from './data/policyData';

const AdminPage = React.lazy(() =>
  import('./pages/AdminPage').then((module) => ({ default: module.AdminPage }))
);

const AppContent: React.FC = () => {
  const { currentPath, pathParams, isNavigating } = useApp();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [currentPath, pathParams]);

  // Route Resolver
  const renderCurrentPage = () => {
    if (currentPath.startsWith('/creators/')) return <CreatorStorefrontPage />;
    if (currentPath.startsWith('/product/')) {
      return <ProductDetailsPage />;
    }
    if (currentPath.startsWith('/category/')) {
      return <CategoryPage />;
    }
    if (currentPath === '/policies' || currentPath === '/policies/') {
      return <PolicyDetailsPage slug="terms" />;
    }
    if (currentPath.startsWith('/policies/')) {
      const slug = currentPath.substring('/policies/'.length).replace(/\/$/, '');
      return <PolicyDetailsPage slug={slug} />;
    }

    // Direct root paths for policies or retired policy redirects (e.g. /terms, /privacy, /refund, /delivery, /cancellation, /chargebacks, /grievance, /license, /cookies, etc.)
    const rootSlug = currentPath.startsWith('/') ? currentPath.slice(1).replace(/\/$/, '') : '';
    if (
      SUPPORTED_POLICY_SLUGS.includes(rootSlug as SupportedPolicySlug) ||
      Boolean(POLICY_REDIRECTS[rootSlug])
    ) {
      return <PolicyDetailsPage slug={rootSlug} />;
    }

    switch (currentPath) {
      case '/':
        return <HomePage />;
      case '/products':
        return <ProductsPage />;
      case '/creators':
        return <CreatorDirectoryPage />;
      case '/creator':
        return <CreatorHubPage />;
      case '/pricing':
        return <PricingPage />;
      case '/memberships':
        return <CustomerMemberships />;
      case '/search':
        return <SearchPage />;
      case '/cart':
        return <CartPage />;
      case '/wishlist':
        return <WishlistPage />;
      case '/checkout':
        return <CheckoutPage />;
      case '/login':
        return <LoginPage />;
      case '/register':
        return <RegisterPage />;
      case '/forgot-password':
        return <ForgotPasswordPage />;
      case '/account':
      case '/account/orders':
      case '/account/downloads':
      case '/account/settings':
        return <AccountPage />;
      case '/about':
        return <AboutPage />;
      case '/contact':
        return <ContactPage />;
      case '/faq':
        return <FAQPage />;
      case '/admin':
        return (
          <React.Suspense
            fallback={
              <div className="min-h-[60vh] flex items-center justify-center">
                <span className="inline-flex items-center gap-3 text-sm" role="status"><Spinner size={24} />Opening admin…</span>
              </div>
            }
          >
            <AdminPage />
          </React.Suspense>
        );
      default:
        return <section className="studio-container studio-not-found"><p className="eyebrow">A SMALL DETOUR</p><h1>Looks like this page has moved.</h1><EmptyState title="Let’s find your next idea." description="This link may have changed. There’s plenty to explore in the collection." actionText="Explore templates" /></section>;
    }
  };

  return (
    <div className="studio-app min-h-screen flex flex-col font-sans antialiased w-full max-w-full">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <SEOHead />
      {/* Header */}
      <Header />

      {/* Main Page Body */}
      <main id="main-content" className="flex-1" tabIndex={-1}>
        {renderCurrentPage()}
      </main>

      {/* Footer */}
      <Footer />

      {/* Overlays & Modals */}
      <MobileMenu />
      <QuickSearchModal />

      {isNavigating && <div className="route-progress" role="status" aria-label="Opening page"><span /><span className="sr-only">Opening page…</span></div>}
    </div>
  );
};

export default function App() {
  return (
    <MotionConfig reducedMotion="user"><ToastProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ToastProvider></MotionConfig>
  );
}
