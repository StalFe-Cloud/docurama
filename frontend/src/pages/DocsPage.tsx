import React, { useEffect, useMemo, useState } from 'react';
import { DOCS } from '../content/docs';
import { useLocalizedArticle, useCategoryLabel } from '../content/localize';
import { useI18n } from '../i18n';
import { Search, ArrowLeft, FileText, Clock } from 'lucide-react';

/**
 * Documentation hub + article reader (Sprint 8). Public route: /docs and
 * /docs/<slug>. Structured blocks render without a markdown dependency.
 */
export const DocsPage: React.FC<{ slug?: string; onNavigate?: (tab: string) => void }> = ({ slug, onNavigate }) => {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');

  const article = useMemo(() => DOCS.find((d) => d.slug === slug), [slug]);

  if (article) {
    return <ArticleView slug={article.slug} onBack={() => { window.history.pushState({}, '', '/docs'); onNavigate?.('docs'); }} />;
  }

  const categories = Array.from(new Set(DOCS.map((d) => d.category)));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? DOCS.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.blocks.some((b) => (b.p || '').toLowerCase().includes(q) || (b.h2 || '').toLowerCase().includes(q)),
      )
    : DOCS;

  return (
    <div className="space-y-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold text-[#1a1a1a]">{t('docs.title')}</h1>
        <p className="mt-2 text-sm text-[#5d5b54] leading-6">{t('docs.sub')}</p>
      </header>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-[#787671] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('docs.search')}
          aria-label={t('docs.search')}
          className="base-input w-full h-10 pl-9 pr-3 text-xs"
        />
      </div>

      {categories.map((cat) => {
        const items = filtered.filter((d) => d.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <CategoryHeading cat={cat} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((d) => (
                <DocCard key={d.slug} slug={d.slug} />
              ))}
            </div>
          </section>
        );
      })}
      {filtered.length === 0 && (
        <p className="text-sm text-[#787671] py-8 text-center">{lang === 'en' ? 'No articles match your search.' : t('docs.search')}</p>
      )}
    </div>
  );
};

const CategoryHeading: React.FC<{ cat: string }> = ({ cat }) => {
  const catLabel = useCategoryLabel();
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#787671] mb-2">{catLabel(cat)}</h2>
  );
};

const DocCard: React.FC<{ slug: string }> = ({ slug }) => {
  const base = DOCS.find((d) => d.slug === slug)!;
  const article = useLocalizedArticle(base);
  const { t } = useI18n();
  const catLabel = useCategoryLabel();
  return (
    <a
      href={`/docs/${slug}`}
      onClick={(e) => {
        e.preventDefault();
        window.history.pushState({}, '', `/docs/${slug}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
      className="group rounded-xl border border-[#e5e3df] bg-white p-4 hover:border-[#a4a097] hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">
        <FileText className="w-3.5 h-3.5" />
        {catLabel(article.category)}
      </div>
      <h3 className="mt-2 text-sm font-bold text-[#1a1a1a] group-hover:text-[#5645d4] transition-colors">{article.title}</h3>
      <p className="mt-1 text-xs text-[#5d5b54] leading-5 line-clamp-2">{article.description}</p>
      <p className="mt-2.5 text-[10px] text-[#787671] flex items-center gap-1">
        <Clock className="w-3 h-3" /> {article.minutes} {t('docs.min')}
      </p>
    </a>
  );
};

const ArticleView: React.FC<{ slug: string; onBack: () => void }> = ({ slug, onBack }) => {
  const base = DOCS.find((d) => d.slug === slug)!;
  const article = useLocalizedArticle(base);
  const { t } = useI18n();
  const catLabel = useCategoryLabel();

  useEffect(() => {
    document.title = `${article.title} — Docurama Docs`;
    return () => {
      document.title = 'Docurama: Secure Electronic Signatures';
    };
  }, [article.title]);

  return (
    <article className="max-w-3xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5645d4] hover:underline"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t('docs.back')}
      </button>
      <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">
        <FileText className="w-3.5 h-3.5" />
        {catLabel(article.category)}
      </div>
      <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-[#1a1a1a] text-balance">{article.title}</h1>
      <p className="mt-2 text-sm text-[#5d5b54] leading-6">{article.description}</p>
      <p className="mt-2 text-[11px] text-[#787671]">
        {t('docs.updated')} {article.updated} · {article.minutes} {t('docs.min')}
      </p>

      <div className="mt-6 space-y-5">
        {article.blocks.map((b, i) => (
          <div key={i}>
            {b.h2 && <h2 className="text-base font-bold text-[#1a1a1a] mb-1.5">{b.h2}</h2>}
            {b.p && (
              <p
                className="text-sm text-[#37352f] leading-7"
                dangerouslySetInnerHTML={{ __html: b.p }}
              />
            )}
            {b.list && (
              <ul className="mt-1 space-y-1.5">
                {b.list.map((li, li2) => (
                  <li key={li2} className="text-sm text-[#37352f] leading-6 flex gap-2">
                    <span className="text-[#5645d4] mt-px">•</span>
                    <span dangerouslySetInnerHTML={{ __html: li }} />
                  </li>
                ))}
              </ul>
            )}
            {b.callout && (
              <div className="mt-3 rounded-lg border border-[#e5e3df] bg-[#f6f5f4] px-4 py-3 text-xs text-[#37352f] leading-6">
                {b.callout}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
};
