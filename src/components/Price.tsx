import React from 'react';

interface PriceProps {
  price: number;
  originalPrice?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showDiscountBadge?: boolean;
  className?: string;
}

export const Price: React.FC<PriceProps> = ({
  price,
  originalPrice,
  size = 'md',
  showDiscountBadge = true,
  className = '',
}) => {
  const hasDiscount = originalPrice && originalPrice > price;
  const discountPercent = hasDiscount
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  const currentSizes = {
    sm: 'text-base font-black text-slate-900',
    md: 'text-xl font-black text-slate-900',
    lg: 'text-3xl font-black text-slate-900',
    xl: 'text-4xl sm:text-5xl font-black text-slate-900 tracking-tighter',
  };

  const originalSizes = {
    sm: 'text-xs text-slate-400',
    md: 'text-[13px] text-slate-400',
    lg: 'text-sm text-slate-400',
    xl: 'text-lg text-slate-400',
  };

  return (
    <div className={`inline-flex items-baseline gap-2.5 flex-wrap ${className}`}>
      <span className={currentSizes[size]}>₹{price.toLocaleString('en-IN')}</span>
      {hasDiscount && (
        <>
          <span
            className={`line-through font-medium ${originalSizes[size]}`}
            aria-label={`Original price: ₹${originalPrice.toLocaleString('en-IN')}`}
          >
            ₹{originalPrice.toLocaleString('en-IN')}
          </span>
          {showDiscountBadge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black bg-blue-50 text-blue-600 border border-blue-100 uppercase tracking-wider">
              {discountPercent}% OFF
            </span>
          )}
        </>
      )}
    </div>
  );
};
