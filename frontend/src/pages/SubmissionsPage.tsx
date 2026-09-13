import React, { useState, useEffect } from 'react';
import { 
  FileCheck2, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Download, 
  Eye, 
  ShieldCheck, 
  Search, 
  X, 
  ExternalLink,
  Ban,
  FileText,
  Bell,
  FileSpreadsheet,
  Users,
  UserX,
  UserCheck,
  Send,
  Upload,
  LayoutGrid,
  List,
  Sparkles,
  Zap
} from 'lucide-react';
import { api, Envelope, TemplateItem, AccountUsage } from '../lib/api';
import { PricingModal } from '../components/PricingModal';
import { useToast } from '../components/ui/Toast';
import { TableRowSkeleton } from '../components/ui/Skeleton';
import { Badge, envelopeStatusVariant, envelopeStatusLabel } from '../components/ui/Badge';
import { cn } from '../lib/cn';

interface SubmissionsPageProps {
  onNavigate: (tab: string) => void;
}

export const SubmissionsPage: React.FC<SubmissionsPageProps> = ({ onNavigate }) => {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);

  // Bulk Send Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadEnvelopes();
    api.getAccountUsage().then(setUsage).catch(() => null);
  }, []);

  const loadEnvelopes = async () => {
    try {
      setLoading(true);
      const data = await api.listEnvelopes();
      setEnvelopes(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (id: string) => {
    try {
      const full = await api.getEnvelope(id);
      setSelectedEnvelope(full);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVoid = async (id: string) => {
    if (!window.confirm('Void this envelope? Pending signers will no longer be able to open it.')) return;
    try {
      await api.voidEnvelope(id, 'Voided by account owner');
      await loadEnvelopes();
      if (selectedEnvelope?.id === id) {
        setSelectedEnvelope(null);
      }
      toast('Envelope voided.');
    } catch (err: any) {
      toast(err.message || 'Failed to void envelope', 'error');
    }
  };

  const handleSendReminder = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.sendReminder(id);
      toast(res.message || 'Reminder dispatched to pending signers.');
      await loadEnvelopes();
      if (selectedEnvelope?.id === id) {
        const full = await api.getEnvelope(id);
        setSelectedEnvelope(full);
      }
    } catch (err: any) {
      toast(err.message || 'Failed to send reminder', 'error');
    }
  };

  const openBulkModal = async () => {
    try {
      const tList = await api.listTemplates();
      setTemplates(tList);
      if (tList.length > 0) {
        setSelectedTemplateId(tList[0].id);
      }
      setShowBulkModal(true);
    } catch (e) {
      toast('Could not load templates for bulk send', 'error');
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !bulkCsvFile) return;
    try {
      setBulkSubmitting(true);
      const res = await api.bulkSendEnvelopes(selectedTemplateId, bulkCsvFile);
      toast(`Queued ${res.queued_count} envelopes for dispatch.`);
      setShowBulkModal(false);
      setBulkCsvFile(null);
      await loadEnvelopes();
    } catch (err: any) {
      toast(err.message || 'Bulk dispatch failed', 'error');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const filtered = envelopes.filter((env) => {
    const matchesSearch = env.title.toLowerCase().includes(search.toLowerCase()) ||
                          env.verification_code.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || env.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    return (
      <Badge variant={envelopeStatusVariant(status)}>
        {status === 'sent' || status === 'delivered' ? (
          <Clock className="w-3 h-3" />
        ) : status === 'completed' ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : status === 'voided' ? (
          <Ban className="w-3 h-3" />
        ) : null}
        <span>{envelopeStatusLabel(status)}</span>
      </Badge>
    );
  };

  return (
    <div className="space-y-6">

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center">
          {/* Workspace Switcher - state navigation, mirrors the Templates side */}
          <div className="bg-[#f0eeec] p-1 rounded-lg border border-[#e5e3df] flex items-center gap-1 mr-4 shrink-0" role="tablist" aria-label="Workspace view">
            <button
              role="tab"
              aria-selected="false"
              onClick={() => onNavigate('templates')}
              className="px-3 py-1.5 text-xs font-medium text-[#787671] hover:text-[#1a1a1a] rounded-md transition-all flex items-center gap-1.5"
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Templates</span>
            </button>
            <button
              role="tab"
              aria-selected="true"
              className="px-3 py-1.5 text-xs font-semibold text-[#1a1a1a] bg-white rounded-md shadow-[0px_1px_2px_0px_rgba(15,15,15,0.06)] border border-[#e5e3df] transition-all flex items-center gap-1.5"
            >
              <List className="w-4 h-4 text-[#5645d4]" />
              <span>Submissions</span>
            </button>
          </div>

          <h1 className="text-2xl md:text-3xl font-semibold truncate tracking-tight text-[#1a1a1a] font-heading">
            Submissions
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#a4a097] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search submissions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search submissions"
              className="pl-9 pr-3 py-2 text-xs w-full bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] placeholder-[#a4a097] shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]"
            />
          </div>

          <button
            onClick={openBulkModal}
            className="btn btn-secondary px-3.5 py-2 text-xs font-medium gap-1.5 shrink-0"
          >
            <Users className="w-4 h-4 text-[#5645d4]" />
            <span className="hidden sm:inline">Bulk send</span>
          </button>
        </div>
      </div>

      {/* Plan Usage, Trial & Quota Banner */}
      {usage && (
        usage.is_trial_expired ? (
          <div className="bg-[#ffe3e3]/60 p-4 rounded-lg border border-[#ffc9c9] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#ffe3e3] text-[#a02525]">
                  Trial expired
                </span>
                <span className="text-xs font-semibold text-[#a02525]">
                  Your 7-day Plus trial has ended
                </span>
              </div>
              <p className="text-xs text-[#5d5b54] font-medium">
                Existing signed documents remain permanently accessible in your archive. Upgrade your subscription to continue dispatching new envelopes.
              </p>
            </div>
            <button
              onClick={() => setShowPricingModal(true)}
              className="btn btn-primary text-xs py-2 px-4 shrink-0 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Upgrade plan</span>
            </button>
          </div>
        ) : usage.envelopes_limit !== null ? (
          <div className="bg-[#e6e0f5]/40 p-4 rounded-lg border border-[#d6b6f6]/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#e6e0f5] text-[#3a2a99]">
                  {usage.plan_display_name} plan
                </span>
                {usage.is_trial ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#f9e79f] text-[#6b4e00] flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Trial: {usage.trial_days_remaining ?? 7} days left (no card required)
                  </span>
                ) : (
                  <span className="text-xs text-[#787671] tabular-nums">
                    Cycle renews in {usage.days_remaining_in_cycle} days
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5d5b54] font-medium tabular-nums">
                You have dispatched <strong>{usage.envelopes_used}</strong> of <strong>{usage.envelopes_limit}</strong> monthly envelopes.
                {usage.is_quota_exceeded && (
                  <span className="text-[#c92a2a] font-semibold ml-1.5">(Quota exceeded)</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="w-32 bg-[#e5e3df] rounded-full h-2 overflow-hidden" role="progressbar" aria-valuenow={usage.envelopes_used} aria-valuemax={usage.envelopes_limit} aria-label="Monthly envelope usage">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    usage.is_quota_exceeded
                      ? 'bg-[#c92a2a]'
                      : (usage.envelopes_used / (usage.envelopes_limit || 1)) >= 0.8
                      ? 'bg-[#dd9300]'
                      : 'bg-[#5645d4]'
                  )}
                  style={{
                    width: `${Math.min(100, (usage.envelopes_used / (usage.envelopes_limit || 1)) * 100)}%`
                  }}
                />
              </div>
              <button
                onClick={() => setShowPricingModal(true)}
                className="btn btn-primary text-xs py-1.5 px-3 shrink-0"
              >
                {usage.is_trial ? 'Upgrade to paid' : 'Plans & pricing'}
              </button>
            </div>
          </div>
        ) : null
      )}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-[#f0eeec] p-1 rounded-lg border border-[#e5e3df]">
          {['all', 'sent', 'completed'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              aria-pressed={statusFilter === st}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${
                statusFilter === st
                  ? 'bg-white text-[#1a1a1a] shadow-[0px_1px_2px_0px_rgba(15,15,15,0.06)] border border-[#e5e3df]'
                  : 'text-[#787671] hover:text-[#1a1a1a]'
              }`}
            >
              {st === 'sent' ? 'Pending' : st}
            </button>
          ))}
        </div>

        <span className="text-xs text-[#787671] font-medium tabular-nums">
          Showing {filtered.length} document{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Submissions Table / Ledger */}
      <div className="rounded-lg bg-white border border-[#e5e3df] overflow-hidden shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#fafaf9] text-[#787671] border-b border-[#e5e3df] uppercase tracking-wider text-[11px] font-semibold">
              <tr>
                <th className="py-3.5 px-6" scope="col">Document subject</th>
                <th className="py-3.5 px-4" scope="col">Status</th>
                <th className="py-3.5 px-4" scope="col">Signer progress</th>
                <th className="py-3.5 px-4" scope="col">Created</th>
                <th className="py-3.5 px-6 text-right" scope="col">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f5f9]">
              {loading ? (
                <TableRowSkeleton rows={4} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-[#787671]">
                    <FileText className="w-10 h-10 mx-auto text-[#c8c4be] mb-2" />
                    <p className="font-semibold text-sm text-[#1a1a1a]">No submissions found</p>
                    <p className="text-xs text-[#a4a097] mt-0.5">Documents sent for signature will appear here.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((env) => (
                  <tr 
                    key={env.id}
                    className="hover:bg-[#fafaf9] transition-colors group cursor-pointer"
                    onClick={() => openDetails(env.id)}
                  >
                    <td className="py-4 px-6 font-medium text-[#1a1a1a]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-md bg-[#e6e0f5] border border-[#d6b6f6]/70 flex items-center justify-center text-[#5645d4] shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-semibold text-[#1a1a1a] group-hover:text-[#5645d4] transition-colors font-heading text-sm">
                            {env.title}
                          </div>
                          <div className="text-[10px] text-[#a4a097] font-mono tabular-nums">
                            ID: {env.verification_code}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {getStatusBadge(env.status)}
                    </td>

                    <td className="py-4 px-4 text-[#37352f] font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className="w-24 bg-[#e5e3df] rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-[#5645d4] h-full rounded-full transition-all"
                            style={{ 
                              width: `${((env.signed_count || 0) / (env.recipients_count || 1)) * 100}%` 
                            }}
                          />
                        </div>
                        <span className="text-[11px] text-[#787671] font-mono tabular-nums">
                          {env.signed_count || 0}/{env.recipients_count || 0}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 text-[#787671] text-[11px] tabular-nums">
                      {new Date(env.created_at).toLocaleDateString()}
                    </td>

                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Remind Button */}
                        {(env.status === 'sent' || env.status === 'delivered') && (
                          <button
                            onClick={(e) => handleSendReminder(env.id, e)}
                            title="Send automated reminder"
                            aria-label={`Send reminder for ${env.title}`}
                            className="p-1.5 rounded-md bg-[#f9e79f]/50 hover:bg-[#f9e79f] text-[#6b4e00] border border-[#f0d878] transition-colors"
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                        )}

                        {/* Export CSV */}
                        <a
                          href={api.getExportCsvUrl(env.id)}
                          download
                          title="Export CSV responses"
                          aria-label={`Export CSV for ${env.title}`}
                          className="p-1.5 rounded-md bg-[#e6e0f5]/60 hover:bg-[#e6e0f5] text-[#5645d4] border border-[#d6b6f6]/70 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </a>

                        {env.status === 'completed' && (
                          <a
                            href={`/api/envelopes/${env.id}/download`}
                            download
                            title="Download sealed PDF"
                            aria-label={`Download sealed PDF for ${env.title}`}
                            className="p-1.5 rounded-md bg-[#d9f3e1] hover:bg-[#bfe8cf] text-[#116229] border border-[#b8e6c6] transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}

                        <button
                          onClick={() => openDetails(env.id)}
                          title="View audit trail"
                          aria-label={`View audit trail for ${env.title}`}
                          className="p-1.5 rounded-md bg-white hover:bg-[#f6f5f4] text-[#5d5b54] border border-[#e5e3df] transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {env.status === 'sent' && (
                          <button
                            onClick={() => handleVoid(env.id)}
                            title="Void envelope"
                            aria-label={`Void ${env.title}`}
                            className="p-1.5 rounded-md bg-[#ffe3e3] hover:bg-[#ffc9c9] text-[#a02525] border border-[#ffc9c9] transition-colors"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details / Audit Trail Modal */}
      {selectedEnvelope && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-[#e5e3df] p-6 space-y-6 shadow-[0px_16px_48px_-8px_rgba(15,15,15,0.16)] max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a] font-heading">{selectedEnvelope.title}</h3>
                <p className="text-xs text-[#787671] font-mono tabular-nums mt-0.5">Verification code: {selectedEnvelope.verification_code}</p>
              </div>
              <button onClick={() => setSelectedEnvelope(null)} className="text-[#787671] hover:text-[#1a1a1a]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Recipient Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#787671]">Signer timeline & status</h4>
              <div className="space-y-2.5">
                {(selectedEnvelope.recipients || []).map((r: any) => (
                  <div key={r.id} className="p-3.5 rounded-md bg-[#fafaf9] border border-[#e5e3df] flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-[#1a1a1a]">{r.name}</div>
                      <div className="text-[11px] text-[#787671]">{r.email} ({r.role})</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === 'signed' ? 'success' : 'warning'}>
                        {r.status === 'signed' ? 'Signed' : r.status}
                      </Badge>
                      {r.status !== 'signed' && r.signing_token && (
                        <a
                          href={`/s/${r.signing_token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary text-[11px] px-2.5 py-1 gap-1"
                        >
                          <span>Sign link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cryptographic Digest & Audit Log */}
            <div className="space-y-3 pt-3 border-t border-[#e5e3df]">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#787671]">Audit certificate digest</h4>
              <div className="p-4 rounded-md bg-[#fafaf9] border border-[#e5e3df] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#787671]">Sealing authority</span>
                  <span className="font-semibold text-[#116229] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Sealed by Docurama Root CA
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#787671]">SHA-256 digest</span>
                  <span className="text-[#1a1a1a] truncate max-w-xs">{selectedEnvelope.sha256_original || 'Pending final sealing'}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#f1f5f9]">
              <button 
                onClick={() => setSelectedEnvelope(null)}
                className="btn btn-secondary px-5 py-2 text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Send Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#e5e3df] p-6 space-y-4 shadow-[0px_16px_48px_-8px_rgba(15,15,15,0.16)] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1a1a1a] flex items-center gap-2 font-heading">
                <Users className="w-4 h-4 text-[#5645d4]" />
                Bulk send envelopes via CSV
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-[#787671] hover:text-[#1a1a1a]" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#787671]">
              Upload a CSV file containing columns <code className="text-[#5645d4] font-semibold">name</code> and <code className="text-[#5645d4] font-semibold">email</code>. Docurama will automatically dispatch unique signing envelopes.
            </p>

            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div>
                <label htmlFor="bulk-template" className="block text-xs font-medium text-[#37352f] mb-1">Select base template *</label>
                <select
                  id="bulk-template"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-white border border-[#c8c4be] text-xs text-[#1a1a1a]"
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bulk-csv" className="block text-xs font-medium text-[#37352f] mb-1">Recipients CSV file *</label>
                <input
                  id="bulk-csv"
                  type="file"
                  required
                  accept=".csv"
                  onChange={(e) => setBulkCsvFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-[#5d5b54] file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#e6e0f5]/60 file:text-[#5645d4] hover:file:bg-[#e6e0f5] cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#f1f5f9]">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="btn btn-secondary px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSubmitting}
                  className="btn btn-primary px-5 py-2 text-xs font-medium"
                >
                  {bulkSubmitting ? 'Dispatching…' : 'Dispatch envelopes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pricing and Tier Upgrade Modal */}
      <PricingModal
        isOpen={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        usage={usage}
      />

    </div>
  );
};
