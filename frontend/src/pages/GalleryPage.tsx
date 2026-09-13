import React from 'react';
import { GALLERY_ITEMS } from '../content/gallery';
import { useLocalizedGalleryItem, useCategoryLabel } from '../content/localize';
import { useI18n } from '../i18n';
import { FileStack, ArrowRight } from 'lucide-react';

/**
 * Public template gallery (Sprint 8). Route: /templates-gallery (and /gallery).
 * Duplicating into the workspace requires sign-in — the CTA hands off to it.
 */
export const GalleryPage: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const catLabel = useCategoryLabel();
  const categories = Array.from(new Set(GALLERY_ITEMS.map((g) => g.category)));

  return (
    <div className="space-y-7">
      <header className="max-w-2xl">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">
          <FileStack className="w-3.5 h-3.5" /> {t('nav.gallery')}
        </div>
        <h1 className="mt-1.5 text-3xl font-bold text-[#1a1a1a]">{t('gallery.title')}</h1>
        <p className="mt-2 text-sm text-[#5d5b54] leading-6">{t('gallery.sub')}</p>
      </header>

      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#787671] mb-2">{catLabel(cat)}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {GALLERY_ITEMS.filter((g) => g.category === cat).map((item) => (
              <GalleryCard key={item.slug} slug={item.slug} onUse={() => onNavigate?.('signin')} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const GalleryCard: React.FC<{ slug: string; onUse: () => void }> = ({ slug, onUse }) => {
  const base = GALLERY_ITEMS.find((g) => g.slug === slug)!;
  const item = useLocalizedGalleryItem(base);
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-4 flex flex-col hover:border-[#a4a097] hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-[#1a1a1a]">{item.name}</h3>
        <span className="text-[10px] text-[#787671] tabular-nums shrink-0">
          {item.pages} pg · {item.fields} {t('gallery.fields')}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-[#5d5b54] leading-5">{item.description}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {item.roles.map((r) => (
          <span key={r} className="text-[10px] font-medium text-[#5645d4] bg-[#f3f0fb] rounded-full px-2 py-0.5">
            {r}
          </span>
        ))}
      </div>
      <button
        onClick={onUse}
        className="mt-3.5 btn btn-ghost h-8 text-xs justify-center border border-[#e5e3df] hover:border-[#5645d4] hover:text-[#5645d4] inline-flex items-center gap-1"
      >
        {t('gallery.use')} <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
