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
  Upload
} from 'lucide-react';
import { api, Envelope, TemplateItem } from '../lib/api';

export const SubmissionsPage: React.FC = () => {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);

  // Bulk Send Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    loadEnvelopes();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

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
    if (!window.confirm('Are you sure you want to void this envelope?')) return;
    try {
      await api.voidEnvelope(id, 'Voided by account owner');
      await loadEnvelopes();
      if (selectedEnvelope?.id === id) {
        setSelectedEnvelope(null);
      }
      showToast('Envelope voided successfully.');
    } catch (err) {
      alert('Error voiding envelope');
    }
  };

  const handleSendReminder = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.sendReminder(id);
      showToast(res.message || 'Automated reminder dispatched to pending signers.');
      await loadEnvelopes();
      if (selectedEnvelope?.id === id) {
        const full = await api.getEnvelope(id);
        setSelectedEnvelope(full);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to send reminder');
    }
  };

  const openBulkModal = async () => {
    try {
      const tList = await api.listTemplates();
      setTemplates(tList);
      if (tList.length > 0) setSelectedTemplateId(tList[0].id);
      setShowBulkModal(true);
    } catch (e) {
      alert('Failed to load templates for bulk send');
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !bulkCsvFile) {
      alert('Please select a template and upload a CSV file.');
      return;
    }
    try {
      setBulkSubmitting(true);
      const res = await api.bulkSendEnvelopes(selectedTemplateId, bulkCsvFile);
      showToast(`Bulk send successful: dispatched ${res.dispatched_count || 0} envelopes!`);
      setShowBulkModal(false);
      setBulkCsvFile(null);
      await loadEnvelopes();
    } catch (err: any) {
      alert(err.message || 'Bulk dispatch failed.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const filtered = envelopes.filter(e => {
    const matchesSearch = e.title.toLowerCase().includes(search.toLowerCase()) ||
                          e.verification_code.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Sealed & Valid
          </span>
        );
      case 'sent':
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            Waiting Signatures
          </span>
        );
      case 'signed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Clock className="w-3.5 h-3.5" />
            Partially Signed
          </span>
        );
      case 'declined':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <UserX className="w-3.5 h-3.5" />
            Declined
          </span>
        );
      case 'voided':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <Ban className="w-3.5 h-3.5" />
            Voided
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-16">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-indigo-950 border border-indigo-500/40 text-white shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <FileCheck2 className="w-7 h-7 text-indigo-400" />
            Submissions Ledger
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Real-time audit ledger of all active and completed cryptographic envelopes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openBulkModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition-colors shadow-lg"
          >
            <Users className="w-3.5 h-3.5" />
            Bulk Send (CSV)
          </button>

          <button
            onClick={loadEnvelopes}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Refresh Ledger
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title or verification code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-white/10 self-start sm:self-auto overflow-x-auto">
          {['all', 'completed', 'sent', 'declined', 'voided'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all shrink-0 ${
                statusFilter === status
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {status === 'all' ? 'All Envelopes' : status}
            </button>
          ))}
        </div>
      </div>

      {/* Ledger Table */}
      <div className="rounded-2xl glass-card border border-white/10 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-white/10 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-6 font-semibold">Document Subject</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold">Signers Progress</th>
                <th className="py-3.5 px-4 font-semibold">Created</th>
                <th className="py-3.5 px-6 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                    No envelopes found matching your search.
                  </td>
                </tr>
              ) : (
                filtered.map((env) => (
                  <tr 
                    key={env.id}
                    className="hover:bg-slate-900/40 transition-colors group cursor-pointer"
                    onClick={() => openDetails(env.id)}
                  >
                    <td className="py-4 px-6 font-medium text-white">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                            {env.title}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            ID: {env.verification_code}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {getStatusBadge(env.status)}
                    </td>

                    <td className="py-4 px-4 text-slate-300 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-800 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className="bg-indigo-500 h-full rounded-full transition-all"
                            style={{ 
                              width: `${((env.signed_count || 0) / (env.recipients_count || 1)) * 100}%` 
                            }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {env.signed_count || 0}/{env.recipients_count || 0}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 text-slate-400 text-[11px]">
                      {new Date(env.created_at).toLocaleDateString()}
                    </td>

                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {/* Remind Button */}
                        {(env.status === 'sent' || env.status === 'delivered') && (
                          <button
                            onClick={(e) => handleSendReminder(env.id, e)}
                            title="Send Automated Reminder"
                            className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition-colors"
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                        )}

                        {/* Export CSV */}
                        <a
                          href={api.getExportCsvUrl(env.id)}
                          download
                          title="Export CSV Responses"
                          className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </a>

                        {env.status === 'completed' && (
                          <a
                            href={`/api/envelopes/${env.id}/download`}
                            download
                            title="Download Sealed PDF"
                            className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}

                        <button
                          onClick={() => openDetails(env.id)}
                          title="View Audit Trail"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {env.status === 'sent' && (
                          <button
                            onClick={() => handleVoid(env.id)}
                            title="Void Envelope"
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
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

      {/* Slide-over Audit Drawer */}
      {selectedEnvelope && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-xl bg-slate-900 border-l border-white/10 h-full p-6 overflow-y-auto space-y-6 shadow-2xl animate-in slide-in-from-right duration-300">
            
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white">Envelope Intelligence & Audit Trail</h2>
              </div>
              <button 
                onClick={() => setSelectedEnvelope(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Block */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-white/5 space-y-3 text-xs">
              <div className="flex justify-between items-start">
                <span className="text-slate-400">Subject:</span>
                <span className="font-semibold text-white text-right">{selectedEnvelope.title}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Verification Code:</span>
                <span className="font-mono text-indigo-300 font-bold">{selectedEnvelope.verification_code}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Status:</span>
                <div>{getStatusBadge(selectedEnvelope.status)}</div>
              </div>
              {selectedEnvelope.sha256_signed && (
                <div className="flex flex-col gap-1 pt-2 border-t border-white/5">
                  <span className="text-slate-400 text-[10px]">PAdES Cryptographic Checksum (SHA-256):</span>
                  <span className="font-mono text-[9px] text-emerald-400 break-all bg-slate-900 p-1.5 rounded">
                    {selectedEnvelope.sha256_signed}
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <a
                href={api.getExportCsvUrl(selectedEnvelope.id)}
                download
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Export CSV Data
              </a>

              {(selectedEnvelope.status === 'sent' || selectedEnvelope.status === 'delivered') && (
                <button
                  onClick={() => handleSendReminder(selectedEnvelope.id)}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  Dispatch Reminders
                </button>
              )}
            </div>

            {/* Recipients List with Live States */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Recipients & Execution Flow
              </h3>
              <div className="space-y-2.5">
                {(selectedEnvelope.recipients || []).map((r) => (
                  <div key={r.id} className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{r.name}</div>
                        <div className="text-slate-400 text-[11px]">{r.email} ({r.role})</div>
                      </div>
                      <div>
                        {r.status === 'signed' ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Signed
                          </span>
                        ) : r.status === 'declined' ? (
                          <span className="text-rose-400 font-semibold flex items-center gap-1">
                            <UserX className="w-3.5 h-3.5" /> Declined
                          </span>
                        ) : r.status === 'delegated' ? (
                          <span className="text-purple-400 font-semibold flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5" /> Delegated
                          </span>
                        ) : (
                          <a
                            href={`/s/${r.signing_token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium"
                          >
                            Sign Now
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    {r.declined_reason && (
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
                        <strong>Decline Reason:</strong> {r.declined_reason}
                      </div>
                    )}

                    {r.delegated_to_email && (
                      <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px]">
                        <strong>Delegated to:</strong> {r.delegated_to_name} ({r.delegated_to_email})
                      </div>
                    )}

                    {(r.reminders_sent_count || 0) > 0 && (
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Bell className="w-3 h-3 text-amber-400" />
                        Reminders sent: {r.reminders_sent_count} (Last: {new Date(r.last_reminded_at || '').toLocaleDateString()})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chronological Audit Timeline */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Immutable Event Timeline
              </h3>
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {(selectedEnvelope.audit_events || []).map((a, idx) => (
                  <div key={a.id || idx} className="relative text-xs">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-slate-900" />
                    <div className="font-semibold text-white">{a.description}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {a.actor_name} • {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Bulk Send Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                Bulk Dispatch from CSV
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Generate dozens or hundreds of individual signing envelopes simultaneously using a template blueprint and a recipient CSV list.
            </p>

            <form onSubmit={handleBulkSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Target Blueprint Template *</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-white"
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Upload Recipient CSV *</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => e.target.files && setBulkCsvFile(e.target.files[0])}
                  className="w-full text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-500 mt-1.5">
                  CSV format: columns <code>email</code> and <code>name</code> (required), plus optional custom field values.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {bulkSubmitting ? 'Dispatching Envelopes...' : 'Start Bulk Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
