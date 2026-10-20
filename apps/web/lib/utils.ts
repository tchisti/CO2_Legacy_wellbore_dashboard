import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names (clsx) and resolves Tailwind conflicts so the last one wins (tailwind-merge).
 * This is the helper shadcn components expect; the app uses clsx + tailwind-merge, not the `cn` package.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
