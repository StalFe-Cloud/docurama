import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Separator. Use this instead of <hr> or bare border-t divs so
 * hairlines stay one consistent tone.
 */
export const Separator = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }
>(({ className, orientation = 'horizontal', ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    aria-orientation={orientation}
    className={cn(
      'shrink-0 bg-[#e5e3df]',
      orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
      className
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';
