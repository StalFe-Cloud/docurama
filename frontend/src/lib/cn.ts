import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn-standard class combiner: clsx for conditional composition,
 * tailwind-merge so later utility classes win conflicts predictably.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
