import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  User, 
  ShieldCheck, 
  Mail, 
  Key, 
  Lock, 
  CheckCircle2, 
  Save,
  Globe,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Plus,
  ExternalLink,
  Trash2,
  Shield
} from 'lucide-react';
import { api, DomainItem } from '../lib/api';

interface SettingsPageProps {
  user: any;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<'crypto' | 'domains' | 'profile' | 'smtp' | 'api' | 'security'>('crypto');
  const [saved, setSaved] = useState(false);

  // Domains State
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [domainFeedback, setDomainFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const tabs = [
    { id: 'crypto', label: 'Cryptographic Trust', icon: ShieldCheck },
    { id: 'domains', label: 'Domain Verification', icon: Globe },
    { id: 'profile', label: 'Profile & Account', icon: User },
    { id: 'smtp', label: 'Email & SMTP', icon: Mail },
    { id: 'api', label: 'API Keys & Webhooks', icon: Key },
    { id: 'security', label: 'Security & Auth', icon: Lock },
  ];

  useEffect(() => {
    if (activeTab === 'domains') {
      loadDomains();
    }
  }, [activeTab]);

  const loadDomains = async () => {
    try {
      setLoadingDomains(true);
      const list = await api.getDomains();
      setDomains(list);
    } catch (e: any) {
      console.error('Failed to load domains:', e);
    } finally {
      setLoadingDomains(false);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomainInput.trim()) return;
    try {
      setAddingDomain(true);
      setDomainFeedback(null);
      await api.createDomain(newDomainInput.trim());
      setNewDomainInput('');
      await loadDomains();
      setDomainFeedback({ msg: 'Domain added! Configure the DNS records below and click "Verify DNS Now".', type: 'success' });
    } catch (err: any) {
      setDomainFeedback({ msg: err.message || 'Failed to add domain.', type: 'error' });
    } finally {
      setAddingDomain(false);
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    try {
      setVerifyingId(domainId);
      setDomainFeedback(null);
      const res = await api.verifyDomain(domainId);
      await loadDomains();
      if (res.success) {
        setDomainFeedback({ msg: res.message, type: 'success' });
      } else {
        setDomainFeedback({ msg: res.message, type: 'error' });
      }
    } catch (err: any) {
      setDomainFeedback({ msg: err.message || 'Verification check failed.', type: 'error' });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    if (!confirm('Are you sure you want to remove this domain verification?')) return;
    try {
      await api.deleteDomain(domainId);
      await loadDomains();
      setDomainFeedback({ msg: 'Domain removed.', type: 'success' });
    } catch (err: any) {
      setDomainFeedback({ msg: err.message || 'Failed to delete domain.', type: 'error' });
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-7 h-7 text-indigo-400" />
          Settings & Control Center
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Configure cryptographic trust authorities, corporate domain DNS verifications, and enterprise security policies.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Left Tabs */}
        <div className="md:col-span-1 space-y-1">
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left transition-all ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Right Content */}
        <div className="md:col-span-3 p-6 rounded-3xl glass-card border border-white/10 space-y-6">
          
          {/* Cryptographic Trust Tab */}
          {activeTab === 'crypto' && (
            <div className="space-y-6 text-xs">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Docurama Document Trust Engine
                </h2>
                <p className="text-slate-400 mt-1">
                  Active X.509 PKCS#12 digital certificates used for PAdES-LTV document sealing and RFC 3161 timestamps.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-emerald-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">Docurama Document Signing Certificate</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                      ACTIVE
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Subject: <span className="text-slate-300 font-mono">CN=Docurama Trusted Document Signer, O=Docurama Technologies, C=FR</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Issuer: <span className="text-slate-300 font-mono">CN=Docurama Document Signing Intermediate CA</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Root CA: <span className="text-slate-300 font-mono">CN=Docurama Root Certification Authority</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">RFC 3161 Timestamping Authority (TSA)</span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-[10px] font-bold border border-indigo-500/20">
                      CONNECTED
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Server: <span className="text-slate-300 font-mono">http://timestamp.digicert.com</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Standard: <span className="text-slate-300">RFC 3161 Authenticode & PAdES-B-LTV Compliant</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Domain Verification Tab */}
          {activeTab === 'domains' && (
            <div className="space-y-6 text-xs">
              <div className="border-b border-white/10 pb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-indigo-400" />
                    Client & Corporate Domain Verification
                  </h2>
                  <p className="text-slate-400 mt-1">
                    Authenticate your corporate domain (<code className="text-indigo-300">example.com</code>) via DNS records or website confirmation pointing to Docurama to enable verified sender identity and anti-spoofing seals.
                  </p>
                </div>
                <button
                  onClick={loadDomains}
                  disabled={loadingDomains}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Refresh Domain List"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingDomains ? 'animate-spin text-indigo-400' : ''}`} />
                </button>
              </div>

              {/* Feedback Alert */}
              {domainFeedback && (
                <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                  domainFeedback.type === 'success' 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  {domainFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
                  )}
                  <span className="text-xs">{domainFeedback.msg}</span>
                </div>
              )}

              {/* Add Domain Form */}
              <form onSubmit={handleAddDomain} className="p-4 rounded-2xl bg-slate-900/60 border border-white/5 space-y-3">
                <span className="font-bold text-white text-xs block">Add Corporate Domain to Verify</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. example.com"
                    value={newDomainInput}
                    onChange={(e) => setNewDomainInput(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={addingDomain || !newDomainInput.trim()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {addingDomain ? 'Adding...' : 'Add Domain'}
                  </button>
                </div>
              </form>

              {/* Domains List */}
              <div className="space-y-4">
                {domains.length === 0 && !loadingDomains && (
                  <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-white/10">
                    No custom domains configured yet. Add your corporate domain above to begin verification.
                  </div>
                )}

                {domains.map((d) => {
                  const isVerified = d.status === 'verified';
                  const isVerifying = verifyingId === d.id;

                  return (
                    <div key={d.id} className="p-5 rounded-2xl bg-slate-900 border border-white/10 space-y-4">
                      
                      {/* Domain Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-white/10">
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-indigo-400" />
                          <div>
                            <span className="text-sm font-extrabold text-white font-mono">{d.domain}</span>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {isVerified ? (
                                <span className="text-emerald-400 flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Corporate Identity Confirmed ({d.verification_method.replace(/_/g, ' ')})
                                </span>
                              ) : (
                                <span className="text-amber-400 flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Awaiting DNS Records or Website Confirmation
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            isVerified 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {isVerified ? 'VERIFIED' : 'PENDING'}
                          </span>

                          <button
                            onClick={() => handleVerifyDomain(d.id)}
                            disabled={isVerifying}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                            {isVerifying ? 'Checking...' : 'Verify DNS Now'}
                          </button>

                          <button
                            onClick={() => handleDeleteDomain(d.id)}
                            className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-900/50 hover:text-rose-300 text-slate-400 transition-colors"
                            title="Remove Domain"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* DNS Configuration Instructions */}
                      <div className="space-y-3">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                          Required DNS Records (Choose Method A or B)
                        </span>

                        {/* Record 1: TXT Record */}
                        <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-2">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-300 font-bold">Method A: DNS TXT Challenge Record</span>
                            <span className="text-[10px] text-slate-500">Standard Anti-Spoofing</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Record Type & Host</span>
                              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 font-mono text-slate-300 mt-1">
                                <span>TXT <span className="text-indigo-400">{d.txt_record_host}</span></span>
                                <button 
                                  onClick={() => copyToClipboard(d.txt_record_host, `host-${d.id}`)}
                                  className="text-slate-400 hover:text-white"
                                >
                                  {copiedKey === `host-${d.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Record Value</span>
                              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 font-mono text-slate-300 mt-1">
                                <span className="truncate pr-2">{d.txt_record_value}</span>
                                <button 
                                  onClick={() => copyToClipboard(d.txt_record_value, `val-${d.id}`)}
                                  className="text-slate-400 hover:text-white shrink-0"
                                >
                                  {copiedKey === `val-${d.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Record 2: Subdomain Pointer */}
                        <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-2">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-300 font-bold">Method B: Subdomain Pointer to Docurama</span>
                            <span className="text-[10px] text-emerald-400 font-semibold">Active & Live</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Host Name</span>
                              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 font-mono text-slate-300 mt-1">
                                <span>{d.cname_record_host}</span>
                                <button 
                                  onClick={() => copyToClipboard(d.cname_record_host, `cname-${d.id}`)}
                                  className="text-slate-400 hover:text-white"
                                >
                                  {copiedKey === `cname-${d.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Points To Target</span>
                              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 font-mono text-slate-300 mt-1">
                                <span>{d.cname_target}</span>
                                <button 
                                  onClick={() => copyToClipboard(d.cname_target, `target-${d.id}`)}
                                  className="text-slate-400 hover:text-white"
                                >
                                  {copiedKey === `target-${d.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* Attestation Preview Banner */}
                      <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-[11px] text-indigo-300 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span>
                          {isVerified 
                            ? `Authenticity Sealed: All envelopes issued by @${d.domain} display the official "DNS Verified Organization" trust badge on Audit Certificates.`
                            : `Once confirmed pointing to Docurama, documents issued from @${d.domain} will be cryptographically anchored to your corporate identity.`}
                        </span>
                      </div>

                    </div>
                  );
                })}
              </div>

            </div>
          )}

          {/* Profile & Account Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-4 text-xs">
              <h2 className="text-base font-bold text-white">User Profile & Account</h2>
              <div>
                <label className="block text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  defaultValue={`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Administrator'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  defaultValue={user?.email || 'admin@docurama.com'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Organization Subdomain</label>
                <input
                  type="text"
                  defaultValue="Docurama"
                  disabled
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-500 font-mono"
                />
              </div>
            </div>
          )}

          {/* SMTP Notifications Tab */}
          {activeTab === 'smtp' && (
            <div className="space-y-4 text-xs">
              <h2 className="text-base font-bold text-white">Email & Dispatch Settings</h2>
              <div>
                <label className="block text-slate-400 mb-1">Sender Email</label>
                <input
                  type="text"
                  defaultValue="documents@docurama.com"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Sender Display Name</label>
                <input
                  type="text"
                  defaultValue="Docurama Electronic Signatures"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white"
                />
              </div>
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === 'api' && (
            <div className="space-y-4 text-xs">
              <h2 className="text-base font-bold text-white">API Keys & Webhooks</h2>
              <div>
                <label className="block text-slate-400 mb-1">Production API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    defaultValue="dcr_live_92837498237498237498"
                    readOnly
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-white/10 font-mono text-slate-400"
                  />
                  <button className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold">
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-4 text-xs">
              <h2 className="text-base font-bold text-white">Security & Access Controls</h2>
              <div className="space-y-2">
                <div className="p-3 bg-slate-900 rounded-xl border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">Argon2id Password Storage</div>
                    <div className="text-slate-400 text-[11px]">Hardware-cost enforced memory-hard password protection</div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">HTTP-Only SameSite Secure Cookies</div>
                    <div className="text-slate-400 text-[11px]">Enforces strict CSRF and XSS cookie boundary (_docurama_session)</div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            {saved ? (
              <span className="text-xs text-emerald-400 flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Preferences saved successfully
              </span>
            ) : <span />}

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white btn-primary-glow"
            >
              <Save className="w-4 h-4" />
              Save Preferences
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};
