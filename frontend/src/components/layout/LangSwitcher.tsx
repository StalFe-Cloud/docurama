import React, { useEffect, useRef, useState } from 'react';
import { Globe, Check } from 'lucide-react';
import { LOCALES, LOCALE_LABELS, type Locale } from '../../i18n/locales';
import { useI18n } from '../../i18n';

/**
 * Compact locale picker for the header (Sprint 8). English, French, German,
 * Spanish at launch. Selection persists via the I18nProvider.
 */
export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-[#5d5b54] hover:text-[#1a1a1a] hover:bg-[#f6f5f4] transition-colors"
        aria-label="Language"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="uppercase">{lang}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 z-50 p-1.5 bg-white rounded-lg w-44 border border-[#e5e3df] shadow-notion-modal animate-in fade-in duration-100"
        >
          {LOCALES.map((l: Locale) => (
            <button
              key={l}
              role="menuitem"
              onClick={() => {
                setLang(l);
                setOpen(false);
              }}
              className={`w-full rounded-md py-1.5 px-2.5 text-xs flex items-center justify-between transition-colors ${
                l === lang ? 'bg-[#f3f0fb] text-[#5645d4] font-semibold' : 'text-[#37352f] hover:bg-[#f6f5f4]'
              }`}
            >
              {LOCALE_LABELS[l]}
              {l === lang && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
