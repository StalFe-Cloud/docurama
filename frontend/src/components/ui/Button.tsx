import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Button primitive.
 *
 * Docurama visual language: sober 8px rectangles (never pills), purple as the
 * single interactive accent, tinted shadows instead of pure black. Variants
 * mirror the legacy .btn-* CSS classes so both systems render identically
 * while pages migrate over.
 *
 * Icons: pass as children with `data-icon="inline-start" | "inline-end"`.
 * Loading: compose with a spinner + disabled - there is no `isLoading` prop,
 * matching the upstream shadcn rule.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'onDark';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  destructive: 'bg-[#c92a2a] !border-[#c92a2a] text-white hover:bg-[#b02525]',
  onDark: 'btn-on-dark',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
  icon: 'h-9 w-9 p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn('btn', variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
