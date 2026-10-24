import React from 'react';
import { Star } from 'lucide-react';

interface RatingProps {
  score: number;
  reviewCount?: number;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
}

export const Rating: React.FC<RatingProps> = ({
  score,
  reviewCount,
  size = 'sm',
  showCount = true,
}) => {
  const starSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className="inline-flex items-center gap-1.5" aria-label={`Rating: ${score} out of 5 stars`}>
      <div className="flex items-center gap-0.5 text-amber-500">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= Math.floor(score);
          const half = !filled && star === Math.ceil(score) && score % 1 >= 0.5;

          return (
            <Star
              key={star}
              className={`${starSizes[size]} ${
                filled
                  ? 'fill-amber-400 text-amber-400'
                  : half
                  ? 'fill-amber-400/50 text-amber-400'
                  : 'fill-slate-200 text-slate-300'
              }`}
            />
          );
        })}
      </div>
      <span className={`font-semibold text-slate-800 ${textSizes[size]}`}>
        {score.toFixed(1)}
      </span>
      {showCount && reviewCount !== undefined && (
        <span className={`text-slate-600 ${textSizes[size]}`}>
          ({reviewCount})
        </span>
      )}
    </div>
  );
};
