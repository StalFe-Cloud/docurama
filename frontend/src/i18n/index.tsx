/**
 * Docurama i18n runtime (Sprint 8).
 *
 * A deliberately tiny provider: locale state in React context, persisted to
 * localStorage, mirrored onto <html lang> for screen readers and search
 * engines. `t()` falls back to English and then to the key itself, so a
 * missing translation can never blank the UI.
 *
 * Long-form content translations live in `src/content/i18n/<locale>.json`
 * (generated pipeline, vocabulary-guarded) and are looked up through
 * `ct()` - content-key lookups with the same English fallback.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICTIONARIES, LOCALES, type Locale } from './locales';

import contentFr from '../content/i18n/fr.json';
import contentDe from '../content/i18n/de.json';
import contentEs from '../content/i18n/es.json';

const STORAGE_KEY = 'docurama_lang';

const CONTENT_DICTS: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  fr: contentFr as Record<string, string>,
  de: contentDe as Record<string, string>,
  es: contentEs as Record<string, string>,
};

interface I18nValue {
  lang: Locale;
  setLang: (l: Locale) => void;
  /** UI chrome lookup. */
  t: (key: string) => string;
  /** Content lookup (docs/blog/kb/gallery fields); falls back to English. */
  ct: (key: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const detectInitialLocale = (): Locale => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && LOCALES.includes(stored)) return stored;
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase() as Locale;
    return LOCALES.includes(nav) ? nav : 'en';
  } catch {
    return 'en';
  }
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Locale>(() => detectInitialLocale());

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode: persistence is best-effort */
    }
  }, [lang]);

  const setLang = useCallback((l: Locale) => setLangState(l), []);

  const t = useCallback(
    (key: string) => DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key] ?? key,
    [lang],
  );

  const ct = useCallback(
    (key: string) => {
      if (lang === 'en') return DICTIONARIES.en[key] ?? key;
      const dict = CONTENT_DICTS[lang];
      return (dict && dict[key]) || DICTIONARIES.en[key] || key;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, ct }), [lang, setLang, t, ct]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Render-time safety: components outside the provider still resolve English.
    return {
      lang: 'en',
      setLang: () => undefined,
      t: (key: string) => DICTIONARIES.en[key] ?? key,
      ct: (key: string) => DICTIONARIES.en[key] ?? key,
    };
  }
  return ctx;
};
