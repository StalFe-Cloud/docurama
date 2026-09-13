import React, { useMemo, useState } from 'react';
import { LEGAL_DOCS, LEGAL_ENTITY, type LegalDoc } from '../content/legal';
import { ChevronDown } from 'lucide-react';

/**
 * Public legal pages: Terms of Service, Privacy Notice, DPA, Imprint.
 * One route, four documents, honest about what exists — registration
 * identifiers appear only once they are real (see content/legal.ts).
 */
export const LegalPage: React.FC<{ initialDoc?: LegalDoc['id'] }> = ({ initialDoc }) => {
  const [docId, setDocId] = useState<LegalDoc['id']>(initialDoc ?? 'terms');
  const doc = useMemo(() => LEGAL_DOCS.find((d) => d.id === docId) ?? LEGAL_DOCS[0], [docId]);
  const [openSection, setOpenSection] = useState<string | null>(null);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-[#1a1a1a]">Legal</h1>
        <p className="mt-2 text-sm text-[#5d5b54]">
          {LEGAL_ENTITY.brand} — a product of {LEGAL_ENTITY.product_of} ·{' '}
          {LEGAL_ENTITY.address_lines.join(', ')}
        </p>
      </header>

      <nav aria-label="Legal documents" className="flex flex-wrap justify-center gap-2">
        {LEGAL_DOCS.map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={docId === d.id}
            onClick={() => { setDocId(d.id); setOpenSection(null); }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              docId === d.id
                ? 'bg-[#5645d4] text-white border-[#5645d4] shadow-sm'
                : 'bg-white text-[#37352f] border-[#e5e3df] hover:border-[#a4a097]'
            }`}
          >
            {d.title}
          </button>
        ))}
      </nav>

      <article className="rounded-xl border border-[#e5e3df] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e5e3df] flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1a1a1a]">{doc.title}</h2>
          <span className="text-[11px] text-[#787671]">{doc.updated}</span>
        </div>
        <div className="divide-y divide-[#e5e3df]">
          {doc.sections.map((s) => {
            const open = openSection === s.h;
            return (
              <div key={s.h}>
                <button
                  onClick={() => setOpenSection(open ? null : s.h)}
                  className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left text-sm font-semibold text-[#1a1a1a] hover:bg-[#fbfbfa] transition-colors"
                  aria-expanded={open}
                >
                  {s.h}
                  <ChevronDown
                    className={`w-4 h-4 text-[#787671] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="px-5 pb-4 space-y-2.5">
                    {s.ps.map((p, i) => (
                      <p key={i} className="text-xs text-[#5d5b54] leading-6">{p}</p>
                    ))}
                    {s.list && (
                      <ul className="text-xs text-[#5d5b54] leading-6 list-disc pl-4 space-y-1">
                        {s.list.map((li, i) => <li key={i}>{li}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
};
