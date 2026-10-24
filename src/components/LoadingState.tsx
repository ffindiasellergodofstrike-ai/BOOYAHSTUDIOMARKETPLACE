import React from 'react';
import '../styles/catalog.css';
export const LoadingState: React.FC<{ rows?: number }> = ({ rows = 6 }) => <div className="catalog-grid" role="status" aria-label="Loading products"><span className="sr-only">Loading products…</span>{Array.from({ length: rows }).map((_, index) => <div key={index} className="catalog-skeleton" aria-hidden="true"><div className="catalog-skeleton-image" /><div className="catalog-skeleton-content"><i /><i /><i /><div><i /><i /></div></div></div>)}</div>;
