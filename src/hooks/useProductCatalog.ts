import { useEffect, useSyncExternalStore } from 'react';
import { ProductService } from '../services/ProductService';

export function useProductCatalog() {
  const products = useSyncExternalStore(
    (listener) => ProductService.subscribe(listener),
    () => ProductService.getCatalogSnapshot(),
    () => ProductService.getCatalogSnapshot()
  );

  useEffect(() => {
    void ProductService.refreshProducts().catch(() => {
      // Keep the bundled catalog available when the API is temporarily offline.
    });
  }, []);

  return products;
}
