import { customerProductFaqs, customerProductDescription } from '../src/data/customerProductCopy';
import { normalizeProductPreviewUrl } from './productPreview';

const HIDDEN_PRODUCT_STATUSES = new Set(['archived', 'draft', 'inactive']);

export function isBrowserSafeAssetUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const url = value.trim();
  return (url.startsWith('/') && !url.startsWith('//')) || /^https:\/\//i.test(url);
}

function normalizeGallery(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isBrowserSafeAssetUrl);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

export function normalizeProductAssets(product: any, fallback?: any): any {
  const safeImage = isBrowserSafeAssetUrl(product?.image)
    ? product.image.trim()
    : isBrowserSafeAssetUrl(fallback?.image)
      ? fallback.image.trim()
      : '';

  const productGallery = normalizeGallery(product?.gallery);
  const fallbackGallery = normalizeGallery(fallback?.gallery);

  const normalized = {
    ...product,
    title: typeof product?.title === 'string' && product.title.trim()
      ? product.title.trim()
      : String(product?.id || 'Untitled Product'),
    slug: typeof product?.slug === 'string' && product.slug ? product.slug : product?.id,
    shortDescription: typeof product?.shortDescription === 'string' ? product.shortDescription : '',
    description: customerProductDescription(product?.description),
    category: typeof product?.category === 'string' && product.category ? product.category : 'other',
    categoryLabel: typeof product?.categoryLabel === 'string' && product.categoryLabel
      ? product.categoryLabel
      : product?.category || 'Digital Product',
    productType: typeof product?.productType === 'string' && product.productType
      ? product.productType
      : 'DOWNLOAD',
    price: Number.isFinite(Number(product?.price))
      ? Number(product.price)
      : Number(fallback?.price || 0),
    image: safeImage,
    gallery: productGallery.length > 0 ? productGallery : fallbackGallery,
    tags: normalizeStringArray(product?.tags),
    features: normalizeStringArray(product?.features),
    requirements: normalizeStringArray(product?.requirements),
    whatsIncluded: normalizeStringArray(product?.whatsIncluded),
    faqs: customerProductFaqs(product?.faqs),
    previewUrl: normalizeProductPreviewUrl(product?.previewUrl, product?.id)
      || normalizeProductPreviewUrl(fallback?.previewUrl, fallback?.id),
  };

  delete normalized.licenseTypes;
  normalized.licenseTerms = typeof product?.licenseTerms === 'string' ? product.licenseTerms : '';
  delete normalized.extendedPrice;
  return normalized;
}

export function mergeProductCatalog(staticProducts: any[], databaseProducts: any[]): any[] {
  const catalog = new Map<string, any>();

  for (const product of staticProducts || []) {
    if (!product?.id || typeof product.id !== 'string') continue;
    catalog.set(product.id, normalizeProductAssets(product));
  }

  for (const databaseProduct of databaseProducts || []) {
    if (!databaseProduct?.id || typeof databaseProduct.id !== 'string') continue;
    const staticProduct = catalog.get(databaseProduct.id);
    const merged = staticProduct
      ? { ...staticProduct, ...databaseProduct }
      : { ...databaseProduct };
    catalog.set(databaseProduct.id, normalizeProductAssets(merged, staticProduct));
  }

  return Array.from(catalog.values()).filter((product) => {
    const status = String(product.status || 'active').toLowerCase();
    return !HIDDEN_PRODUCT_STATUSES.has(status);
  });
}
