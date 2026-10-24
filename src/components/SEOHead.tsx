import { useProductCatalog } from '../hooks/useProductCatalog';
import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { getSEOPageData } from '../seo/seoMetadata';

export const SEOHead: React.FC = () => {
  const products = useProductCatalog();
  const { currentPath, searchParams } = useApp();

  useEffect(() => {
    const queryObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === 'string') queryObj[k] = v;
    }

    const pageData = getSEOPageData(currentPath, queryObj, products);

    // Update document.title
    document.title = pageData.title;

    // Helper to update or create meta tags
    const updateMeta = (selector: string, attribute: string, value: string, attrName = 'name') => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        const nameVal = selector.replace('meta[name="', '').replace('meta[property="', '').replace('"]', '');
        el.setAttribute(attrName, nameVal);
        document.head.appendChild(el);
      }
      el.setAttribute(attribute, value);
    };

    // Helper to update or create link tag
    const updateCanonical = (href: string) => {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = href;
    };

    // Helper to update JSON-LD
    const updateJsonLd = (jsonData: object[]) => {
      document.querySelectorAll('script[type="application/ld+json"]:not(#json-ld-data)').forEach(node => node.remove());
      let script = document.querySelector('script#json-ld-data') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'json-ld-data';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonData);
    };

    // Apply Meta Tags
    updateMeta('meta[name="description"]', 'content', pageData.description);
    updateMeta('meta[name="robots"]', 'content', pageData.noindex ? 'noindex, nofollow' : 'index, follow');
    updateCanonical(pageData.canonicalUrl);

    // OpenGraph
    updateMeta('meta[property="og:type"]', 'content', pageData.ogType, 'property');
    updateMeta('meta[property="og:site_name"]', 'content', 'Booyahstudio', 'property');
    updateMeta('meta[property="og:title"]', 'content', pageData.title, 'property');
    updateMeta('meta[property="og:description"]', 'content', pageData.description, 'property');
    updateMeta('meta[property="og:url"]', 'content', pageData.canonicalUrl, 'property');
    updateMeta('meta[property="og:image"]', 'content', pageData.ogImage, 'property');
    updateMeta('meta[property="og:image:alt"]', 'content', pageData.ogImageAlt, 'property');

    // Twitter
    updateMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    updateMeta('meta[name="twitter:title"]', 'content', pageData.title);
    updateMeta('meta[name="twitter:description"]', 'content', pageData.description);
    updateMeta('meta[name="twitter:image"]', 'content', pageData.ogImage);
    updateMeta('meta[name="twitter:image:alt"]', 'content', pageData.ogImageAlt);

    // JSON-LD
    updateJsonLd(pageData.jsonLd);
  }, [currentPath, searchParams, products]);

  return null;
};
