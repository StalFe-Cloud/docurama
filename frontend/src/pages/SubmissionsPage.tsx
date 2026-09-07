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
  FileText
} from 'lucide-react';
import { api, Envelope } from '../lib/api';

export const SubmissionsPage: React.FC = () => {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);

  useEffect(() => {
    loadEnvelopes();
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
    if (!window.confirm('Are you sure you want to void this envelope?')) return;
    try {
      await api.voidEnvelope(id, 'Voided by account owner');
      await loadEnvelopes();
      if (selectedEnvelope?.id === id) {
        setSelectedEnvelope(null);
      }
    } catch (err) {
      alert('Error voiding envelope');
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
      
      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <FileCheck2 className="w-7 h-7 text-indigo-400" />
            Submissions Ledger
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Real-time audit log of all active and completed cryptographic envelopes.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-white/10 self-start sm:self-auto">
          {['all', 'completed', 'sent', 'voided'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
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
      <div className="rounded-2xl glass-card border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-white/10 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-6 font-semibold">Document Subject</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold">Signers Progress</th>
                <th className="py-3.5 px-4 font-semibold">Created (UTC)</th>
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
                      {new Date(env.created_at).toLocaleDateString()} {new Date(env.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
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

            {/* Actions */}
            {selectedEnvelope.status === 'completed' && (
              <div className="grid grid-cols-2 gap-3">
                <a
                  href={`/api/envelopes/${selectedEnvelope.id}/download`}
                  download
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download Sealed PDF
                </a>
                <a
                  href={`/api/envelopes/${selectedEnvelope.id}/certificate`}
                  download
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Audit Certificate
                </a>
              </div>
            )}

            {/* Recipients List with Signing Links */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Recipients & Signing Links
              </h3>
              <div className="space-y-2.5">
                {(selectedEnvelope.recipients || []).map((r) => (
                  <div key={r.id} className="p-3 rounded-xl bg-slate-950/40 border border-white/5 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">{r.name}</div>
                      <div className="text-slate-400 text-[11px]">{r.email} ({r.role})</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === 'signed' ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Signed
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

    </div>
  );
};
