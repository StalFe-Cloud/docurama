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
  List
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
      if (tList.length > 0) {
        setSelectedTemplateId(tList[0].id);
      }
      setShowBulkModal(true);
    } catch (e) {
      alert('Could not load templates for bulk send');
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !bulkCsvFile) return;
    try {
      setBulkSubmitting(true);
      const res = await api.bulkSendEnvelopes(selectedTemplateId, bulkCsvFile);
      showToast(`Successfully queued ${res.queued_count} envelopes for dispatch.`);
      setShowBulkModal(false);
      setBulkCsvFile(null);
      await loadEnvelopes();
    } catch (err: any) {
      alert(err.message || 'Bulk dispatch failed');
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
    switch (status) {
      case 'completed':
        return (
          <span className="badge badge-success">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
            <span>Completed</span>
          </span>
        );
      case 'sent':
      case 'delivered':
        return (
          <span className="badge badge-warning">
            <Clock className="w-3 h-3 text-amber-600 stroke-[2.5]" />
            <span>Pending Signers</span>
          </span>
        );
      case 'voided':
        return (
          <span className="badge badge-error">
            <Ban className="w-3 h-3 text-rose-600 stroke-[2.5]" />
            <span>Voided</span>
          </span>
        );
      default:
        return (
          <span className="badge badge-info">
            <span>{status}</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-8 right-8 z-50 p-4 rounded-2xl bg-white border border-[#E2E8F0] text-[#0F172A] shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-[#94A3B8] hover:text-[#0F172A] ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header Matching Production submissions_dashboard/index */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center">
          {/* Toggle View Pill (Templates / Submissions) */}
          <div className="bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] flex items-center space-x-1 mr-4 shrink-0">
            <a 
              href="/templates" 
              onClick={(e) => { e.preventDefault(); window.location.pathname = '/templates'; }}
              className="px-3 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#0F172A] rounded-lg transition-all flex items-center space-x-1.5"
            >
              <LayoutGrid className="w-4 h-4 stroke-2" />
              <span>Templates</span>
            </a>
            <button className="px-3 py-1.5 text-xs font-semibold text-[#0F172A] bg-white rounded-lg shadow-sm border border-[#E2E8F0] transition-all flex items-center space-x-1.5">
              <List className="w-4 h-4 text-[#1D72FE] stroke-[2.5]" />
              <span>Submissions</span>
            </button>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold truncate tracking-tight text-[#0F172A] font-heading">
            Submissions
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search submissions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-xs w-full bg-white border border-[#E2E8F0] rounded-xl text-[#0F172A] placeholder-[#94A3B8] focus:border-[#1D72FE] shadow-sm"
            />
          </div>

          <button
            onClick={openBulkModal}
            className="btn btn-white px-3.5 py-2 text-xs font-semibold gap-1.5 shadow-sm shrink-0"
          >
            <Users className="w-4 h-4 text-[#1D72FE]" />
            <span className="hidden sm:inline">Bulk Send</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs Matching Production */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-1 bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0]">
          {['all', 'sent', 'completed'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
                statusFilter === st
                  ? 'bg-white text-[#0F172A] shadow-sm border border-[#E2E8F0]'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              {st === 'sent' ? 'Pending' : st}
            </button>
          ))}
        </div>

        <span className="text-xs text-[#64748B] font-medium">
          Showing {filtered.length} document{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Submissions Table / Ledger */}
      <div className="rounded-2xl bg-white border border-[#E2E8F0] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B] border-b border-[#E2E8F0] uppercase tracking-wider text-[11px] font-semibold">
              <tr>
                <th className="py-3.5 px-6">Document Subject</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Signers Progress</th>
                <th className="py-3.5 px-4">Created</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-[#64748B]">
                    <FileText className="w-10 h-10 mx-auto text-[#CBD5E1] mb-2" />
                    <p className="font-semibold text-sm text-[#0F172A]">No submissions found</p>
                    <p className="text-xs text-[#94A3B8] mt-0.5">Documents sent for signature will appear here.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((env) => (
                  <tr 
                    key={env.id}
                    className="hover:bg-[#F8FAFC] transition-colors group cursor-pointer"
                    onClick={() => openDetails(env.id)}
                  >
                    <td className="py-4 px-6 font-medium text-[#0F172A]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#1D72FE] shrink-0">
                          <FileText className="w-4 h-4 stroke-2" />
                        </div>
                        <div>
                          <div className="font-bold text-[#0F172A] group-hover:text-[#1D72FE] transition-colors font-heading text-sm">
                            {env.title}
                          </div>
                          <div className="text-[10px] text-[#94A3B8] font-mono">
                            ID: {env.verification_code}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {getStatusBadge(env.status)}
                    </td>

                    <td className="py-4 px-4 text-[#334155] font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className="w-24 bg-[#E2E8F0] rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-[#1D72FE] h-full rounded-full transition-all"
                            style={{ 
                              width: `${((env.signed_count || 0) / (env.recipients_count || 1)) * 100}%` 
                            }}
                          />
                        </div>
                        <span className="text-[11px] text-[#64748B] font-mono">
                          {env.signed_count || 0}/{env.recipients_count || 0}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 text-[#64748B] text-[11px]">
                      {new Date(env.created_at).toLocaleDateString()}
                    </td>

                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Remind Button */}
                        {(env.status === 'sent' || env.status === 'delivered') && (
                          <button
                            onClick={(e) => handleSendReminder(env.id, e)}
                            title="Send Automated Reminder"
                            className="p-1.5 rounded-lg bg-[#FFFBEB] hover:bg-[#FDE68A] text-amber-700 border border-[#FDE68A] transition-colors"
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                        )}

                        {/* Export CSV */}
                        <a
                          href={api.getExportCsvUrl(env.id)}
                          download
                          title="Export CSV Responses"
                          className="p-1.5 rounded-lg bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D72FE] border border-[#BFDBFE] transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </a>

                        {env.status === 'completed' && (
                          <a
                            href={`/api/envelopes/${env.id}/download`}
                            download
                            title="Download Sealed PDF"
                            className="p-1.5 rounded-lg bg-[#ECFDF5] hover:bg-[#D1FAE5] text-emerald-700 border border-[#A7F3D0] transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}

                        <button
                          onClick={() => openDetails(env.id)}
                          title="View Audit Trail"
                          className="p-1.5 rounded-lg bg-white hover:bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0] transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {env.status === 'sent' && (
                          <button
                            onClick={() => handleVoid(env.id)}
                            title="Void Envelope"
                            className="p-1.5 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] text-rose-600 border border-[#FECACA] transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white border border-[#E2E8F0] p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A] font-heading">{selectedEnvelope.title}</h3>
                <p className="text-xs text-[#64748B] font-mono mt-0.5">Verification Code: {selectedEnvelope.verification_code}</p>
              </div>
              <button onClick={() => setSelectedEnvelope(null)} className="text-[#64748B] hover:text-[#0F172A]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Recipient Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#475569]">Signer Timeline & Status</h4>
              <div className="space-y-2.5">
                {(selectedEnvelope.recipients || []).map((r: any) => (
                  <div key={r.id} className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-[#0F172A]">{r.name}</div>
                      <div className="text-[11px] text-[#64748B]">{r.email} ({r.role})</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${r.status === 'signed' ? 'badge-success' : 'badge-warning'}`}>
                        {r.status === 'signed' ? 'Signed' : r.status}
                      </span>
                      {r.status !== 'signed' && (
                        <a 
                          href={`/s/${r.signing_token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-white text-[11px] px-2.5 py-1 gap-1"
                        >
                          <span>Sign Link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cryptographic Digest & Audit Log */}
            <div className="space-y-3 pt-3 border-t border-[#E2E8F0]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#475569]">Audit Certificate Digest</h4>
              <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Digital Trust Engine</span>
                  <span className="font-semibold text-emerald-600 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Docurama Root CA Certified
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#64748B]">SHA-256 Digest</span>
                  <span className="text-[#0F172A] truncate max-w-xs">{selectedEnvelope.sha256_original || "Pending final sealing"}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
              <button 
                onClick={() => setSelectedEnvelope(null)}
                className="btn btn-white px-5 py-2 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Send Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-[#E2E8F0] p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2 font-heading">
                <Users className="w-4 h-4 text-[#1D72FE]" />
                Bulk Send Envelopes via CSV
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-[#64748B] hover:text-[#0F172A]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#64748B]">
              Upload a CSV file containing columns <code className="text-[#1D72FE] font-bold">name</code> and <code className="text-[#1D72FE] font-bold">email</code>. Docurama will automatically dispatch unique signing envelopes.
            </p>

            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Select Base Template *</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs text-[#0F172A]"
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Recipients CSV File *</label>
                <input
                  type="file"
                  required
                  accept=".csv"
                  onChange={(e) => setBulkCsvFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-[#64748B] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#EFF6FF] file:text-[#1D72FE] hover:file:bg-[#DBEAFE] cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="btn btn-white px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSubmitting}
                  className="btn btn-primary px-5 py-2 text-xs font-semibold shadow-sm"
                >
                  {bulkSubmitting ? 'Dispatching...' : 'Dispatch Envelopes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
