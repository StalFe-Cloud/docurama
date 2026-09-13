import React, { useCallback, useEffect, useState } from 'react';
import { complianceApi, ComplianceControl } from '../lib/api';

/**
 * Compliance dashboard (platform-admin gated server-side).
 *
 * One screen, six honest panels:
 *  - overview: readiness counts per framework, DSAR queue, open incidents,
 *    audit-chain integrity;
 *  - controls: the readiness catalog with the four-state vocabulary and the
 *    evidence each control cites;
 *  - DSAR queue: create, run, cancel export/erasure requests;
 *  - incidents: the GDPR 72-hour clock, overdue in red;
 *  - subprocessors: the registry the trust center publishes;
 *  - change control (ISO-09): the four-eyes workflow with visible gaps;
 *  - vendor reviews (SOC2-03): questionnaire register with overdue flags.
 *
 * The vocabulary guardrail lives in the UI too: readiness badges only ever
 * show the four legal states, and there is no "certified" badge anywhere.
 */

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

const stateBadge = (state: string): string => {
  switch (state) {
    case 'queued':
      return 'bg-neutral-100 text-neutral-700';
    case 'processing':
      return 'bg-sky-100 text-sky-800';
    case 'completed':
      return 'bg-emerald-100 text-emerald-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'cancelled':
      return 'bg-neutral-100 text-neutral-500';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
};

const changeStatusBadge = (status: string): string => {
  switch (status) {
    case 'proposed':
      return 'bg-amber-100 text-amber-800';
    case 'approved':
      return 'bg-sky-100 text-sky-800';
    case 'implemented':
      return 'bg-emerald-100 text-emerald-800';
    case 'rejected':
      return 'bg-neutral-100 text-neutral-500';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
};

const vendorOutcomeBadge = (outcome: string): string => {
  switch (outcome) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-800';
    case 'conditional':
      return 'bg-amber-100 text-amber-800';
    case 'rejected':
      return 'bg-red-100 text-red-800';
    case 'pending':
      return 'bg-neutral-100 text-neutral-700';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
};

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-[#e9e7e4] bg-white p-4">
    <h3 className="text-sm font-semibold text-[#91918e] uppercase tracking-wide">{title}</h3>
    <div className="mt-3">{children}</div>
  </div>
);

export const CompliancePage: React.FC = () => {
  const [overview, setOverview] = useState<any>(null);
  const [controls, setControls] = useState<ComplianceControl[]>([]);
  const [dsar, setDsar] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [subprocessors, setSubprocessors] = useState<any[]>([]);
  const [chains, setChains] = useState<any>(null);
  const [changes, setChanges] = useState<any>(null);
  const [vendors, setVendors] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dsarEmail, setDsarEmail] = useState('');
  const [dsarKind, setDsarKind] = useState('export');
  const [chgTitle, setChgTitle] = useState('');
  const [chgDesc, setChgDesc] = useState('');
  const [chgType, setChgType] = useState('normal');

  const refresh = useCallback(async () => {
    try {
      const [ov, ct, ds, inc, sub, ch, cg, vd] = await Promise.all([
        complianceApi.overview(),
        complianceApi.controls(),
        complianceApi.listDsar(),
        complianceApi.incidents(),
        complianceApi.subprocessors(),
        complianceApi.verifyChains('security'),
        complianceApi.listChanges(),
        complianceApi.listVendors(),
      ]);
      setOverview(ov);
      setControls(ct);
      setDsar(ds);
      setIncidents(inc);
      setSubprocessors(sub);
      setChains(ch);
      setChanges(cg);
      setVendors(vd);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const frameworks = overview ? Object.entries(overview.controls?.by_framework ?? {}) : [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
          <p className="mt-1 text-sm text-[#5f5e5b]">
            Readiness vocabulary: Implemented · Partial · Missing · Needs Review. No certification
            is claimed anywhere on this page.
          </p>
        </div>
        <button
          className="rounded-md bg-[#37352f] text-white text-sm px-3 py-1.5 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => run('seal', () => complianceApi.sealChain())}
        >
          {busy === 'seal' ? 'Sealing…' : 'Seal audit chain'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Overview */}
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Card title="Audit chain">
          {chains ? (
            <div>
              <p className={`text-2xl font-semibold ${chains.chain?.valid ? 'text-emerald-700' : 'text-red-700'}`}>
                {chains.chain?.valid ? 'Valid' : 'Broken'}
              </p>
              <p className="mt-1 text-xs text-[#91918e]">
                {chains.chain?.checked} events verified
                {chains.chain?.first_broken_seq ? ` · first break at seq ${chains.chain.first_broken_seq}` : ''}
              </p>
            </div>
          ) : (
            '…'
          )}
        </Card>
        <Card title="Open incidents">
          {overview ? (
            <div>
              <p className="text-2xl font-semibold">{overview.incidents?.open ?? 0}</p>
              <p className={`mt-1 text-xs ${(overview.incidents?.notification_overdue ?? 0) > 0 ? 'text-red-700 font-medium' : 'text-[#91918e]'}`}>
                {(overview.incidents?.notification_overdue ?? 0) > 0
                  ? `${overview.incidents.notification_overdue} past the 72h clock`
                  : 'none past the 72h clock'}
              </p>
            </div>
          ) : '…'}
        </Card>
        <Card title="DSAR queue">
          {overview ? (
            <div>
              <p className="text-2xl font-semibold">{overview.dsar_queue?.queued ?? 0}</p>
              <p className="mt-1 text-xs text-[#91918e]">
                {overview.dsar_queue?.completed ?? 0} completed · {overview.dsar_queue?.failed ?? 0} failed
              </p>
            </div>
          ) : '…'}
        </Card>
        <Card title="Legal holds / policies">
          {overview ? (
            <div>
              <p className="text-2xl font-semibold">{overview.legal_holds_active ?? 0}</p>
              <p className="mt-1 text-xs text-[#91918e]">{overview.retention_policies ?? 0} retention policies</p>
            </div>
          ) : '…'}
        </Card>
      </div>

      {/* Controls by framework */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title="Controls by framework">
          <div className="space-y-3">
            {frameworks.map(([fw, counts]: [string, any]) => (
              <div key={fw}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{fw}</span>
                  <span className="text-xs text-[#91918e]">{counts.Implemented}/{controls.filter(c => c.framework === fw).length} implemented</span>
                </div>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-neutral-100">
                  {(['Implemented', 'Partial', 'Needs Review', 'Missing'] as const).map((s) => (
                    (counts[s] ?? 0) > 0 && (
                      <div key={s} title={`${s}: ${counts[s]}`} className={
                        s === 'Implemented' ? 'bg-emerald-500' :
                        s === 'Partial' ? 'bg-amber-400' :
                        s === 'Needs Review' ? 'bg-sky-400' : 'bg-red-400'
                      } style={{ width: `${(counts[s] / Math.max(1, controls.filter(c => c.framework === fw).length)) * 100}%` }} />
                    )
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* DSAR actions */}
        <Card title="New DSAR request">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-[#e0dedb] px-3 py-1.5 text-sm"
              placeholder="data-subject email"
              value={dsarEmail}
              onChange={(e) => setDsarEmail(e.target.value)}
            />
            <select
              className="rounded-md border border-[#e0dedb] px-2 py-1.5 text-sm"
              value={dsarKind}
              onChange={(e) => setDsarKind(e.target.value)}
            >
              <option value="export">export</option>
              <option value="delete">delete</option>
            </select>
            <button
              className="rounded-md bg-[#37352f] text-white text-sm px-3 py-1.5 disabled:opacity-50"
              disabled={!dsarEmail || busy !== null}
              onClick={() =>
                run('dsar', async () => {
                  await complianceApi.createDsar(dsarEmail, dsarKind);
                  setDsarEmail('');
                })
              }
            >
              Create
            </button>
          </div>
          <div className="mt-3 max-h-48 overflow-y-auto divide-y divide-[#f1f0ee]">
            {dsar.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <span className="truncate">{r.subject_email}</span>
                  <span className="ml-2 text-xs text-[#91918e]">{r.kind}</span>
                  {r.failure_reason && (
                    <span className="ml-2 text-xs text-red-700">{r.failure_reason}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateBadge(r.state)}`}>{r.state}</span>
                  {r.state === 'queued' && (
                    <>
                      <button className="text-xs text-blue-700 hover:underline" onClick={() => run(`run-${r.id}`, () => complianceApi.runDsar(r.id))}>run</button>
                      <button className="text-xs text-[#91918e] hover:underline" onClick={() => run(`cx-${r.id}`, () => complianceApi.cancelDsar(r.id))}>cancel</button>
                    </>
                  )}
                  {r.state === 'failed' && (
                    <button className="text-xs text-blue-700 hover:underline" onClick={() => run(`run-${r.id}`, () => complianceApi.runDsar(r.id))}>retry</button>
                  )}
                </div>
              </div>
            ))}
            {dsar.length === 0 && <p className="py-2 text-sm text-[#91918e]">No DSAR requests yet.</p>}
          </div>
        </Card>
      </div>

      {/* Incidents */}
      <div className="mt-4">
        <Card title="Incident register - GDPR 72-hour clock">
          <div className="divide-y divide-[#f1f0ee]">
            {incidents.map((i) => (
              <div key={i.id} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{i.title}</span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{i.severity}</span>
                    {i.notification_overdue && (
                      <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium">72h clock breached</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[#91918e]">
                    detected {i.detected_at?.slice(0, 16).replace('T', ' ')} · deadline {i.gdpr_notification_deadline?.slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  i.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' :
                  i.status === 'contained' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'
                }`}>{i.status}</span>
              </div>
            ))}
            {incidents.length === 0 && <p className="py-2 text-sm text-[#91918e]">No incidents recorded.</p>}
          </div>
        </Card>
      </div>

      {/* Subprocessors */}
      <div className="mt-4">
        <Card title="Subprocessor registry">
          <div className="divide-y divide-[#f1f0ee]">
            {subprocessors.map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-[#5f5e5b]">{s.purpose}</span>
                  <span className="ml-2 text-xs text-[#91918e]">{s.data_location}</span>
                </div>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{s.status}</span>
              </div>
            ))}
            {subprocessors.length === 0 && (
              <p className="py-2 text-sm text-[#91918e]">
                Registry empty - subprocessors appear on /trust as they are added.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Change control (ISO-09) */}
      <div className="mt-4">
        <Card title="Change control - four-eyes (ISO-09)">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="flex-1 rounded-md border border-[#e0dedb] px-3 py-1.5 text-sm"
              placeholder="change title"
              value={chgTitle}
              onChange={(e) => setChgTitle(e.target.value)}
            />
            <input
              className="flex-1 rounded-md border border-[#e0dedb] px-3 py-1.5 text-sm"
              placeholder="what changes and why"
              value={chgDesc}
              onChange={(e) => setChgDesc(e.target.value)}
            />
            <select
              className="rounded-md border border-[#e0dedb] px-2 py-1.5 text-sm"
              value={chgType}
              onChange={(e) => setChgType(e.target.value)}
            >
              <option value="normal">normal</option>
              <option value="standard">standard</option>
              <option value="emergency">emergency</option>
            </select>
            <button
              className="rounded-md bg-[#37352f] text-white text-sm px-3 py-1.5 disabled:opacity-50"
              disabled={!chgTitle || !chgDesc || busy !== null}
              onClick={() =>
                run('chg', async () => {
                  await complianceApi.proposeChange({
                    title: chgTitle,
                    description: chgDesc,
                    change_type: chgType,
                  });
                  setChgTitle('');
                  setChgDesc('');
                })
              }
            >
              Propose
            </button>
          </div>
          <p className="mt-2 text-xs text-[#91918e]">
            The approver must differ from the requester. Emergency changes may implement
            first, but stay flagged until a reviewer signs off (48h slack).
          </p>
          <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-[#f1f0ee]">
            {(changes?.changes ?? []).map((c: any) => (
              <div key={c.id} className="py-2.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[#91918e]">{c.change_key}</span>
                    <span className="text-sm font-medium">{c.title}</span>
                    {c.change_type !== 'normal' && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{c.change_type}</span>
                    )}
                    {c.emergency_review_overdue && (
                      <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium">
                        retro-review overdue
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[#91918e]">
                    by {c.requested_by}
                    {c.reviewed_by ? ` · reviewed by ${c.reviewed_by}` : ''}
                    {c.review_notes ? ` · ${c.review_notes}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${changeStatusBadge(c.status)}`}>
                    {c.status}
                  </span>
                  {c.status === 'proposed' && (
                    <>
                      <button
                        className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() => run(`chg-ap-${c.id}`, () => complianceApi.decideChange(c.id, 'approved'))}
                      >
                        approve
                      </button>
                      <button
                        className="text-xs text-[#91918e] hover:underline disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() => run(`chg-rj-${c.id}`, () => complianceApi.decideChange(c.id, 'rejected'))}
                      >
                        reject
                      </button>
                    </>
                  )}
                  {c.status === 'approved' && (
                    <button
                      className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                      disabled={busy !== null}
                      onClick={() => run(`chg-im-${c.id}`, () => complianceApi.implementChange(c.id))}
                    >
                      implement
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(changes?.changes ?? []).length === 0 && (
              <p className="py-2 text-sm text-[#91918e]">No changes proposed yet.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Vendor security reviews (SOC2-03) */}
      <div className="mt-4">
        <Card title={`Vendor security reviews (SOC2-03) - ${vendors?.summary?.review_overdue ?? 0} overdue`}>
          <div className="divide-y divide-[#f1f0ee]">
            {(vendors?.vendors ?? []).map((v: any) => (
              <details key={v.id} className="group py-2.5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#91918e]">{v.vendor_key}</span>
                      <span className="text-sm font-medium">{v.vendor_name}</span>
                      {v.personal_data && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">personal data</span>
                      )}
                      {v.review_overdue && (
                        <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium">
                          review overdue
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[#91918e]">
                      {v.service_provided} · access: {v.data_access_level}
                      {v.next_review_due ? ` · next review ${v.next_review_due.slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${vendorOutcomeBadge(v.outcome)}`}>
                    {v.outcome}
                  </span>
                </summary>
                <div className="mt-2 rounded-md bg-[#faf9f8] p-3 text-xs leading-5 text-[#5f5e5b]">
                  {v.findings && <p className="mb-2">{v.findings}</p>}
                  {Object.entries(v.questionnaire ?? {}).map(([q, a]) => (
                    <p key={q}>
                      <span className="font-medium text-[#37352f]">{q}:</span> {String(a)}
                    </p>
                  ))}
                  <p className="mt-2 text-[#91918e]">reviewed by {v.reviewer}</p>
                </div>
              </details>
            ))}
            {(vendors?.vendors ?? []).length === 0 && (
              <p className="py-2 text-sm text-[#91918e]">Vendor register empty.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Full controls table */}
      <div className="mt-4 mb-8">
        <Card title={`Control catalog (${controls.length} controls)`}>
          <div className="divide-y divide-[#f1f0ee]">
            {controls.map((c) => (
              <div key={c.id} className="py-2.5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs text-[#91918e]">{c.control_id}</span>
                    <span className="ml-2 text-sm font-medium">{c.name}</span>
                    <p className="mt-1 text-xs leading-5 text-[#5f5e5b]">{c.description}</p>
                    {c.evidence.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {c.evidence.map((e) => (
                          <li key={e.id} className="font-mono text-[11px] text-[#91918e]">
                            [{e.kind}] {e.reference}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <select
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium border-0 ${readinessBadge(c.readiness)}`}
                    value={c.readiness}
                    onChange={(e) =>
                      run(`ctl-${c.id}`, () => complianceApi.setReadiness(c.id, e.target.value))
                    }
                  >
                    {['Implemented', 'Partial', 'Missing', 'Needs Review'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
