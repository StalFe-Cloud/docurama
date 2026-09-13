import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Card composition. Full anatomy (Header/Title/Description/
 * Content/Footer) instead of dumping everything into one div, per the
 * upstream composition rules. 12px radius, hairline border, tinted shadow -
 * the Docurama container language.
 */
export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-[#e5e3df] bg-white text-[#1a1a1a] shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-3', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-sm font-semibold leading-5 text-[#1a1a1a]', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-xs text-[#787671] leading-5', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2 p-5 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';
