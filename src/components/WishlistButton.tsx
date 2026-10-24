import React from 'react';
import { Heart } from 'lucide-react';
import { motion } from 'motion/react';
import { Product } from '../types';
import { useApp } from '../context/AppContext';

interface WishlistButtonProps {
  product: Product;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const WishlistButton: React.FC<WishlistButtonProps> = ({
  product,
  size = 'md',
  showLabel = false,
  className = '',
}) => {
  const { isInWishlist, toggleWishlist } = useApp();
  const isSaved = isInWishlist(product.id);

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const buttonPaddings = {
    sm: 'p-1.5 text-xs',
    md: 'p-2.5 text-sm',
    lg: 'p-3.5 text-base',
  };

  return (
    <motion.button
      id={`wishlist-btn-${product.id}`}
      whileTap={{ scale: 0.9 }}
      onClick={(e) => {
        e.stopPropagation();
        toggleWishlist(product);
      }}
      aria-label={isSaved ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`}
      className={`inline-flex items-center justify-center gap-2 rounded-xl transition-all border ${
        isSaved
          ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 shadow-sm'
          : 'bg-white/90 backdrop-blur-sm border-slate-200 text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 shadow-sm'
      } ${buttonPaddings[size]} ${className}`}
    >
      <motion.div
        animate={isSaved ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Heart
          className={`${iconSizes[size]} ${
            isSaved ? 'fill-rose-500 text-rose-500' : 'text-slate-500 hover:text-rose-500'
          }`}
        />
      </motion.div>
      {showLabel && (
        <span className="font-semibold">{isSaved ? 'Saved in Wishlist' : 'Add to Wishlist'}</span>
      )}
    </motion.button>
  );
};
