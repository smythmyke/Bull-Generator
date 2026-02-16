import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => (
  <div className={cn('skeleton', className)} />
);

export const SearchResultSkeleton: React.FC = () => (
  <div className="space-y-3 p-4 border rounded-lg">
    <Skeleton className="h-4 w-24" />
    <Skeleton className="h-16 w-full" />
    <div className="flex justify-end">
      <Skeleton className="h-8 w-16" />
    </div>
  </div>
);
