import { Store } from './store';
import { mergeProductCatalog } from './productCatalog';
import { filterMarketplaceCatalog } from './creatorMarketplace';
import { PRODUCTS } from '../src/data/products';
import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getSEOPageData, injectSEOMetadata, POLICY_REDIRECTS, policyData } from '../src/seo/seoMetadata';
import { injectPublicPageContent } from '../src/seo/publicPages';
import { creatorSlugFromPath, getCreatorPath } from '../src/config/creatorRoutes';
import { getPublicCreatorProfiles } from './creatorPublicRouting';

let cachedIndexHtml: string | null = null;

function getIndexHtmlShell(): string {
  if (cachedIndexHtml) return cachedIndexHtml;

  const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
  const rootIndexPath = path.join(process.cwd(), 'index.html');

  if (fs.existsSync(distIndexPath)) {
    cachedIndexHtml = fs.readFileSync(distIndexPath, 'utf8');
  } else if (fs.existsSync(rootIndexPath)) {
    cachedIndexHtml = fs.readFileSync(rootIndexPath, 'utf8');
  } else {
    cachedIndexHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Booyahstudio</title></head><body><div id="root"></div></body></html>`;
  }

  return cachedIndexHtml;
}

export async function seoMiddleware(req: Request, res: Response, next: NextFunction) {
  // Vite must transform the development HTML and inject its module runtime.
  if (process.env.NODE_ENV !== 'production') return next();
  // Only process GET / HEAD requests for non-API, non-asset paths
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (/^\/api(?:\/|$)/i.test(req.path) || req.path.startsWith('/demos/') || req.path.startsWith('/product-images/') || req.path.includes('.')) {
    return next();
  }

  const cleanPath = req.path.split('?')[0].replace(/\/$/, '') || '/';
  const queryObj: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') queryObj[k] = v;
  }

  // Check for retired policy redirects
  const rootSlug = cleanPath.startsWith('/') ? cleanPath.slice(1) : '';
  const policyKey = cleanPath.startsWith('/policies/') ? cleanPath.slice('/policies/'.length) : rootSlug;
  const redirectTarget = cleanPath === '/policies' ? 'terms' : POLICY_REDIRECTS[policyKey] || (!cleanPath.startsWith('/policies/') && policyData[policyKey] ? policyKey : undefined);
  if (redirectTarget) {
    return res.redirect(301, `/policies/${redirectTarget}`);
  }

  // If request accepts HTML (direct browser/crawler visit)
  const acceptHeader = req.headers.accept || '';
  const isHtmlRequest = acceptHeader.includes('text/html') || acceptHeader.includes('*/*');

  if (!isHtmlRequest) {
    return next();
  }

  const creatorSlug = creatorSlugFromPath(cleanPath);
  const profiles = creatorSlug || cleanPath === '/creators' ? await getPublicCreatorProfiles() : [];
  if (creatorSlug && cleanPath !== getCreatorPath(creatorSlug) && profiles.some(profile => profile.slug === creatorSlug)) return res.redirect(301, getCreatorPath(creatorSlug));
  const catalogPage = cleanPath === '/' || cleanPath === '/products' || cleanPath === '/creators' || Boolean(creatorSlug) || cleanPath.startsWith('/product/') || cleanPath.startsWith('/category/');
  const products = await filterMarketplaceCatalog(catalogPage && process.env.SUPABASE_URL ? mergeProductCatalog(PRODUCTS, await Store.getAllProducts()) : PRODUCTS);
  const pageSEOData = getSEOPageData(cleanPath, queryObj, products, profiles);
  const shell = getIndexHtmlShell();
  const renderedHtml = injectPublicPageContent(injectSEOMetadata(shell, pageSEOData), cleanPath, products, profiles);

  const status = pageSEOData.statusCode || 200;
  if (pageSEOData.noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderedHtml);
}
