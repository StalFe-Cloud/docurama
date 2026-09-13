import React from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Empty state.
 *
 * A searched-empty or data-empty screen is a designed moment, not blank
 * space: icon, one plain-language sentence about what belongs here, and the
 * action that populates it. No exclamation marks, no "Oops".
 */
export const Empty: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#c8c4be] bg-[#fafaf9] p-10 text-center',
      className
    )}
    {...props}
  />
);

export const EmptyMedia: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'flex size-12 items-center justify-center rounded-xl bg-[#e6e0f5] text-[#5645d4] mb-1',
      className
    )}
    {...props}
  />
);

export const EmptyTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => <h3 className={cn('text-sm font-semibold text-[#1a1a1a]', className)} {...props} />;

export const EmptyDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...props
}) => <p className={cn('text-xs text-[#787671] max-w-sm leading-5', className)} {...props} />;

export const EmptyAction: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('mt-3', className)} {...props} />;
