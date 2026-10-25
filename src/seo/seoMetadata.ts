import { PRODUCTS, CATEGORIES } from '../data/products';
import { policyData, POLICY_REDIRECTS } from '../data/policyData';
import { BUSINESS } from '../config/business';

export { POLICY_REDIRECTS, policyData };
export interface SEOPageData {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImage: string;
  ogImageAlt: string;
  ogType: 'website' | 'product' | 'article';
  noindex: boolean;
  statusCode?: number;
  jsonLd: object[];
}
export const BASE_URL = BUSINESS.url;
export const DEFAULT_OG_IMAGE = `${BASE_URL}/images/og-share-booyah.png`;
export const PRIVATE_PAGE_PATHS = ['/admin', '/account', '/creator', '/memberships', '/checkout', '/cart', '/login', '/register', '/forgot-password', '/wishlist', '/search'];
const hiddenStatuses = new Set(['archived', 'draft', 'inactive']);
export const activeSEOProducts = (products: typeof PRODUCTS) => products.filter(product => !hiddenStatuses.has(String(product.status || 'active').toLowerCase()));
export const cleanPagePath = (pathname: string) => pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const decodeSlug = (slug: string) => { try { return decodeURIComponent(slug); } catch { return slug; } };

export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: BUSINESS.name,
  ...(BUSINESS.legalName ? { legalName: BUSINESS.legalName } : {}),
  ...(BUSINESS.gstin ? { taxID: BUSINESS.gstin } : {}),
  url: BASE_URL,
  logo: `${BASE_URL}/favicon.svg`,
  email: BUSINESS.email,
  telephone: BUSINESS.phone,
  contactPoint: { '@type': 'ContactPoint', name: BUSINESS.owner, contactType: 'Customer support and grievances', email: BUSINESS.email, telephone: BUSINESS.phone, url: BUSINESS.phoneHref },
  address: { '@type': 'PostalAddress', streetAddress: 'S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR', addressLocality: 'Varanasi', addressRegion: 'Uttar Pradesh', postalCode: '221003', addressCountry: 'IN' },
};
export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org', '@type': 'WebSite', name: BUSINESS.name, url: `${BASE_URL}/`,
  description: `Digital products, independent creators and memberships on ${BUSINESS.name}.`,
  copyrightHolder: { '@type': 'Person', name: BUSINESS.owner },
  potentialAction: { '@type': 'SearchAction', target: `${BASE_URL}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
};
const breadcrumbs = (items: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: `${BASE_URL}${item.path}` })),
});
function basePage(path: string, title: string, description: string, extra: Partial<SEOPageData> = {}): SEOPageData {
  return { title: `${title} | ${BUSINESS.name}`, description, canonicalUrl: `${BASE_URL}${path}`, ogImage: DEFAULT_OG_IMAGE, ogImageAlt: `${title} at ${BUSINESS.name}`, ogType: 'website', noindex: false, statusCode: 200, jsonLd: [ORGANIZATION_JSON_LD], ...extra };
}
function notFound(path: string, subject = 'Page'): SEOPageData {
  return basePage(path, `${subject} not found`, `This page is unavailable. Explore the ${BUSINESS.name} collection of original digital products.`, { noindex: true, statusCode: 404, jsonLd: [] });
}
export function getSEOPageData(pathname: string, _searchParams: Record<string, string> = {}, products: typeof PRODUCTS = PRODUCTS): SEOPageData {
  const path = cleanPagePath(pathname);
  const activeProducts = activeSEOProducts(products);
  const privateRoute = PRIVATE_PAGE_PATHS.find(route => path === route || path.startsWith(`${route}/`));
  if (privateRoute) {
    const titles: Record<string, string> = { '/creator': 'Your storefront', '/memberships': 'Your memberships', '/admin': 'Manage store', '/account': 'Your account', '/account/orders': 'Your orders', '/account/downloads': 'Your downloads', '/account/settings': 'Account settings', '/checkout': 'Checkout', '/cart': 'Your cart', '/login': 'Sign in', '/register': 'Create an account', '/forgot-password': 'Reset your password', '/wishlist': 'Your wishlist', '/search': 'Search the collection' };
    return basePage(path, titles[path] || titles[privateRoute], `Sign in to manage your purchases, orders and downloads at ${BUSINESS.name}.`, { noindex: true, ogImageAlt: `${BUSINESS.name} account and purchases` });
  }
  if (path.startsWith('/store/') || path.startsWith('/creators/')) {
    const prefix = path.startsWith('/store/') ? '/store/' : '/creators/';
    const slug = decodeSlug(path.slice(prefix.length));
    if (!/^[a-z0-9][a-z0-9-]{2,49}$/i.test(slug)) return notFound(path, 'Creator');
    const product = activeProducts.find(item => (item.creatorSlug || 'booyahstudio') === slug);
    if (prefix === '/creators/' && slug !== 'booyahstudio' && !product) return notFound(path, 'Creator');
    const name = product?.sellerName || (slug === 'booyahstudio' ? BUSINESS.name : 'Creator storefront');
    return basePage(`/store/${encodeURIComponent(slug)}`, `${name} – Digital products`, `Explore digital products published by ${name} on ${BUSINESS.name}. Review the files, requirements and license before purchasing.`);
  }
  if (path.startsWith('/product/')) {
    const slug = decodeSlug(path.slice('/product/'.length));
    const product = activeProducts.find(item => item.slug.toLowerCase() === slug.toLowerCase() || item.id === slug);
    if (!product) return notFound(path, 'Product');
    const productPath = `/product/${encodeURIComponent(product.slug)}`;
    const image = product.image.startsWith('https://') ? product.image : product.image.startsWith('/') && !product.image.startsWith('//') ? `${BASE_URL}${product.image}` : DEFAULT_OG_IMAGE;
    const schema = {
      '@context': 'https://schema.org', '@type': 'Product', name: product.title, description: product.shortDescription, image: [image],
      brand: { '@type': 'Brand', name: product.sellerName || BUSINESS.name },
      ...(Number.isFinite(product.price) && product.price >= 0 ? { offers: { '@type': 'Offer', url: `${BASE_URL}${productPath}`, priceCurrency: 'INR', price: product.price, seller: { '@type': 'Organization', name: product.sellerName || BUSINESS.name } } } : {}),
    };
    return basePage(productPath, product.title, product.shortDescription, { ogImage: image, ogImageAlt: `${product.title} preview`, ogType: 'product', jsonLd: [ORGANIZATION_JSON_LD, breadcrumbs([{ name: 'Home', path: '/' }, { name: product.categoryLabel || 'The collection', path: `/category/${encodeURIComponent(product.category)}` }, { name: product.title, path: productPath }]), schema] });
  }
  if (path.startsWith('/category/')) {
    const slug = decodeSlug(path.slice('/category/'.length));
    const category = CATEGORIES.find(item => item.slug.toLowerCase() === slug.toLowerCase() || item.id === slug);
    const items = activeProducts.filter(item => item.category === (category?.slug || slug));
    if (!category && !items.length) return notFound(path, 'Category');
    const name = category?.name || items[0].categoryLabel;
    const categoryPath = `/category/${encodeURIComponent(category?.slug || slug)}`;
    return basePage(categoryPath, name, category?.description || `Explore original ${name.toLowerCase()} from ${BUSINESS.name}.`, { noindex: items.length === 0, jsonLd: [ORGANIZATION_JSON_LD, breadcrumbs([{ name: 'Home', path: '/' }, { name, path: categoryPath }])] });
  }
  const policyKey = path === '/policies' ? 'terms' : path.startsWith('/policies/') ? path.slice('/policies/'.length) : path.slice(1);
  const policy = policyData[POLICY_REDIRECTS[policyKey] || policyKey];
  if (policy) {
    const policyPath = `/policies/${policy.slug}`;
    return basePage(policyPath, policy.title, policy.quickSummary?.[0] || `${policy.title} for purchases at ${BUSINESS.name}.`, { ogType: 'article', jsonLd: [ORGANIZATION_JSON_LD, breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Policies', path: '/policies/terms' }, { name: policy.title, path: policyPath }])] });
  }
  const pages: Record<string, [string, string]> = {
    '/creators': ['Meet the creators', `Discover independent makers and explore their digital products and memberships on ${BUSINESS.name}.`],
    '/pricing': ['Create your storefront', `Start selling digital products on ${BUSINESS.name}. Explore creator plans, listing limits and membership options.`],
    '/products': ['All Templates & Digital Products', 'Explore original website templates and digital products. Check the included files, live demos, prices and license before choosing your next starting point.'],
    '/about': ['Our Story', `Meet ${BUSINESS.name}, a digital marketplace operated by MANISH KUMAR SONKAR in Varanasi, India. Original templates for your next idea.`],
    '/contact': ['Contact & Customer Support', `Contact MANISH KUMAR SONKAR at ${BUSINESS.name} for help with purchases, downloads and grievances. Email or WhatsApp support in Varanasi, India.`],
    '/faq': ['Help & Frequently Asked Questions', `Find answers about your ${BUSINESS.name} purchase, payment confirmation, downloads, license and support.`],
  };
  if (pages[path]) return basePage(path, ...pages[path], { jsonLd: [ORGANIZATION_JSON_LD, breadcrumbs([{ name: 'Home', path: '/' }, { name: pages[path][0], path }])] });
  if (path === '/') return basePage('/', `${BUSINESS.name} – Original Website Templates & Digital Products`, `Thoughtfully crafted digital products from ${BUSINESS.name} and independent creators. Explore the demos, find your fit and make your next idea your own.`, { title: `${BUSINESS.name} – Original Website Templates & Digital Products`, jsonLd: [ORGANIZATION_JSON_LD, WEBSITE_JSON_LD] });
  return notFound(path);
}

export function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
export function injectSEOMetadata(htmlShell: string, pageData: SEOPageData): string {
  let result = htmlShell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(pageData.title)}</title>`)
    .replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]*|twitter:[^"]*)"[\s\S]*?\/?>/gi, '')
    .replace(/<link rel="canonical"[^>]*>/gi, '')
    .replace(/<script(?:\s+[^>]*)?\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '');
  const tags = [
    `<meta name="description" content="${escapeHtml(pageData.description)}" />`,
    `<meta name="robots" content="${pageData.noindex ? 'noindex, nofollow' : 'index, follow'}" />`,
    `<link rel="canonical" href="${escapeHtml(pageData.canonicalUrl)}" />`,
    ...Object.entries({ type: pageData.ogType, site_name: BUSINESS.name, title: pageData.title, description: pageData.description, url: pageData.canonicalUrl, image: pageData.ogImage, 'image:alt': pageData.ogImageAlt }).map(([key, value]) => `<meta property="og:${key}" content="${escapeHtml(value)}" />`),
    ...Object.entries({ card: 'summary_large_image', title: pageData.title, description: pageData.description, image: pageData.ogImage, 'image:alt': pageData.ogImageAlt }).map(([key, value]) => `<meta name="twitter:${key}" content="${escapeHtml(value)}" />`),
    ...pageData.jsonLd.map(data => `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`),
  ];
  return result.replace('</head>', `${tags.join('\n    ')}\n  </head>`);
}
