import { PRODUCTS, CATEGORIES, COUPONS } from '../data/products';
import { Product, Category, Coupon, ProductType } from '../types';

export interface ProductFilters {
  category?: string;
  productType?: ProductType;
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sortBy?: 'popular' | 'newest' | 'price-low' | 'price-high' | 'rating' | 'featured';
  tag?: string;
}

export class ProductService {
  private static products: Product[] = PRODUCTS;
  private static coupons: Coupon[] = COUPONS;
  private static listeners = new Set<() => void>();
  private static refreshPromise: Promise<Product[]> | null = null;

  static getCatalogSnapshot(): Product[] {
    return this.products;
  }

  static subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static async refreshProducts(force = false): Promise<Product[]> {
    if (this.refreshPromise && !force) return this.refreshPromise;

    const request = (async () => {
      const response = await fetch('/api/products', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Product catalog returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (!payload?.success || !Array.isArray(payload.products)) {
        throw new Error('Product catalog returned an invalid response.');
      }

      this.products = payload.products as Product[];
      if (Array.isArray(payload.coupons)) this.coupons = payload.coupons;
      this.listeners.forEach((listener) => listener());
      return this.products;
    })();

    this.refreshPromise = request;

    try {
      return await request;
    } finally {
      if (this.refreshPromise === request) this.refreshPromise = null;
    }
  }

  static getAllProducts(): Product[] {
    return [...this.products];
  }

  static getProductBySlug(slug: string): Product | undefined {
    return this.products.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
  }

  static getProductById(id: string): Product | undefined {
    return this.products.find((p) => p.id === id);
  }

  static getFeaturedProducts(): Product[] {
    return this.products.filter((p) => p.isFeatured);
  }

  static getRecentProducts(): Product[] {
    return [...this.products].sort((a, b) => {
      const dateA = a.updatedAt || a.releasedAt ? new Date(a.updatedAt || a.releasedAt!).getTime() : 0;
      const dateB = b.updatedAt || b.releasedAt ? new Date(b.updatedAt || b.releasedAt!).getTime() : 0;
      return dateB - dateA;
    });
  }

  static getProductsByCategory(categorySlug: string): Product[] {
    if (categorySlug === 'all') return this.getAllProducts();
    return this.products.filter((p) => p.category === categorySlug);
  }

  static getProductsByType(type: ProductType): Product[] {
    return this.products.filter((p) => p.productType === type);
  }

  static getCategories(): Category[] {
    return CATEGORIES.map(category => ({ ...category, productCount: this.products.filter(product => product.category === category.id).length }));
  }

  static getCategoryBySlug(slug: string): Category | undefined {
    return CATEGORIES.find((c) => c.slug.toLowerCase() === slug.toLowerCase());
  }

  static getRelatedProducts(productId: string, limit = 3): Product[] {
    const current = this.getProductById(productId);
    if (!current) return this.products.slice(0, limit);
    return this.products.filter(
      (p) => p.id !== productId && (p.category === current.category || p.productType === current.productType || p.tags.some((t) => current.tags.includes(t)))
    ).slice(0, limit);
  }

  static searchProducts(filters: ProductFilters): { products: Product[]; total: number } {
    let list = [...this.products];

    // Search query matching title, description, category, tags
    if (filters.query && filters.query.trim() !== '') {
      const q = filters.query.toLowerCase().trim();
      list = list.filter((p) => {
        const titleMatch = p.title.toLowerCase().includes(q);
        const descMatch = p.description.toLowerCase().includes(q) || p.shortDescription.toLowerCase().includes(q);
        const catMatch = p.category.toLowerCase().includes(q) || p.categoryLabel.toLowerCase().includes(q);
        const tagsMatch = p.tags?.some((t) => t.toLowerCase().includes(q)) || false;
        const typeMatch = p.productType.toLowerCase().includes(q);
        const featureMatch = p.features?.some((f) => f.toLowerCase().includes(q)) || false;
        const includedMatch = p.whatsIncluded?.some((w) => w.toLowerCase().includes(q)) || false;
        const formatMatch = p.fileFormat?.toLowerCase().includes(q) || false;
        return titleMatch || descMatch || catMatch || tagsMatch || typeMatch || featureMatch || includedMatch || formatMatch;
      });
    }

    // Category filter
    if (filters.category && filters.category !== 'all') {
      list = list.filter((p) => p.category === filters.category);
    }

    // Product Type filter
    if (filters.productType) {
      list = list.filter((p) => p.productType === filters.productType);
    }

    // Tag filter
    if (filters.tag) {
      list = list.filter((p) => p.tags.includes(filters.tag!));
    }

    // Price range
    if (filters.minPrice !== undefined) {
      list = list.filter((p) => p.price >= filters.minPrice!);
    }
    if (filters.maxPrice !== undefined) {
      list = list.filter((p) => p.price <= filters.maxPrice!);
    }

    // Minimum rating filter
    if (filters.minRating !== undefined && filters.minRating > 0) {
      list = list.filter((p) => (p.rating || 5) >= filters.minRating!);
    }

    // Sorting
    if (filters.sortBy) {
      switch (filters.sortBy) {
        case 'featured':
        case 'popular':
          list.sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
          break;
        case 'newest':
          list.sort((a, b) => {
            const dateA = a.updatedAt || a.releasedAt ? new Date(a.updatedAt || a.releasedAt!).getTime() : 0;
            const dateB = b.updatedAt || b.releasedAt ? new Date(b.updatedAt || b.releasedAt!).getTime() : 0;
            return dateB - dateA;
          });
          break;
        case 'price-low':
          list.sort((a, b) => a.price - b.price);
          break;
        case 'price-high':
          list.sort((a, b) => b.price - a.price);
          break;
        case 'rating':
          list.sort((a, b) => (b.rating || 5) - (a.rating || 5));
          break;
        default:
          break;
      }
    }

    return {
      products: list,
      total: list.length,
    };
  }

  static getCoupon(code: string): Coupon | undefined {
    return this.coupons.find((c) => c.code.toUpperCase() === code.toUpperCase().trim() && c.active !== false && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now()));
  }
}
