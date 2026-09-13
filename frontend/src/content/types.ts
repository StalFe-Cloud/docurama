/**
 * Content model for the marketing hub (Sprint 8).
 *
 * Structured blocks instead of raw markdown: renderable without a markdown
 * dependency, and every translatable string has a stable key so the
 * translation pipeline can address fields precisely.
 */

export interface Block {
  /** Section heading. */
  h2?: string;
  /** Paragraph - may contain basic <strong>/<code> inline markup. */
  p?: string;
  /** Bullet list. */
  list?: string[];
  /** Highlighted callout box. */
  callout?: string;
}

export interface Article {
  slug: string;
  category: string;
  title: string;
  description: string;
  minutes: number;
  /** ISO date of last substantive update. */
  updated: string;
  blocks: Block[];
}

export interface BlogPost {
  slug: string;
  tag: string;
  title: string;
  description: string;
  date: string;
  minutes: number;
  featured?: boolean;
  blocks: Block[];
}

export interface FaqItem {
  id: string;
  category: string;
  q: string;
  a: string;
}

export interface GalleryItem {
  slug: string;
  name: string;
  category: string;
  description: string;
  fields: number;
  pages: number;
  /** Typical signing order, shown as chips. */
  roles: string[];
}

export type Locale = 'en' | 'fr' | 'de' | 'es';
