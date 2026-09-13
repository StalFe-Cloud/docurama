/**
 * Content localization helpers (Sprint 8).
 *
 * Every translatable field in the content corpus has a stable key
 * (`doc.<slug>.b<index>.<field>` etc). The `useLocalized*` hooks resolve
 * those keys through the i18n content dictionary and fall back to the
 * English source when a locale string is missing - a half-translated
 * corpus degrades to English per field, never to an empty string.
 */
import { useI18n } from '../i18n';
import type { Article, Block, BlogPost, FaqItem, GalleryItem } from './types';

const keyOf = (...parts: (string | number)[]) => parts.join('.');

/**
 * Resolve a content key through the locale dictionary with a safe fallback:
 * a missing translation returns the KEY itself from the i18n runtime, which
 * must never leak into the UI - treat "value === key" as missing and use the
 * English source instead.
 */
const resolve = (ct: (k: string) => string, key: string, fallback: string): string => {
  const v = ct(key);
  return !v || v === key ? fallback : v;
};

function localizedBlock(
  base: Block,
  keys: string[],
  ct: (k: string) => string,
): Block {
  const out: Block = {};
  if (base.h2 !== undefined) out.h2 = resolve(ct, keys[0], base.h2);
  if (base.p !== undefined) out.p = resolve(ct, keys[1], base.p);
  if (base.list !== undefined) {
    out.list = base.list.map((item, li) => resolve(ct, `${keys[2]}.${li}`, item));
  }
  if (base.callout !== undefined) out.callout = resolve(ct, keys[3], base.callout);
  return out;
}

export function useLocalizedArticle(article: Article): Article {
  const { ct } = useI18n();
  return {
    ...article,
    title: resolve(ct, keyOf('doc', article.slug, 'title'), article.title),
    description: resolve(ct, keyOf('doc', article.slug, 'description'), article.description),
    blocks: article.blocks.map((b, i) =>
      localizedBlock(b, [
        keyOf('doc', article.slug, 'b', i, 'h2'),
        keyOf('doc', article.slug, 'b', i, 'p'),
        keyOf('doc', article.slug, 'b', i, 'list'),
        keyOf('doc', article.slug, 'b', i, 'callout'),
      ], ct),
    ),
  };
}

export function useLocalizedPost(post: BlogPost): BlogPost {
  const { ct } = useI18n();
  return {
    ...post,
    title: resolve(ct, keyOf('blog', post.slug, 'title'), post.title),
    description: resolve(ct, keyOf('blog', post.slug, 'description'), post.description),
    blocks: post.blocks.map((b, i) =>
      localizedBlock(b, [
        keyOf('blog', post.slug, 'b', i, 'h2'),
        keyOf('blog', post.slug, 'b', i, 'p'),
        keyOf('blog', post.slug, 'b', i, 'list'),
        keyOf('blog', post.slug, 'b', i, 'callout'),
      ], ct),
    ),
  };
}

export function useLocalizedFaq(item: FaqItem): FaqItem {
  const { ct } = useI18n();
  return {
    ...item,
    q: resolve(ct, keyOf('kb', item.id, 'q'), item.q),
    a: resolve(ct, keyOf('kb', item.id, 'a'), item.a),
  };
}

export function useLocalizedGalleryItem(item: GalleryItem): GalleryItem {
  const { ct } = useI18n();
  return {
    ...item,
    name: resolve(ct, keyOf('tpl', item.slug, 'name'), item.name),
    description: resolve(ct, keyOf('tpl', item.slug, 'description'), item.description),
    roles: item.roles.map((r, i) => resolve(ct, keyOf('tpl', item.slug, 'role', i), r)),
  };
}

/**
 * Category / tag labels come from the chrome dictionaries (key exists in
 * every locale by design). Unknown future categories fall back to the raw
 * English string instead of leaking a key into the UI.
 */
export function useCategoryLabel(): (cat: string) => string {
  const { t } = useI18n();
  return (cat: string) => {
    const key = 'cat.' + cat.toLowerCase().replace(/\s+/g, '-');
    const v = t(key);
    return v === key ? cat : v;
  };
}

export function useBlogTagLabel(): (tag: string) => string {
  const { t } = useI18n();
  return (tag: string) => {
    const key = 'blogtag.' + tag.toLowerCase().replace(/\s+/g, '-');
    const v = t(key);
    return v === key ? tag : v;
  };
}
