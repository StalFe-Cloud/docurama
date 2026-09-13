import React from 'react';
import { cn } from '../../lib/cn';

/**
 * shadcn-style Badge for statuses and metadata.
 *
 * Status colors are semantic (success / warning / destructive / info) and map
 * to the Notion pastel property tints, keeping one accent (purple) reserved
 * for interactive affordances only. Use `neutral` for tags that carry no
 * judgement - avoid decorating everything.
 */
export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'primary';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-[#f0eeec] text-[#37352f] border-[#e5e3df]',
  success: 'bg-[#d9f3e1] text-[#116229] border-[#b8e6c6]',
  warning: 'bg-[#f9e79f] text-[#6b4e00] border-[#f0d878]',
  destructive: 'bg-[#ffe3e3] text-[#a02525] border-[#ffc9c9]',
  info: 'bg-[#dcecfa] text-[#005999] border-[#c2ddf5]',
  primary: 'bg-[#e6e0f5] text-[#3a2a99] border-[#d6b6f6]',
};

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'neutral', ...props }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap',
      variantClasses[variant],
      className
    )}
    {...props}
  />
);

/**
 * Envelope status -> badge variant. Single source of truth so the dashboard,
 * table, and detail drawer never disagree about what a status means.
 */
export function envelopeStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'sent':
    case 'delivered':
      return 'warning';
    case 'voided':
    case 'failed':
      return 'destructive';
    case 'draft':
      return 'neutral';
    default:
      return 'info';
  }
}

export function envelopeStatusLabel(status: string): string {
  switch (status) {
    case 'sent':
    case 'delivered':
      return 'Pending signers';
    case 'completed':
      return 'Completed';
    case 'voided':
      return 'Voided';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
