import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/api';

/**
 * Platform administration console (§8 v1).
 *
 * Scope is deliberately narrow: a read-mostly inventory of tenants, the legal
 * notice queue with its SLA badges, and the domain-join approval queue. Every
 * action here is enforced server-side by the platform-admin gate; the UI is a
 * window onto that API, not the authority itself. Impersonation is absent by
 * design until it ships with its own audit story.
 */

interface TenantRow {
  id: string;
  name: string;
  plan: string;
  is_trial: boolean;
  created_at: string | null;
  member_count: number;
  envelope_count: number;
}

interface LegalRow {
  id: string;
  kind: string;
  status: string;
  sla: string;
  reporter_name: string;
  reporter_email: string;
  content_location: string;
  description: string;
  created_at: string | null;
}

interface JoinRow {
  id: string;
  user_email: string;
  status: string;
  created_at: string | null;
}

const slaBadgeClass = (sla: string): string => {
  if (sla.includes('48')) return 'bg-red-100 text-red-800';
  if (sla) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
};

export const AdminPage: React.FC = () => {
  const [tab, setTab] = useState<'tenants' | 'legal' | 'joins'>('tenants');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [notices, setNotices] = useState<LegalRow[]>([]);
  const [joins, setJoins] = useState<JoinRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, l, j] = await Promise.all([
        adminApi.tenants(query),
        adminApi.legalQueue(),
        adminApi.pendingJoins(),
      ]);
      setTenants(t);
      setNotices(l);
      setJoins(j);
    } catch (e: any) {
      setError(e?.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const resolveNotice = async (id: string) => {
    const resolution = window.prompt('Resolution note (recorded verbatim):');
    if (!resolution) return;
    try {
      await adminApi.resolveNotice(id, resolution);
      setNotice('Notice resolved.');
      load();
    } catch (e: any) {
      setError(e?.message || 'Resolve failed.');
    }
  };

  const approveJoin = async (id: string) => {
    try {
      await adminApi.approveJoin(id);
      setNotice('Join request approved.');
      load();
    } catch (e: any) {
      setError(e?.message || 'Approval failed.');
    }
  };

  const tabButton = (key: typeof tab, label: string, count?: number) => (
    <button
      onClick={() => setTab(key)}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        tab === key ? 'bg-[#37352f] text-white' : 'bg-white text-[#37352f] border border-[#E2E8F0] hover:bg-gray-50'
      }`}
    >
      {label}{typeof count === 'number' ? ` (${count})` : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#37352f]">Platform Administration</h1>
          <p className="text-sm text-[#64748B]">
            Deployment-wide view. Every action is enforced server-side and logged.{' '}
            <a className="text-blue-700 hover:underline" href="/admin/compliance">Compliance dashboard →</a>
          </p>
        </div>
        <div className="flex gap-2">
          {tabButton('tenants', 'Tenants')}
          {tabButton('legal', 'Legal queue', notices.filter(n => n.status === 'pending').length)}
          {tabButton('joins', 'Joins', joins.length)}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2">{notice}</div>
      )}

      {loading ? (
        <div className="text-sm text-[#64748B] py-8 text-center">Loading…</div>
      ) : tab === 'tenants' ? (
        <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden">
          <div className="border-b border-[#E2E8F0] px-4 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspaces by name…"
              className="w-full md:w-80 rounded-md border border-[#E2E8F0] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#37352f]/20"
            />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-left text-[#64748B]">
              <tr>
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Envelopes</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-[#E2E8F0]">
                  <td className="px-4 py-2 font-medium text-[#37352f]">{t.name}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      t.is_trial ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {t.plan}{t.is_trial ? ' · trial' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2">{t.member_count}</td>
                  <td className="px-4 py-2">{t.envelope_count}</td>
                  <td className="px-4 py-2 text-[#64748B]">
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[#64748B]">No workspaces.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'legal' ? (
        <div className="space-y-3">
          {notices.map((n) => (
            <div key={n.id} className="bg-white rounded-lg border border-[#E2E8F0] p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 uppercase">{n.kind.replace('_', ' ')}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${slaBadgeClass(n.sla)}`}>SLA: {n.sla}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  n.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>{n.status}</span>
                <span className="text-xs text-[#64748B] ml-auto">
                  {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                </span>
              </div>
              <p className="text-sm font-medium text-[#37352f]">{n.reporter_name} · {n.reporter_email}</p>
              <p className="text-sm text-[#64748B] mt-1">Content: {n.content_location}</p>
              <p className="text-sm text-[#37352f] mt-2 whitespace-pre-wrap line-clamp-4">{n.description}</p>
              {n.status === 'pending' && (
                <button
                  onClick={() => resolveNotice(n.id)}
                  className="mt-3 px-3 py-1.5 rounded-md bg-[#37352f] text-white text-sm hover:bg-black transition-colors"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
          {notices.length === 0 && (
            <div className="text-sm text-[#64748B] py-8 text-center bg-white rounded-lg border border-[#E2E8F0]">No legal notices.</div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {joins.map((j) => (
            <div key={j.id} className="bg-white rounded-lg border border-[#E2E8F0] p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[#37352f]">{j.user_email}</p>
                <p className="text-xs text-[#64748B]">
                  Requested {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
                </p>
              </div>
              <button
                onClick={() => approveJoin(j.id)}
                className="px-3 py-1.5 rounded-md bg-[#37352f] text-white text-sm hover:bg-black transition-colors"
              >
                Approve
              </button>
            </div>
          ))}
          {joins.length === 0 && (
            <div className="text-sm text-[#64748B] py-8 text-center bg-white rounded-lg border border-[#E2E8F0]">No pending join requests.</div>
          )}
        </div>
      )}
    </div>
  );
};
