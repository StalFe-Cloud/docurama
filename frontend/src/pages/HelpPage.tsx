import React, { useMemo, useState } from 'react';
import { KB_ITEMS } from '../content/kb';
import { useLocalizedFaq, useCategoryLabel } from '../content/localize';
import { useI18n } from '../i18n';
import { Search, LifeBuoy, ChevronDown } from 'lucide-react';

/** Public help center / knowledge base (Sprint 8). Route: /help. */
export const HelpPage: React.FC = () => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>('kb-015');
  const catLabel = useCategoryLabel();

  const categories = useMemo(() => Array.from(new Set(KB_ITEMS.map((k) => k.category))), []);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? KB_ITEMS.filter((k) => k.q.toLowerCase().includes(q) || k.a.toLowerCase().includes(q))
    : KB_ITEMS;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#f3f0fb] text-[#5645d4] flex items-center justify-center">
          <LifeBuoy className="w-6 h-6" />
        </div>
        <h1 className="mt-3 text-3xl font-bold text-[#1a1a1a]">{t('help.title')}</h1>
        <p className="mt-2 text-sm text-[#5d5b54]">{t('help.sub')}</p>
      </header>

      <div className="relative max-w-md mx-auto">
        <Search className="w-4 h-4 text-[#787671] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('help.search')}
          aria-label={t('help.search')}
          className="base-input w-full h-10 pl-9 pr-3 text-xs"
        />
      </div>

      {categories.map((cat) => {
        const items = filtered.filter((k) => k.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#787671] mb-2">{catLabel(cat)}</h2>
            <div className="divide-y divide-[#e5e3df] rounded-xl border border-[#e5e3df] bg-white overflow-hidden">
              {items.map((item) => (
                <FaqRow key={item.id} id={item.id} open={open === item.id} onToggle={() => setOpen(open === item.id ? null : item.id)} />
              ))}
            </div>
          </section>
        );
      })}
      {filtered.length === 0 && <p className="text-sm text-[#787671] py-6 text-center">—</p>}

      <div className="rounded-xl border border-[#e5e3df] bg-[#f6f5f4] p-5 text-center">
        <p className="text-sm font-semibold text-[#1a1a1a]">{t('help.cta')}</p>
        <a href="mailto:support@docurama.eu" className="btn btn-primary inline-flex mt-3 px-4 h-9 text-xs">
          support@docurama.eu
        </a>
      </div>
    </div>
  );
};

const FaqRow: React.FC<{ id: string; open: boolean; onToggle: () => void }> = ({ id, open, onToggle }) => {
  const base = KB_ITEMS.find((k) => k.id === id)!;
  const item = useLocalizedFaq(base);
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left text-sm font-semibold text-[#1a1a1a] hover:bg-[#fbfbfa] transition-colors"
        aria-expanded={open}
      >
        {item.q}
        <ChevronDown className={`w-4 h-4 text-[#787671] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="px-4 pb-4 text-xs text-[#5d5b54] leading-6">{item.a}</p>}
    </div>
  );
};
