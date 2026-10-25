import { getCreatorPath } from '../config/creatorRoutes';
import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Download, ExternalLink, FileCode2, Layers3, MonitorPlay, RefreshCw, Share2, ShoppingBag } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProductService } from '../services/ProductService';
import { ProductImage } from '../components/ProductImage';
import { WishlistButton } from '../components/WishlistButton';
import { FAQAccordion, FAQItem } from '../components/FAQAccordion';
import { Modal } from '../components/Modal';
import { ShareModal } from '../components/ShareModal';
import { ProductCard } from '../components/ProductCard';
import { Spinner } from '../components/ui/Spinner';
import { useProductCatalog } from '../hooks/useProductCatalog';
import '../styles/product-detail.css';

export const ProductDetailsPage: React.FC = () => {
  useProductCatalog();
  const { pathParams, navigate, addToCart, cartItems } = useApp();
  const rawSlug = pathParams.slug || (window.location.pathname.startsWith('/product/') ? window.location.pathname.replace('/product/', '').split('?')[0] : '');
  let slug = rawSlug;
  try { slug = decodeURIComponent(rawSlug); } catch { /* Keep malformed URLs on the not-found page. */ }
  const product = ProductService.getProductBySlug(slug) || ProductService.getProductBySlug(rawSlug);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [previewLoadStatus, setPreviewLoadStatus] = useState<'loading' | 'ready' | 'slow'>('loading');
  const [previewReloadKey, setPreviewReloadKey] = useState(0);

  useEffect(() => {
    if (!isDemoModalOpen || !product?.previewUrl) return;
    setPreviewLoadStatus('loading');
    const slowLoadTimer = window.setTimeout(() => setPreviewLoadStatus(current => current === 'loading' ? 'slow' : current), 8000);
    return () => window.clearTimeout(slowLoadTimer);
  }, [isDemoModalOpen, previewReloadKey, product?.previewUrl]);

  if (!product) return <div className="studio-container detail-not-found"><span className="detail-not-found-icon"><Layers3 size={32} /></span><p className="eyebrow">A DIFFERENT STARTING POINT</p><h1>We couldn't find this product.</h1><p>It may have moved or is no longer available. There's more to explore in the collection.</p><button type="button" className="btn btn-primary" onClick={() => navigate('/products')}>Explore the collection<ArrowRight size={18} /></button></div>;

  const inCart = cartItems.some(item => item.product.id === product.id);
  const [name, subtitle] = product.title.split(' — ');
  const relatedProducts = ProductService.getRelatedProducts(product.id, 3);
  const handleAddToCart = () => { if (inCart) navigate('/cart'); else addToCart(product, 1); };
  const handleBuyNow = () => { if (!inCart) addToCart(product, 1); navigate('/checkout'); };
  const handlePreviewLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    if (!product.previewUrl) return;
    try {
      const previewUrl = new URL(product.previewUrl, window.location.href);
      if (previewUrl.origin === window.location.origin) {
        const previewDocument = event.currentTarget.contentDocument;
        if (!previewDocument?.documentElement || !previewDocument.body?.childElementCount) { setPreviewLoadStatus('slow'); return; }
      }
      setPreviewLoadStatus('ready');
    } catch { setPreviewLoadStatus('slow'); }
  };
  const faqsList: FAQItem[] = product.faqs || [
    { question: 'Where will I find my files?', answer: 'Once your payment is confirmed, your files are available in My downloads in your account. Your order email also links to your account. Contact support if your purchase is missing.' },
    { question: 'Can I customise this for my own project?', answer: 'You can customise the files within the license described below. The original package may not be redistributed or resold as a competing product.' },
    { question: 'Are updates included?', answer: 'Updates and support are included only where stated in this listing or the supplied documentation.' },
    { question: 'What if I need help with my purchase?', answer: 'Contact support with your order number and a description of the issue. Please review our Refund Policy for the conditions that apply to digital products.' },
  ];

  return <div className="studio-container detail-page">
    <nav className="detail-breadcrumb" aria-label="Breadcrumb"><button type="button" onClick={() => navigate('/products')}>The collection</button><span>/</span><button type="button" onClick={() => navigate('/category/:slug', { slug: product.category })}>{product.categoryLabel}</button><span>/</span><span>{name}</span></nav>
    <div className="detail-hero">
      <div className="detail-gallery">
        <div className="detail-preview-image"><ProductImage product={product} size="hero" /><span className="detail-preview-tag"><Layers3 size={14} />{product.categoryLabel}</span></div>
        <div className="detail-gallery-toolbar"><button id="launch-interactive-demo-btn" type="button" className="btn btn-secondary" onClick={() => { setPreviewLoadStatus('loading'); setIsDemoModalOpen(true); }}><MonitorPlay size={18} />{product.previewUrl ? 'Try the live demo' : 'View product overview'}<ArrowUpRight size={16} /></button><div><button id="share-product-btn" type="button" className="detail-icon-button" aria-label="Share this product" onClick={() => setIsShareModalOpen(true)}><Share2 size={18} /></button><WishlistButton product={product} size="md" /></div></div>
        <div className="detail-specs">{product.fileFormat && <div><FileCode2 size={19} /><span>Made with<strong>{product.fileFormat}</strong></span></div>}{product.fileSize && <div><Download size={19} /><span>File size<strong>{product.fileSize}</strong></span></div>}{product.version && <div><Layers3 size={19} /><span>Version<strong>{product.version.replace(/^v/i, '')}</strong></span></div>}</div>
      </div>
      <div className="detail-purchase"><p className="eyebrow">A STARTING POINT, MADE YOURS</p><h1>{name}<span>{subtitle}</span></h1><button className="product-publisher" type="button" onClick={() => navigate(getCreatorPath(product.creatorSlug || 'booyahstudio'))}>By {product.sellerName || 'Booyahstudio'}<ArrowUpRight size={13} /></button><p className="detail-intro">{product.shortDescription}</p>{product.membershipEligible && <button className="text-button" type="button" onClick={() => navigate(getCreatorPath(product.creatorSlug || 'booyahstudio'))}>Also available with this creator’s eligible membership <ArrowUpRight size={14} /></button>}<div className="detail-price"><strong>₹{product.price.toLocaleString('en-IN')}</strong>{product.originalPrice && product.originalPrice > product.price && <del>₹{product.originalPrice.toLocaleString('en-IN')}</del>}<span>One-time purchase</span></div><div className="detail-purchase-actions"><button id="buy-now-btn" type="button" className="btn btn-primary" onClick={handleBuyNow}>Continue to checkout<ArrowRight size={18} /></button><button id="add-to-cart-detail-btn" type="button" className="btn btn-secondary" onClick={handleAddToCart}>{inCart ? <Check size={18} /> : <ShoppingBag size={18} />}{inCart ? 'View in your cart' : 'Add to cart'}</button></div><ul className="detail-purchase-notes"><li><Check size={16} />Download from your account after payment</li><li><Check size={16} />Includes the files listed below</li><li><Check size={16} />A digital product. No physical delivery.</li></ul><button type="button" className="detail-support-link" onClick={() => navigate('/contact')}>A question before you buy?<ArrowUpRight size={16} /></button></div>
    </div>
    <section className="detail-information" aria-label="Product information"><div className="detail-information-main"><p className="eyebrow">GET TO KNOW IT</p><h2>A closer look.</h2><p className="detail-description">{product.description}</p>{product.features.length > 0 && <div className="detail-features">{product.features.map((feature, index) => <div key={index}><span><Check size={16} /></span><p>{feature}</p></div>)}</div>}</div><aside className="detail-included"><span className="detail-included-icon"><FileCode2 size={24} /></span><h2>What's inside</h2><p>Your purchase includes:</p><ul>{product.whatsIncluded.map((file, index) => <li key={index}><Check size={15} /><span>{file}</span></li>)}</ul></aside></section>
    <div className="detail-accordions">{product.requirements && product.requirements.length > 0 && <details className="detail-disclosure"><summary><span>Before you get started</span><ChevronDown size={19} /></summary><div><p>You'll need the following to use this product:</p><ul>{product.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></div></details>}<details className="detail-disclosure"><summary><span>License & usage</span><ChevronDown size={19} /></summary><div><p>{product.licenseTerms || 'Use and customise this product for your project as described in the listing and included documentation. Do not redistribute the original package. Contact support before purchase if you need additional rights.'}</p><a href="/policies/license">Read the Digital Product License & Usage Policy<ArrowUpRight size={15} /></a></div></details></div>
    <section className="detail-faq"><div><p className="eyebrow">A FEW HELPFUL ANSWERS</p><h2>Good to know.</h2><p>Still wondering about something?<br /><button type="button" onClick={() => navigate('/contact')}>We're here to help<ArrowUpRight size={16} /></button></p></div><FAQAccordion items={faqsList} allowMultiple /></section>
    {relatedProducts.length > 0 && <section className="detail-related"><div><div><p className="eyebrow">KEEP THE IDEAS COMING</p><h2>You might also like.</h2></div><button type="button" className="detail-support-link" onClick={() => navigate('/category/:slug', { slug: product.category })}>Explore {product.categoryLabel}<ArrowUpRight size={17} /></button></div><div className="catalog-grid">{relatedProducts.map(item => <ProductCard key={item.id} product={item} />)}</div></section>}
    <Modal isOpen={isDemoModalOpen} onClose={() => setIsDemoModalOpen(false)} title={product.previewUrl ? `Live demo: ${name}` : `A closer look: ${name}`} maxWidth={product.previewUrl ? '6xl' : 'lg'} mobileFullscreen={Boolean(product.previewUrl)}>{product.previewUrl ? <div className="detail-demo"><div className="detail-demo-heading"><div><strong>Take a look around.</strong><p>This is a demo. It won't change your purchase.</p></div><a href={product.previewUrl} target="_blank" rel="noopener noreferrer">Open in a new tab<ExternalLink size={15} /></a></div><div className="detail-demo-frame">{previewLoadStatus === 'loading' && <div className="detail-demo-overlay" role="status"><Spinner size={30} /><strong>Opening the preview…</strong><p>This may take a moment on a slower connection.</p></div>}{previewLoadStatus === 'slow' && <div className="detail-demo-overlay" role="alert"><strong>The preview is taking a little longer.</strong><p>Check your connection, try again, or open it in a new tab.</p><div><button type="button" className="btn btn-primary" onClick={() => { setPreviewLoadStatus('loading'); setPreviewReloadKey(current => current + 1); }}><RefreshCw size={16} />Try again</button><a className="btn btn-secondary" href={product.previewUrl} target="_blank" rel="noopener noreferrer">Open directly<ExternalLink size={16} /></a></div></div>}<iframe key={`${product.previewUrl}-${previewReloadKey}`} src={product.previewUrl} title={`${product.title} live demo preview`} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads" referrerPolicy="no-referrer" loading="eager" onLoad={handlePreviewLoad} onError={() => setPreviewLoadStatus('slow')} /><span className="detail-demo-watermark" aria-hidden="true">Booyahstudio · Preview</span></div><p className="detail-demo-note">Some sign-in, payment and download actions may be unavailable in this preview.</p></div> : <div className="detail-overview-modal"><ProductImage product={product} size="hero" /><p>{product.shortDescription}</p><ul>{product.whatsIncluded.map((item, index) => <li key={index}><Check size={15} />{item}</li>)}</ul><button type="button" className="btn btn-primary" onClick={() => { setIsDemoModalOpen(false); handleAddToCart(); }}>{inCart ? 'View in your cart' : 'Add to cart'}<ShoppingBag size={17} /></button></div>}</Modal>
    <ShareModal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} title={product.title} description={product.shortDescription} path={`/product/${product.slug}`} />
  </div>;
};
