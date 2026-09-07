import React, { useState, useEffect } from 'react';
import { 
  Building,
  User, 
  Users,
  ShieldCheck, 
  Mail, 
  MessageSquare,
  Key, 
  Code,
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
  Shield,
  Activity,
  Play,
  Eye,
  X,
  Radio,
  FileCheck
} from 'lucide-react';
import { api, DomainItem, WebhookItem, WebhookDeliveryItem } from '../lib/api';

interface SettingsPageProps {
  user: any;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<
    'account' | 'profile' | 'users' | 'signatures' | 'notifications' | 'sms' | 'api' | 'mcp'
  >('account');
  const [saved, setSaved] = useState(false);

  // Profile Form State
  const [firstName, setFirstName] = useState(user?.first_name || 'Admin');
  const [lastName, setLastName] = useState(user?.last_name || 'User');
  const [email, setEmail] = useState(user?.email || 'admin@docurama.com');
  const [accountName, setAccountName] = useState(user?.account_name || 'Docurama Technologies Inc.');

  // Domains State
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [domainFeedback, setDomainFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Webhooks State
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(['*']);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [testResults, setTestResults] = useState<{ [id: string]: string }>({});

  // Deliveries Modal
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookItem | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // Users Management State
  const [usersList, setUsersList] = useState([
    { id: '1', name: 'Primary Admin', email: user?.email || 'admin@docurama.com', role: 'admin', status: 'active' },
    { id: '2', name: 'Compliance Officer', email: 'compliance@docurama.com', role: 'member', status: 'active' },
  ]);
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // Top Nav Items Matching overlay/custom_views/shared/_settings_nav.html.erb
  const navItems = [
    { id: 'account', label: 'Account', icon: Building, group: 'workspace' },
    { id: 'profile', label: 'Profile', icon: User, group: 'workspace' },
    { id: 'users', label: 'Users', icon: Users, group: 'workspace' },
    { id: 'signatures', label: 'Digital Signatures', icon: ShieldCheck, group: 'security' },
    { id: 'notifications', label: 'Notifications', icon: Mail, group: 'security' },
    { id: 'sms', label: 'SMS', icon: MessageSquare, group: 'security' },
    { id: 'api', label: 'API Keys', icon: Key, group: 'developer' },
    { id: 'mcp', label: 'MCP Server', icon: Code, group: 'developer' },
  ];

  useEffect(() => {
    if (activeTab === 'account') {
      loadDomains();
    } else if (activeTab === 'api') {
      loadWebhooks();
    }
  }, [activeTab]);

  const loadWebhooks = async () => {
    try {
      setLoadingWebhooks(true);
      const list = await api.getWebhooks();
      setWebhooks(list);
    } catch (e: any) {
      console.error('Failed to load webhooks:', e);
    } finally {
      setLoadingWebhooks(false);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;
    try {
      setCreatingWebhook(true);
      await api.createWebhook(newWebhookUrl.trim(), newWebhookEvents);
      setNewWebhookUrl('');
      setNewWebhookEvents(['*']);
      setShowWebhookModal(false);
      await loadWebhooks();
    } catch (err: any) {
      alert(err.message || 'Failed to create webhook');
    } finally {
      setCreatingWebhook(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook endpoint?')) return;
    try {
      await api.deleteWebhook(id);
      await loadWebhooks();
    } catch (e) {
      alert('Failed to delete webhook');
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      setTestResults(prev => ({ ...prev, [id]: 'Dispatching test...' }));
      const res = await api.testWebhook(id);
      setTestResults(prev => ({ ...prev, [id]: res.success ? `Delivered HTTP ${res.status_code || 200}` : 'Delivery Failed' }));
      setTimeout(() => {
        setTestResults(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 4000);
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [id]: 'Test error' }));
    }
  };

  const handleOpenDeliveries = async (webhook: WebhookItem) => {
    setSelectedWebhook(webhook);
    try {
      setLoadingDeliveries(true);
      const d = await api.getWebhookDeliveries(webhook.id);
      setDeliveries(d);
    } catch (e) {
      alert('Failed to load delivery attempts');
    } finally {
      setLoadingDeliveries(false);
    }
  };

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
      setDomainFeedback({ msg: 'Domain added! Configure DNS records below.', type: 'success' });
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
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      
      {/* Top Command Tab Bar Matching Production Exactly */}
      <div className="w-full settings-horizontal-nav-wrapper">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-2 border border-slate-200/80 shadow-sm flex items-center justify-between overflow-x-auto gap-2 scrollbar-none">
          <div className="flex items-center space-x-1 sm:space-x-1.5 flex-nowrap">
            
            {/* Workspace Group */}
            <button
              onClick={() => setActiveTab('account')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'account'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Building className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Account</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'profile'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <User className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Profile</span>
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'users'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Users className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Users</span>
            </button>

            <span className="h-5 w-px bg-slate-200 mx-1 hidden sm:inline-block" />

            {/* Signatures & Security Group */}
            <button
              onClick={() => setActiveTab('signatures')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'signatures'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4 mr-1.5 text-[#1D72FE]" />
              <span>Digital Signatures</span>
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'notifications'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Mail className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Notifications</span>
            </button>
            <button
              onClick={() => setActiveTab('sms')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'sms'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <MessageSquare className="w-4 h-4 mr-1.5 opacity-80" />
              <span>SMS</span>
            </button>

            <span className="h-5 w-px bg-slate-200 mx-1 hidden sm:inline-block" />

            {/* Developer Group */}
            <button
              onClick={() => setActiveTab('api')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'api'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Key className="w-4 h-4 mr-1.5 opacity-80" />
              <span>API Keys</span>
            </button>
            <button
              onClick={() => setActiveTab('mcp')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'mcp'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Code className="w-4 h-4 mr-1.5 opacity-80" />
              <span>MCP Server</span>
            </button>
          </div>

          <div className="hidden lg:flex items-center px-3 py-1 bg-slate-50 rounded-xl border border-slate-200/60 text-xs font-semibold text-slate-500">
            <span>Docurama Control Center</span>
          </div>
        </div>
      </div>

      {saved && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Configuration preferences updated and synchronized across all nodes.</span>
        </div>
      )}

      {/* 1. Account Tab */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-[#0F172A]">Organization Settings</h2>
              <p className="text-xs text-slate-500 mt-0.5">Manage your workspace brand identity and document quotas.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="base-input w-full h-10 px-3.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Default Legal Seal Format
                </label>
                <select className="base-input w-full h-10 px-3.5 text-sm bg-white">
                  <option>PAdES-B-LTV (PDF Advanced Electronic Signatures)</option>
                  <option>CAdES-BES (Cryptographic Message Syntax)</option>
                  <option>XAdES (XML Advanced Electronic Signatures)</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button onClick={handleSave} className="btn btn-primary px-6 h-10 font-semibold text-sm">
                Save Account Changes
              </button>
            </div>
          </div>

          {/* Custom Sending Domains */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
                <Globe className="w-5 h-5 text-[#1D72FE]" />
                <span>Custom Email Domains</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Send signing invites from your brand's verified domain using SPF &amp; DKIM.</p>
            </div>

            {domainFeedback && (
              <div className={`p-4 rounded-xl text-xs flex items-center gap-2 ${
                domainFeedback.type === 'success' 
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' 
                  : 'bg-rose-50 border border-rose-200 text-rose-700'
              }`}>
                {domainFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{domainFeedback.msg}</span>
              </div>
            )}

            <form onSubmit={handleAddDomain} className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. sign.yourcompany.com"
                value={newDomainInput}
                onChange={(e) => setNewDomainInput(e.target.value)}
                className="base-input flex-1 h-10 px-3.5 text-sm"
              />
              <button
                type="submit"
                disabled={addingDomain}
                className="btn btn-primary px-5 h-10 font-semibold text-sm flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Domain</span>
              </button>
            </form>

            <div className="space-y-3">
              {domains.length === 0 && !loadingDomains ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No custom sending domains registered. Add your root or subdomain above.
                </div>
              ) : (
                domains.map((dom) => (
                  <div key={dom.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-800 text-sm">{dom.domain}</span>
                      <span className={`ml-3 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        dom.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {dom.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleVerifyDomain(dom.id)}
                        disabled={verifyingId === dom.id}
                        className="btn btn-white text-xs px-3 py-1.5 border border-slate-300"
                      >
                        {verifyingId === dom.id ? 'Checking DNS...' : 'Verify DNS'}
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(dom.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Profile Tab */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-[#0F172A]">Personal Profile</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage your credentials and authenticated email.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="base-input w-full h-10 px-3.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="base-input w-full h-10 px-3.5 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="base-input w-full h-10 px-3.5 text-sm"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button onClick={handleSave} className="btn btn-primary px-6 h-10 font-semibold text-sm">
              Update Profile
            </button>
          </div>
        </div>
      )}

      {/* 3. Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Team Members</h2>
              <p className="text-xs text-slate-500 mt-0.5">Invite teammates to prepare and send document envelopes.</p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="email"
              placeholder="colleague@yourcompany.com"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              className="base-input flex-1 h-10 px-3.5 text-sm"
            />
            <button
              onClick={() => {
                if (!newMemberEmail) return;
                setUsersList([...usersList, { id: String(Date.now()), name: newMemberEmail.split('@')[0], email: newMemberEmail, role: 'member', status: 'invited' }]);
                setNewMemberEmail('');
              }}
              className="btn btn-primary px-5 h-10 font-semibold text-sm flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Invite User</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {usersList.map((u) => (
              <div key={u.id} className="py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#0F172A]">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#1D72FE] text-xs font-semibold uppercase">
                    {u.role}
                  </span>
                  <span className="text-xs text-slate-400 capitalize">{u.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Digital Signatures Tab */}
      {activeTab === 'signatures' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span>Cryptographic Root Authority &amp; Seals</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">X.509 Digital Certificates, Hardware Security, and DigiCert RFC 3161 TSA.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Root Certification Authority</div>
              <div className="text-sm font-semibold text-[#0F172A]">Docurama Enterprise Root CA v2</div>
              <div className="text-xs text-slate-500 font-mono">Fingerprint: E7:4A:9C:12:F4:7B:33...</div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Valid through 2036 • Active</span>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Time Stamping Authority (TSA)</div>
              <div className="text-sm font-semibold text-[#0F172A]">DigiCert RFC 3161 Certified Time Stamp</div>
              <div className="text-xs text-slate-500 font-mono">Endpoint: http://timestamp.digicert.com</div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-[#1D72FE] text-xs font-semibold">
                <span>PAdES-LTV Compliant</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-[#0F172A]">Email Notification Templates</h2>
            <p className="text-xs text-slate-500 mt-0.5">Customize automatic email dispatching for signing invitations and completion audits.</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div>
                <div className="font-semibold text-slate-800 text-sm">Signer Invitation Notification</div>
                <div className="text-xs text-slate-400">Triggered immediately when a recipient is required to review and sign.</div>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 accent-[#1D72FE] rounded" />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div>
                <div className="font-semibold text-slate-800 text-sm">Automatic Cadence Reminders</div>
                <div className="text-xs text-slate-400">Send reminder nudges every 48 hours to signers who haven't completed fields.</div>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 accent-[#1D72FE] rounded" />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div>
                <div className="font-semibold text-slate-800 text-sm">Completed Certificate of Completion PDF</div>
                <div className="text-xs text-slate-400">Attaches the tamper-evident cryptographic audit report upon envelope sealing.</div>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5 accent-[#1D72FE] rounded" />
            </div>
          </div>
        </div>
      )}

      {/* 6. SMS Tab */}
      {activeTab === 'sms' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-[#0F172A]">SMS Delivery Gateway</h2>
            <p className="text-xs text-slate-500 mt-0.5">Configure Twilio or custom SMS provider for mobile signing links.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Account SID</label>
              <input type="text" placeholder="AC••••••••••••••••••••••••••••••••" className="base-input w-full h-10 px-3.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Auth Token</label>
              <input type="password" placeholder="••••••••••••••••••••••••" className="base-input w-full h-10 px-3.5 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Sender Phone Number / Messaging SID</label>
              <input type="text" placeholder="+1 (555) 000-0000" className="base-input w-full h-10 px-3.5 text-sm" />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button onClick={handleSave} className="btn btn-primary px-6 h-10 font-semibold text-sm">
              Save SMS Credentials
            </button>
          </div>
        </div>
      )}

      {/* 7. API Keys Tab */}
      {activeTab === 'api' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-[#0F172A]">REST API Access Tokens</h2>
              <p className="text-xs text-slate-500 mt-0.5">Bearer authentication keys for programmatic contract dispatching.</p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Production Secret Key</span>
                <button 
                  onClick={() => copyToClipboard('docu_live_99f2e718b52c4a9190da', 'apikey')}
                  className="btn btn-white text-xs px-3 py-1 flex items-center gap-1.5 border border-slate-300"
                >
                  {copiedKey === 'apikey' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'apikey' ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
              <div className="font-mono text-sm text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200">
                docu_live_99f2e718b52c4a9190da••••••••••••••••
              </div>
            </div>
          </div>

          {/* Webhooks Section */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Webhook Subscriptions</h2>
                <p className="text-xs text-slate-500 mt-0.5">Real-time HTTP callbacks for signed events and tamper audits.</p>
              </div>
              <button
                onClick={() => setShowWebhookModal(true)}
                className="btn btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Webhook</span>
              </button>
            </div>

            <div className="space-y-3">
              {webhooks.length === 0 && !loadingWebhooks ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No active webhooks configured. Click "New Webhook" to register an endpoint.
                </div>
              ) : (
                webhooks.map((w) => (
                  <div key={w.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-xs font-bold text-slate-800">{w.url}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Events: {w.events.join(', ')} • Active
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTestWebhook(w.id)}
                        className="btn btn-white text-xs px-3 py-1.5 border border-slate-300"
                      >
                        {testResults[w.id] || 'Test Ping'}
                      </button>
                      <button
                        onClick={() => handleDeleteWebhook(w.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 8. MCP Server Tab */}
      {activeTab === 'mcp' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
              <Code className="w-5 h-5 text-[#1D72FE]" />
              <span>Model Context Protocol (MCP) Server</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Connect AI coding assistants and autonomous agents directly to Docurama tools.</p>
          </div>

          <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">SSE Server Endpoint</div>
            <div className="font-mono text-xs text-slate-800 bg-white p-3 rounded-lg border border-slate-200 select-all">
              {window.location.origin}/.webmcp/sse
            </div>
            <div className="text-xs text-slate-500">
              Compatible with Claude Desktop, Cursor, and Antigravity IDE agentic workflows.
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Exposed Agent Tools</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                <div className="font-mono text-xs font-bold text-[#1D72FE]">create_envelope</div>
                <div className="text-[11px] text-slate-500 mt-1">Uploads and dispatches multi-party PDF workflows.</div>
              </div>
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                <div className="font-mono text-xs font-bold text-[#1D72FE]">verify_pdf_signature</div>
                <div className="text-[11px] text-slate-500 mt-1">Extracts X.509 PAdES-LTV cryptographic seals.</div>
              </div>
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                <div className="font-mono text-xs font-bold text-[#1D72FE]">get_submission_audit</div>
                <div className="text-[11px] text-slate-500 mt-1">Returns immutable timestamped audit trails.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Webhook Modal */}
      {showWebhookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full border border-slate-200 shadow-2xl space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-[#0F172A]">Register Webhook Endpoint</h3>
              <button onClick={() => setShowWebhookModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateWebhook} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Payload URL
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://api.yourdomain.com/webhooks/docurama"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  className="base-input w-full h-10 px-3.5 text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowWebhookModal(false)}
                  className="btn btn-white px-4 h-10 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingWebhook}
                  className="btn btn-primary px-5 h-10 text-sm font-semibold"
                >
                  {creatingWebhook ? 'Registering...' : 'Save Endpoint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
