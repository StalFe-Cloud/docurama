import React, { useEffect, useState } from 'react';
import { trustApi } from '../lib/api';

/**
 * Public Trust Center.
 *
 * Renders exactly what GET /api/trust reports: factual security features, the
 * subprocessor registry, readiness states per framework, and the security
 * contact. There are no badges, no seals, no certification logos — the page
 * has none to show and does not invent any. The certifications array is
 * rendered as an honest empty state.
 */

interface TrustPayload {
  statement: string;
  certifications: string[];
  security_features: string[];
  readiness_by_framework: Record<string, { control_id: string; name: string; readiness: string }[]>;
  subprocessors: {
    id: string;
    name: string;
    purpose: string;
    data_location: string;
    status: string;
    url: string | null;
  }[];
  security_contact: string | null;
  security_txt: string;
  data_locations: string;
}

const readinessBadge = (state: string): string => {
  switch (state) {
    case 'Implemented':
      return 'bg-emerald-100 text-emerald-800';
    case 'Partial':
      return 'bg-amber-100 text-amber-800';
    case 'Missing':
      return 'bg-red-100 text-red-800';
    case 'Needs Review':
      return 'bg-sky-100 text-sky-800';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
};

export const TrustPage: React.FC = () => {
  const [payload, setPayload] = useState<TrustPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trustApi
      .get()
      .then(setPayload)
      .catch((e: Error) => setError(e.message));
  }, []);

  const frameworks = payload ? Object.entries(payload.readiness_by_framework) : [];

  return (
    <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] font-sans">
      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Trust Center</h1>
        <p className="mt-4 text-[15px] leading-7 text-[#5f5e5b] max-w-3xl">
          {payload?.statement ??
            'Loading the trust center…'}
        </p>

        {error && (
          <div className="mt-6 rounded-md bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Certifications: rendered as the empty state it is. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Certifications</h2>
          <p className="mt-2 text-sm text-[#5f5e5b] leading-6">
            None. Docurama holds no certifications and claims none. Readiness for each
            control is published below using four states: Implemented, Partial, Missing,
            Needs Review — with evidence drawn from the product's own source code,
            tests and configuration.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Security features</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {(payload?.security_features ?? []).map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm leading-6">
                <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
            {!payload && <li className="text-sm text-[#91918e]">Loading…</li>}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Control readiness</h2>
          <div className="mt-3 space-y-6">
            {frameworks.map(([framework, controls]) => (
              <div key={framework}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#91918e]">
                  {framework}
                </h3>
                <ul className="mt-2 divide-y divide-[#e9e7e4] rounded-md border border-[#e9e7e4] bg-white">
                  {controls.map((c) => (
                    <li key={c.control_id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <div>
                        <span className="font-mono text-xs text-[#91918e]">{c.control_id}</span>
                        <span className="ml-2 text-sm">{c.name}</span>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${readinessBadge(c.readiness)}`}>
                        {c.readiness}
                      </span>
                    </li>
                  ))}
                  {controls.length === 0 && (
                    <li className="px-4 py-2.5 text-sm text-[#91918e]">No controls published yet.</li>
                  )}
                </ul>
              </div>
            ))}
            {!payload && <p className="text-sm text-[#91918e]">Loading…</p>}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Subprocessors</h2>
          {payload && payload.subprocessors.length > 0 ? (
            <ul className="mt-3 divide-y divide-[#e9e7e4] rounded-md border border-[#e9e7e4] bg-white">
              {payload.subprocessors.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      s.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-700'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#5f5e5b]">{s.purpose}</p>
                  <p className="mt-0.5 text-xs text-[#91918e]">Data location: {s.data_location}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#5f5e5b]">
              Subprocessors are published here as they are engaged. {payload?.data_locations ?? ''}
            </p>
          )}
        </section>

        <section className="mt-10 border-t border-[#e9e7e4] pt-6">
          <h2 className="text-lg font-semibold">Report a security issue</h2>
          <p className="mt-2 text-sm leading-6 text-[#5f5e5b]">
            {payload?.security_contact ? (
              <>
                Contact us at{' '}
                <a className="text-blue-700 underline" href={`mailto:${payload.security_contact}`}>
                  {payload.security_contact}
                </a>
                . We acknowledge reports promptly and coordinate disclosure.
              </>
            ) : (
              <>The security contact is published in&nbsp;
                <a className="text-blue-700 underline" href={payload?.security_txt ?? '/.well-known/security.txt'}>
                  /.well-known/security.txt
                </a>&nbsp;once the operator configures it.
              </>
            )}
          </p>
        </section>
      </main>
    </div>
  );
};
