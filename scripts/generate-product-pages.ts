import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { PRODUCTS, CATEGORIES } from '../src/data/products';
import { getSEOPageData, injectSEOMetadata } from '../src/seo/seoMetadata';
import { injectPublicPageContent, publicCanonicalPaths, renderRobots, renderSitemap } from '../src/seo/publicPages';

async function markDemosNoindex(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await markDemosNoindex(location);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(location, 'utf8');
      const clean = html.replace(/<meta\s+name=["']robots["'][^>]*>/gi, '');
      await writeFile(location, clean.replace(/<\/head>/i, '<meta name="robots" content="noindex, nofollow" />\n</head>'));
    }
  }
}
async function generateBuildAssets() {
  const shell = await readFile('dist/index.html', 'utf8');
  const publicRoutes = publicCanonicalPaths(PRODUCTS);
  const routes = [...new Set([...publicRoutes, ...CATEGORIES.map(category => `/category/${category.slug}`), '/search', '/wishlist', '/cart', '/checkout', '/account', '/creator', '/memberships', '/login', '/register', '/forgot-password', '/admin'])];
  for (const route of routes) {
    const pageData = getSEOPageData(route);
    const renderedHtml = injectPublicPageContent(injectSEOMetadata(shell, pageData), route);
    if (route === '/') await writeFile('dist/index.html', renderedHtml);
    else {
      const directory = `dist${route}`;
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/index.html`, renderedHtml);
    }
  }
  // Vercel serves filesystem files before rewrites. Keep only a private audit snapshot
  // so /sitemap.xml always reaches the live catalog endpoint after deployment.
  await mkdir('build', { recursive: true });
  await writeFile('build/sitemap.xml', renderSitemap(PRODUCTS));
  await rm('dist/sitemap.xml', { force: true });
  await writeFile('dist/robots.txt', renderRobots());
  await markDemosNoindex('dist/demos');
  console.log(`Successfully pre-rendered readable HTML and metadata for ${publicRoutes.length} public canonical pages, plus private noindex pages and robots.txt. Sitemap audit snapshot is build/sitemap.xml; /sitemap.xml uses the live catalog endpoint.`);
}
generateBuildAssets().catch(error => { console.error('Error generating pre-rendered build assets:', error); process.exit(1); });
