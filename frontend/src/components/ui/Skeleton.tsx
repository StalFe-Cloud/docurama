import React from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Skeleton loading placeholder.
 *
 * Skeletons must match the shape of the content they stand in for, so callers
 * compose them from the same layout primitives as the real screen. Never use a
 * bare spinner where the final layout is already known.
 */
export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    aria-hidden="true"
    className={cn('animate-pulse rounded-lg bg-[#eceae6]', className)}
    {...props}
  />
);

/** Row-shaped skeleton for the submissions ledger while envelopes load. */
export const TableRowSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} className="border-t border-[#f1f5f9]">
        <td className="py-4 px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        </td>
        <td className="py-4 px-4">
          <Skeleton className="h-5 w-24 rounded-md" />
        </td>
        <td className="py-4 px-4">
          <Skeleton className="h-2.5 w-24 rounded-full" />
        </td>
        <td className="py-4 px-4">
          <Skeleton className="h-3 w-16" />
        </td>
        <td className="py-4 px-6">
          <div className="flex justify-end gap-1.5">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="size-7 rounded-lg" />
          </div>
        </td>
      </tr>
    ))}
  </>
);

/** Card-shaped skeleton for the templates grid. */
export const TemplateCardSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="p-5 rounded-xl border border-[#e5e3df] bg-white shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]"
      >
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-4 w-14 rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="mt-5 pt-3 border-t border-[#f1f5f9] flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
      </div>
    ))}
  </>
);
