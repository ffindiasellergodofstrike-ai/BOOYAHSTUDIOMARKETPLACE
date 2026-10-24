import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductService } from '../services/ProductService';

/** Keep the saved collection usable while a real catalog request is in flight. */
export function useCatalogRefresh() {
  const mounted = useRef(true);
  const [refreshing, setRefreshing] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const retry = useCallback(async () => {
    if (mounted.current) setRefreshing(true);
    try {
      await ProductService.refreshProducts();
      if (mounted.current) setUnavailable(false);
    } catch {
      if (mounted.current) setUnavailable(true);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void retry();
    window.addEventListener('online', retry);
    return () => { mounted.current = false; window.removeEventListener('online', retry); };
  }, [retry]);
  return { refreshing, unavailable, retry };
}
