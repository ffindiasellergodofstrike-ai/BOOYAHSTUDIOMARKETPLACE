import { PRODUCTS, CATEGORIES } from '../data/products';
import { BUSINESS } from '../config/business';
import { policyData, POLICY_REDIRECTS, SUPPORTED_POLICY_SLUGS } from '../data/policyData';
import { activeSEOProducts, BASE_URL, cleanPagePath, escapeHtml, getSEOPageData, PRIVATE_PAGE_PATHS } from './seoMetadata';

export function publicCanonicalPaths(products: typeof PRODUCTS = PRODUCTS): string[] {
  const paths = ['/', '/products', '/creators', '/creators/booyahstudio', '/pricing', '/about', '/contact', '/faq', ...SUPPORTED_POLICY_SLUGS.map(slug => `/policies/${slug}`), ...CATEGORIES.map(category => `/category/${category.slug}`), ...activeSEOProducts(products).map(product => `/product/${encodeURIComponent(product.slug)}`)];
  for (const product of activeSEOProducts(products)) { paths.push(`/category/${encodeURIComponent(product.category)}`); if (product.creatorSlug) paths.push(`/creators/${encodeURIComponent(product.creatorSlug)}`); }
  return [...new Set(paths)].filter(route => !getSEOPageData(route, {}, products).noindex);
}
export function renderSitemap(products: typeof PRODUCTS = PRODUCTS): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicCanonicalPaths(products).map(route => `  <url><loc>${escapeHtml(`${BASE_URL}${route}`)}</loc></url>`).join('\n')}\n</urlset>`;
}
export function renderRobots(): string {
  return `User-agent: *\n${[...PRIVATE_PAGE_PATHS, '/api/', '/.data/', '/demos/'].map(route => `Disallow: ${route}`).join('\n')}\n\nSitemap: ${BASE_URL}/sitemap.xml\n`;
}
const list = (items: string[]) => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
const productLinks = (products: typeof PRODUCTS) => `<ul>${products.map(product => `<li><a href="/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.title)}</a> — ₹${escapeHtml(product.price.toLocaleString('en-IN'))}<p>${escapeHtml(product.shortDescription)}</p></li>`).join('')}</ul>`;
const merchant = () => `<footer><p>${escapeHtml(BUSINESS.owner)} — Owner of ${escapeHtml(BUSINESS.name)}</p><address>${escapeHtml(BUSINESS.address)}</address><p>Customer support and grievances: <a href="mailto:${escapeHtml(BUSINESS.email)}">${escapeHtml(BUSINESS.email)}</a><br>WhatsApp: <a href="${escapeHtml(BUSINESS.phoneHref)}">${escapeHtml(BUSINESS.phone)}</a><br>Grievance contact: ${escapeHtml(BUSINESS.owner)}, at the same email and address.</p><nav aria-label="Policies">${SUPPORTED_POLICY_SLUGS.map(slug => `<a href="/policies/${slug}">${escapeHtml(policyData[slug].title)}</a>`).join(' · ')}</nav></footer>`;

/** Public, crawlable HTML only; never serializes an order, account or private asset URL. React replaces it on mount. */
export function renderPublicPageContent(pathname: string, products: typeof PRODUCTS = PRODUCTS): string {
  const path = cleanPagePath(pathname);
  if (PRIVATE_PAGE_PATHS.some(route => path === route || path.startsWith(`${route}/`))) return '';
  const activeProducts = activeSEOProducts(products);
  const page = getSEOPageData(path, {}, activeProducts);
  let body: string;
  if (page.statusCode === 404) body = '<h1>Page not found</h1><p>This page is unavailable. Explore the collection to find your next starting point.</p><a href="/products">Explore templates</a>';
  else if (path === '/creators') {
    const creators = new Map<string, string>([['booyahstudio', BUSINESS.name]]);
    for (const product of activeProducts) if (product.creatorSlug && product.sellerName) creators.set(product.creatorSlug, product.sellerName);
    body = `<h1>Good work. Thoughtful creators.</h1><p>Find digital goods from Booyahstudio and independent makers.</p><ul>${[...creators].map(([slug,name]) => `<li><a href="/creators/${encodeURIComponent(slug)}">${escapeHtml(name)}</a></li>`).join('')}</ul><a href="/creator">Create your storefront</a>`;
  } else if (path.startsWith('/creators/')) {
    const slug = decodeURIComponent(path.slice('/creators/'.length));
    const items = activeProducts.filter(product => (product.creatorSlug || 'booyahstudio') === slug);
    body = `<h1>${escapeHtml(items[0]?.sellerName || BUSINESS.name)}</h1><p>Explore this creator’s digital collection. See each listing for what’s included and the applicable license.</p>${productLinks(items)}`;
  } else if (path === '/pricing') body = '<h1>Make room for your next chapter.</h1><p>Create your storefront and share original digital products. Start with the free creator plan; available paid plans and membership prices are shown before checkout.</p><p>Paid plans start only after verified payment. Marketplace publication and payment collection require review and provider activation.</p><a href="/creator">Create your storefront</a><a href="/policies/terms">Creator terms</a>';
  else if (path.startsWith('/product/')) {
    const product = activeProducts.find(item => page.canonicalUrl === `${BASE_URL}/product/${encodeURIComponent(item.slug)}`)!;
    body = `<h1>${escapeHtml(product.title)}</h1><p>${escapeHtml(product.shortDescription)}</p><p>Price: ₹${escapeHtml(product.price.toLocaleString('en-IN'))} INR. One-time purchase.</p><p style="white-space:pre-line">${escapeHtml(product.description)}</p><h2>Features</h2>${list(product.features)}<h2>What’s included</h2>${list(product.whatsIncluded)}${product.requirements?.length ? `<h2>Requirements</h2>${list(product.requirements)}` : ''}${product.licenseTerms ? `<h2>License</h2><p>${escapeHtml(product.licenseTerms)}</p>` : ''}<p>Digital delivery: download the purchased files from your account after payment is confirmed. No physical shipping.</p><p><a href="/policies/refund">Read the refund and cancellation policy</a> before purchasing.</p>`;
  } else if (path.startsWith('/category/')) {
    const slug = decodeURIComponent(page.canonicalUrl.split('/category/')[1]);
    const items = activeProducts.filter(product => product.category === slug);
    const name = CATEGORIES.find(category => category.slug === slug)?.name || items[0]?.categoryLabel || 'The collection';
    body = `<h1>${escapeHtml(name)}</h1><p>${escapeHtml(page.description)}</p>${productLinks(items)}`;
  } else {
    const policyKey = path === '/policies' ? 'terms' : path.startsWith('/policies/') ? path.slice('/policies/'.length) : path.slice(1);
    const policy = policyData[POLICY_REDIRECTS[policyKey] || policyKey];
    if (policy) body = `<p>${escapeHtml(policy.subtitle)}</p><h1>${escapeHtml(policy.title)}</h1>${policy.sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2><p style="white-space:pre-line">${escapeHtml(section.content)}</p></section>`).join('')}`;
    else if (path === '/' || path === '/products') body = `<h1>${path === '/' ? 'Your next big idea. A better head start.' : 'Original templates for your next idea.'}</h1><p>Thoughtfully crafted website templates and digital products, from Booyahstudio and independent creators. Explore the details and demos, check the included files and license, then make something your own.</p><p>Your files are available in your account after payment is confirmed. No physical shipping.</p>${productLinks(activeProducts)}`;
    else if (path === '/about') body = `<h1>Good things start with a little care.</h1><p>${escapeHtml(BUSINESS.name)} is a digital marketplace operated by ${escapeHtml(BUSINESS.owner)} in Varanasi, India. Our original templates and digital products help you bring your next project to life.</p><p>Every listing describes the files, requirements, price and license included with your purchase. Please review these details before buying.</p><a href="/products">Explore the collection</a>`;
    else if (path === '/contact') body = '<h1>A little help, right this way.</h1><p>Contact us about a product, order, download or grievance using the details below. For an order question, include your order number and the email used at checkout.</p><a href="/faq">Browse helpful answers</a>';
    else body = '<h1>A few helpful answers.</h1><h2>Where are my files?</h2><p>After payment is confirmed, sign in and open your account’s Downloads section. Your order email also links to your downloads.</p><h2>What is included?</h2><p>Check each product listing for the included files, requirements, demo and license.</p><h2>Can I request a refund?</h2><p>Review our refund and cancellation policy for digital purchases, legitimate exceptions and the request process.</p><a href="/policies/refund">Refund and cancellation policy</a><h2>Need help?</h2><a href="/contact">Contact support</a>';
  }
  return `<main style="max-width:1100px;margin:0 auto;padding:32px 20px;font:16px/1.7 system-ui,sans-serif;color:#242923;background:#faf9f6"><nav aria-label="Main navigation"><a href="/">${escapeHtml(BUSINESS.name)}</a> · <a href="/products">Explore</a> · <a href="/creators">Creators</a> · <a href="/pricing">Start selling</a> · <a href="/about">Our story</a> · <a href="/contact">Support</a></nav>${body}${merchant()}<noscript><p>Enable JavaScript to sign in, purchase and manage your downloads.</p></noscript></main>`;
}
export function injectPublicPageContent(shell: string, pathname: string, products: typeof PRODUCTS = PRODUCTS): string {
  return shell.replace(/<div id="root">[\s\S]*?<\/div>(?=\s*<script|\s*<\/body>)/, `<div id="root">${renderPublicPageContent(pathname, products)}</div>`);
}
