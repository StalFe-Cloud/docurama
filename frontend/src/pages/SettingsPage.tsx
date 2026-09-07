import React, { useState, useEffect, useRef } from 'react';
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
  FileCheck,
  Clock,
  Sliders,
  ChevronRight,
  HelpCircle,
  UploadCloud,
  FileText,
  Sparkles,
  QrCode,
  PenTool,
  Info,
  Layers,
  ArrowUpRight,
  Download,
  AlertTriangle,
  Terminal,
  BookOpen,
  Cpu
} from 'lucide-react';
import { api } from '../lib/api';
import { ApiDocsPage } from './ApiDocsPage';

interface SettingsPageProps {
  user: any;
  initialSubtab?: string;
}

const WORLD_TIMEZONES = [
  "(GMT-12:00) International Date Line West",
  "(GMT-11:00) American Samoa",
  "(GMT-11:00) Midway Island",
  "(GMT-10:00) Hawaii",
  "(GMT-09:00) Alaska",
  "(GMT-08:00) Pacific Time (US & Canada)",
  "(GMT-08:00) Tijuana",
  "(GMT-07:00) Arizona",
  "(GMT-07:00) Mazatlan",
  "(GMT-07:00) Mountain Time (US & Canada)",
  "(GMT-06:00) Central America",
  "(GMT-06:00) Central Time (US & Canada)",
  "(GMT-06:00) Chihuahua",
  "(GMT-06:00) Guadalajara",
  "(GMT-06:00) Mexico City",
  "(GMT-06:00) Monterrey",
  "(GMT-06:00) Saskatchewan",
  "(GMT-05:00) Bogota",
  "(GMT-05:00) Eastern Time (US & Canada)",
  "(GMT-05:00) Indiana (East)",
  "(GMT-05:00) Lima",
  "(GMT-05:00) Quito",
  "(GMT-04:00) Atlantic Time (Canada)",
  "(GMT-04:00) Caracas",
  "(GMT-04:00) Georgetown",
  "(GMT-04:00) La Paz",
  "(GMT-04:00) Puerto Rico",
  "(GMT-04:00) Santiago",
  "(GMT-03:30) Newfoundland",
  "(GMT-03:00) Asuncion",
  "(GMT-03:00) Brasilia",
  "(GMT-03:00) Buenos Aires",
  "(GMT-03:00) Montevideo",
  "(GMT-02:00) Greenland",
  "(GMT-02:00) Mid-Atlantic",
  "(GMT-01:00) Azores",
  "(GMT-01:00) Cape Verde Is.",
  "(GMT+00:00) Edinburgh",
  "(GMT+00:00) Lisbon",
  "(GMT+00:00) London",
  "(GMT+00:00) Monrovia",
  "(GMT+00:00) UTC",
  "(GMT+01:00) Amsterdam",
  "(GMT+01:00) Belgrade",
  "(GMT+01:00) Berlin",
  "(GMT+01:00) Bern",
  "(GMT+01:00) Bratislava",
  "(GMT+01:00) Brussels",
  "(GMT+01:00) Budapest",
  "(GMT+01:00) Casablanca",
  "(GMT+01:00) Copenhagen",
  "(GMT+01:00) Dublin",
  "(GMT+01:00) Ljubljana",
  "(GMT+01:00) Madrid",
  "(GMT+01:00) Paris",
  "(GMT+01:00) Prague",
  "(GMT+01:00) Rome",
  "(GMT+01:00) Sarajevo",
  "(GMT+01:00) Skopje",
  "(GMT+01:00) Stockholm",
  "(GMT+01:00) Vienna",
  "(GMT+01:00) Warsaw",
  "(GMT+01:00) West Central Africa",
  "(GMT+01:00) Zagreb",
  "(GMT+01:00) Zurich",
  "(GMT+02:00) Athens",
  "(GMT+02:00) Bucharest",
  "(GMT+02:00) Cairo",
  "(GMT+02:00) Harare",
  "(GMT+02:00) Helsinki",
  "(GMT+02:00) Jerusalem",
  "(GMT+02:00) Kaliningrad",
  "(GMT+02:00) Kyiv",
  "(GMT+02:00) Pretoria",
  "(GMT+02:00) Riga",
  "(GMT+02:00) Sofia",
  "(GMT+02:00) Tallinn",
  "(GMT+02:00) Vilnius",
  "(GMT+03:00) Baghdad",
  "(GMT+03:00) Istanbul",
  "(GMT+03:00) Kuwait",
  "(GMT+03:00) Minsk",
  "(GMT+03:00) Moscow",
  "(GMT+03:00) Nairobi",
  "(GMT+03:00) Riyadh",
  "(GMT+03:00) St. Petersburg",
  "(GMT+03:00) Volgograd",
  "(GMT+03:30) Tehran",
  "(GMT+04:00) Abu Dhabi",
  "(GMT+04:00) Baku",
  "(GMT+04:00) Muscat",
  "(GMT+04:00) Samara",
  "(GMT+04:00) Tbilisi",
  "(GMT+04:00) Yerevan",
  "(GMT+04:30) Kabul",
  "(GMT+05:00) Almaty",
  "(GMT+05:00) Astana",
  "(GMT+05:00) Ekaterinburg",
  "(GMT+05:00) Islamabad",
  "(GMT+05:00) Karachi",
  "(GMT+05:00) Tashkent",
  "(GMT+05:30) Chennai",
  "(GMT+05:30) Kolkata",
  "(GMT+05:30) Mumbai",
  "(GMT+05:30) New Delhi",
  "(GMT+05:30) Sri Jayawardenepura",
  "(GMT+05:45) Kathmandu",
  "(GMT+06:00) Dhaka",
  "(GMT+06:00) Urumqi",
  "(GMT+06:30) Rangoon",
  "(GMT+07:00) Bangkok",
  "(GMT+07:00) Hanoi",
  "(GMT+07:00) Jakarta",
  "(GMT+07:00) Krasnoyarsk",
  "(GMT+07:00) Novosibirsk",
  "(GMT+08:00) Beijing",
  "(GMT+08:00) Chongqing",
  "(GMT+08:00) Hong Kong",
  "(GMT+08:00) Irkutsk",
  "(GMT+08:00) Kuala Lumpur",
  "(GMT+08:00) Perth",
  "(GMT+08:00) Singapore",
  "(GMT+08:00) Taipei",
  "(GMT+08:00) Ulaanbaatar",
  "(GMT+09:00) Osaka",
  "(GMT+09:00) Sapporo",
  "(GMT+09:00) Seoul",
  "(GMT+09:00) Tokyo",
  "(GMT+09:00) Yakutsk",
  "(GMT+09:30) Adelaide",
  "(GMT+09:30) Darwin",
  "(GMT+10:00) Brisbane",
  "(GMT+10:00) Canberra",
  "(GMT+10:00) Guam",
  "(GMT+10:00) Hobart",
  "(GMT+10:00) Melbourne",
  "(GMT+10:00) Port Moresby",
  "(GMT+10:00) Sydney",
  "(GMT+10:00) Vladivostok",
  "(GMT+11:00) Magadan",
  "(GMT+11:00) New Caledonia",
  "(GMT+11:00) Solomon Is.",
  "(GMT+12:00) Auckland",
  "(GMT+12:00) Fiji",
  "(GMT+12:00) Kamchatka",
  "(GMT+12:00) Marshall Is.",
  "(GMT+12:00) Wellington",
  "(GMT+13:00) Nuku'alofa",
  "(GMT+13:00) Samoa",
  "(GMT+13:00) Tokelau Is."
];

const LANGUAGES = [
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ user, initialSubtab }) => {
  const getInitialTab = (): 'account' | 'profile' | 'users' | 'esign' | 'notifications' | 'sms' | 'api' | 'mcp' => {
    if (initialSubtab && ['account', 'profile', 'users', 'esign', 'notifications', 'sms', 'api', 'mcp'].includes(initialSubtab)) {
      return initialSubtab as any;
    }
    const path = window.location.pathname;
    if (path.includes('/settings/profile')) return 'profile';
    if (path.includes('/settings/users')) return 'users';
    if (path.includes('/settings/esign')) return 'esign';
    if (path.includes('/settings/notifications')) return 'notifications';
    if (path.includes('/settings/sms')) return 'sms';
    if (path.includes('/settings/api')) return 'api';
    if (path.includes('/settings/mcp')) return 'mcp';
    return 'account';
  };

  const [activeTab, setActiveTab] = useState<'account' | 'profile' | 'users' | 'esign' | 'notifications' | 'sms' | 'api' | 'mcp'>(getInitialTab);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const handleTabChange = (tabId: 'account' | 'profile' | 'users' | 'esign' | 'notifications' | 'sms' | 'api' | 'mcp') => {
    setActiveTab(tabId);
    try {
      window.history.pushState(null, '', `/settings/${tabId}`);
    } catch (e) {
      // ignore
    }
  };

  // -------------------------------------------------------------
  // TAB 1: Account & Workspace Settings State
  // -------------------------------------------------------------
  const [companyName, setCompanyName] = useState(user?.account_name || 'Docurama Technologies Inc.');
  const [timezone, setTimezone] = useState('(GMT+00:00) UTC');
  const [language, setLanguage] = useState('en-US');
  const [force2fa, setForce2fa] = useState(false);
  const [withSignatureId, setWithSignatureId] = useState(true);
  const [requireSigningReason, setRequireSigningReason] = useState(false);
  const [combinePdfAuditLog, setCombinePdfAuditLog] = useState(true);
  const [enforceSigningOrder, setEnforceSigningOrder] = useState(false);
  const [expirableLinks, setExpirableLinks] = useState(true);
  const [requireAuthDownloads, setRequireAuthDownloads] = useState(false);
  const [prefillSignatures, setPrefillSignatures] = useState(true);
  const [allowResubmit, setAllowResubmit] = useState(false);
  const [allowDecline, setAllowDecline] = useState(true);
  const [allowDelegate, setAllowDelegate] = useState(false);

  // -------------------------------------------------------------
  // TAB 2: Profile State
  // -------------------------------------------------------------
  const [firstName, setFirstName] = useState(user?.first_name || 'Executive');
  const [lastName, setLastName] = useState(user?.last_name || 'Admin');
  const [email, setEmail] = useState(user?.email || 'admin@docurama.com');
  const [hasSavedSignature, setHasSavedSignature] = useState(true);
  const [hasSavedInitials, setHasSavedInitials] = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [initialsText, setInitialsText] = useState('EA');
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showInitialsModal, setShowInitialsModal] = useState(false);
  const [showTwoFactorModal, setShowTwoFactorModal] = useState(false);
  const [twoFactorConfigured, setTwoFactorConfigured] = useState(false);
  const [totpInputCode, setTotpInputCode] = useState('');

  // Signature canvas ref
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // -------------------------------------------------------------
  // TAB 3: Users State
  // -------------------------------------------------------------
  const [usersFilter, setUsersFilter] = useState<'all' | 'archived' | 'integration'>('all');
  const [usersList, setUsersList] = useState([
    { id: '1', name: 'Primary Admin', email: user?.email || 'admin@docurama.com', role: 'Owner', lastSession: 'Just now', archived: false, type: 'human' },
    { id: '2', name: 'Compliance Officer', email: 'compliance@docurama.com', role: 'Admin', lastSession: 'Yesterday, 14:20', archived: false, type: 'human' },
    { id: '3', name: 'Legal Counsel', email: 'legal@docurama.com', role: 'Member', lastSession: 'Sep 04, 09:12', archived: false, type: 'human' },
    { id: '4', name: 'Legacy Contractor', email: 'contractor.archive@docurama.com', role: 'Member', lastSession: 'Aug 12, 2026', archived: true, type: 'human' },
    { id: '5', name: 'Docurama API Automation Bot', email: 'bot-integration@docurama.internal', role: 'Admin', lastSession: '2 mins ago', archived: false, type: 'integration' }
  ]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'Owner' | 'Admin' | 'Member'>('Member');
  const [editingUser, setEditingUser] = useState<any>(null);

  // -------------------------------------------------------------
  // TAB 4: Digital Signatures State (Exact Match to Production)
  // -------------------------------------------------------------
  const [certsList, setCertsList] = useState([
    {
      id: 'cert-1',
      name: 'Trusted Document Signing Certificate',
      validTo: 'September 6, 2036',
      status: 'default',
      isTrustedDocurama: false
    },
    {
      id: 'cert-2',
      name: 'Docurama Self-Host Autogenerated',
      validTo: 'September 6, 2126',
      status: 'active',
      isTrustedDocurama: false
    },
    {
      id: 'cert-3',
      name: 'Docurama Trusted Signature',
      validTo: 'September 6, 2036',
      status: 'available',
      isTrustedDocurama: true
    }
  ]);
  const [showUploadCertModal, setShowUploadCertModal] = useState(false);
  const [uploadCertName, setUploadCertName] = useState('');
  const [uploadCertPassphrase, setUploadCertPassphrase] = useState('');
  const [verifyingPdf, setVerifyingPdf] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [timeserverUrl, setTimeserverUrl] = useState('http://timestamp.digicert.com');
  const [multiSignatures, setMultiSignatures] = useState(true);
  const [flattenPdf, setFlattenPdf] = useState(true);
  const [downloadFormat, setDownloadFormat] = useState('{document.name} - {submission.status}.pdf');

  // -------------------------------------------------------------
  // TAB 5: Notifications State
  // -------------------------------------------------------------
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [bccAuditEmail, setBccAuditEmail] = useState('audit@stalfe.com');
  const [enableReminders, setEnableReminders] = useState(true);
  const [remindDaysAfter, setRemindDaysAfter] = useState('3');
  const [repeatRemindDays, setRepeatRemindDays] = useState('5');
  const [maxReminders, setMaxReminders] = useState('3');
  const [reminderSubject, setReminderSubject] = useState('Reminder: Please sign {{document.name}}');

  // -------------------------------------------------------------
  // TAB 6: SMS State
  // -------------------------------------------------------------
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsProvider, setSmsProvider] = useState('twilio');
  const [smsAccountSid, setSmsAccountSid] = useState('');
  const [smsAuthToken, setSmsAuthToken] = useState('');
  const [smsFromNumber, setSmsFromNumber] = useState('');
  const [smsTemplate, setSmsTemplate] = useState('Please review and sign {{template_name}}: {{sign_url}}');

  // -------------------------------------------------------------
  // TAB 7: API Keys & Webhooks State
  // -------------------------------------------------------------
  const [apiToken, setApiToken] = useState('docurama_sec_live_9f838274bc9201948572bca9372104');
  const [showToken, setShowToken] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRotateKeyModal, setShowRotateKeyModal] = useState(false);

  // -------------------------------------------------------------
  // TAB 8: MCP Server State
  // -------------------------------------------------------------
  const [mcpToken, setMcpToken] = useState('mcp_sec_8a92fbc9472e01a');
  const [showNewMcpTokenModal, setShowNewMcpTokenModal] = useState(false);
  const [newMcpTokenName, setNewMcpTokenName] = useState('');

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const triggerSave = (msg: string = 'Configuration preferences saved successfully.') => {
    setSaveNotice(msg);
    setTimeout(() => setSaveNotice(null), 3500);
  };

  const handleMakeDefaultCert = (certId: string) => {
    setCertsList(prev => prev.map(c => {
      if (c.id === certId) {
        return { ...c, status: 'default' };
      }
      if (c.status === 'default') {
        return { ...c, status: c.isTrustedDocurama ? 'available' : 'active' };
      }
      return c;
    }));
    triggerSave('Default digital signing certificate updated.');
  };

  const handleUploadCert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadCertName.trim()) return;
    setCertsList(prev => [
      ...prev,
      {
        id: 'cert-' + Date.now(),
        name: uploadCertName.trim(),
        validTo: 'September 1, 2031',
        status: 'active',
        isTrustedDocurama: false
      }
    ]);
    setUploadCertName('');
    setUploadCertPassphrase('');
    setShowUploadCertModal(false);
    triggerSave('PKCS#12 certificate successfully registered.');
  };

  const handleSimulatePdfVerify = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setVerifyingPdf(true);
    setVerifyResult(null);
    setTimeout(() => {
      setVerifyingPdf(false);
      setVerifyResult({
        fileName: file.name,
        isValid: true,
        signerName: 'Docurama Cryptographic Authority',
        issuer: 'Docurama Root CA G2',
        tsaValid: true,
        timestampTime: '2026-09-07 11:30:14 UTC',
        padesLtv: true
      });
      triggerSave('Cryptographic PDF analysis complete: Signatures verified.');
    }, 1200);
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) return;
    const fullName = `${newUserFirstName.trim()} ${newUserLastName.trim()}`.trim() || newUserEmail.split('@')[0];
    setUsersList(prev => [
      ...prev,
      {
        id: String(Date.now()),
        name: fullName,
        email: newUserEmail.trim(),
        role: newUserRole,
        lastSession: 'Invitation pending',
        archived: false,
        type: 'human'
      }
    ]);
    setNewUserEmail('');
    setNewUserFirstName('');
    setNewUserLastName('');
    setShowAddUserModal(false);
    triggerSave(`Invitation sent to ${newUserEmail.trim()}.`);
  };

  const handleArchiveUser = (id: string) => {
    setUsersList(prev => prev.map(u => u.id === id ? { ...u, archived: true } : u));
    triggerSave('User archived.');
  };

  const handleUnarchiveUser = (id: string) => {
    setUsersList(prev => prev.map(u => u.id === id ? { ...u, archived: false } : u));
    triggerSave('User unarchived and restored.');
  };

  // Nav Items definition matching production 8 tabs
  const navItems = [
    { id: 'account', label: 'Account', icon: Building },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'esign', label: 'Digital Signatures', icon: ShieldCheck },
    { id: 'notifications', label: 'Notifications', icon: Mail },
    { id: 'sms', label: 'SMS', icon: MessageSquare },
    { id: 'api', label: 'API Keys', icon: Key },
    { id: 'mcp', label: 'MCP Server', icon: Code },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-20">
      
      {/* Top Command Tab Bar Matching Production Exactly */}
      <div className="w-full settings-horizontal-nav-wrapper">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-2 border border-slate-200/80 shadow-sm flex items-center justify-between overflow-x-auto gap-2 scrollbar-none">
          <div className="flex items-center space-x-1 sm:space-x-1.5 flex-nowrap">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabChange(item.id as any)}
                  className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-[#1D72FE] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="hidden lg:flex items-center space-x-2 pl-4 border-l border-slate-200 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Docurama Control Center
            </span>
          </div>
        </div>
      </div>

      {/* Floating Save Confirmation Notification */}
      {saveNotice && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-[#0F172A] text-white px-4 py-3 rounded-2xl shadow-xl border border-slate-700 flex items-center space-x-3 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{saveNotice}</span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ACCOUNT TAB */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
              Account &amp; Workspace Settings
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage your organization profile, regulatory compliance, and electronic signature configurations.
            </p>
          </div>

          {/* Card 1: Company name & Localization */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Company name &amp; Localization</h2>
                <p className="text-xs text-slate-500">Define the workspace identifier, timezone, and language preferences.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Company name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="base-input w-full h-11 px-3.5 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Time zone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="base-select w-full h-11 px-3.5 text-sm"
                  >
                    {WORLD_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="base-select w-full h-11 px-3.5 text-sm"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>{lang.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => triggerSave('Organization profile updated.')}
                  className="btn btn-primary px-6 h-11 font-semibold text-sm"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Authentication & Access Security */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Authentication &amp; Access Security</h2>
                <p className="text-xs text-slate-500">Enforce enterprise identity safeguards across all workspace members</p>
              </div>
            </div>

            <div className="property-row">
              <div>
                <span className="text-sm font-medium text-slate-800">Force 2FA with Authenticator App</span>
                <p className="text-xs text-slate-500 mt-0.5">Require all organization members to configure TOTP two-factor authentication</p>
              </div>
              <input
                type="checkbox"
                checked={force2fa}
                onChange={(e) => {
                  setForce2fa(e.target.checked);
                  triggerSave('Two-factor enforcement preference updated.');
                }}
                className="toggle"
              />
            </div>
          </div>

          {/* Card 3: Regulatory Compliance & 21 CFR Part 11 */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Regulatory Compliance &amp; 21 CFR Part 11</h2>
                <p className="text-xs text-slate-500">Configure signature metadata and strict audit certificate adherence</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Add signature ID to the documents</span>
                  <p className="text-xs text-slate-500 mt-0.5">Print unique cryptographic hash identifier below each executed signature field</p>
                </div>
                <input
                  type="checkbox"
                  checked={withSignatureId}
                  onChange={(e) => {
                    setWithSignatureId(e.target.checked);
                    triggerSave('Signature ID display preference updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Require signing reason</span>
                  <p className="text-xs text-slate-500 mt-0.5">Prompt signer to explicitly declare the intent or purpose of their signature (21 CFR Part 11)</p>
                </div>
                <input
                  type="checkbox"
                  checked={requireSigningReason}
                  onChange={(e) => {
                    setRequireSigningReason(e.target.checked);
                    triggerSave('Signing reason requirement updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Combine completed documents and Audit Log</span>
                  <p className="text-xs text-slate-500 mt-0.5">Automatically append the immutable audit trail certificate as the final pages of downloaded PDFs</p>
                </div>
                <input
                  type="checkbox"
                  checked={combinePdfAuditLog}
                  onChange={(e) => {
                    setCombinePdfAuditLog(e.target.checked);
                    triggerSave('PDF audit log combination preference updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Always enforce the signing order</span>
                  <p className="text-xs text-slate-500 mt-0.5">Disallow subsequent signers from accessing the envelope until previous parties complete their step</p>
                </div>
                <input
                  type="checkbox"
                  checked={enforceSigningOrder}
                  onChange={(e) => {
                    setEnforceSigningOrder(e.target.checked);
                    triggerSave('Signing order enforcement updated.');
                  }}
                  className="toggle"
                />
              </div>
            </div>
          </div>

          {/* Card 4: Signer Experience & Link Protection */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Signer Experience &amp; Link Protection</h2>
                <p className="text-xs text-slate-500">Fine-tune verification policies, link expirations, and signer actions</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Expirable file download links</span>
                  <p className="text-xs text-slate-500 mt-0.5">Generate signed download URLs that automatically expire after a set time window</p>
                </div>
                <input
                  type="checkbox"
                  checked={expirableLinks}
                  onChange={(e) => {
                    setExpirableLinks(e.target.checked);
                    triggerSave('Download link expiration updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Require authentication for file download links</span>
                  <p className="text-xs text-slate-500 mt-0.5">Prevent public access to downloaded files unless authenticated via verified email link</p>
                </div>
                <input
                  type="checkbox"
                  checked={requireAuthDownloads}
                  onChange={(e) => {
                    setRequireAuthDownloads(e.target.checked);
                    triggerSave('Authentication requirement updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Remember and pre-fill signatures</span>
                  <p className="text-xs text-slate-500 mt-0.5">Allow returning signers to automatically apply their saved electronic signature</p>
                </div>
                <input
                  type="checkbox"
                  checked={prefillSignatures}
                  onChange={(e) => {
                    setPrefillSignatures(e.target.checked);
                    triggerSave('Signature prefill preference updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Allow to resubmit completed forms</span>
                  <p className="text-xs text-slate-500 mt-0.5">Enable signers to modify responses and request new approvals after completion</p>
                </div>
                <input
                  type="checkbox"
                  checked={allowResubmit}
                  onChange={(e) => {
                    setAllowResubmit(e.target.checked);
                    triggerSave('Resubmission policy updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Allow to decline documents</span>
                  <p className="text-xs text-slate-500 mt-0.5">Provide an explicit 'Decline to Sign' button with mandatory decline reason</p>
                </div>
                <input
                  type="checkbox"
                  checked={allowDecline}
                  onChange={(e) => {
                    setAllowDecline(e.target.checked);
                    triggerSave('Decline option updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Allow to delegate documents</span>
                  <p className="text-xs text-slate-500 mt-0.5">Permit signers to reassign their signing authority to another authorized individual</p>
                </div>
                <input
                  type="checkbox"
                  checked={allowDelegate}
                  onChange={(e) => {
                    setAllowDelegate(e.target.checked);
                    triggerSave('Delegation option updated.');
                  }}
                  className="toggle"
                />
              </div>
            </div>
          </div>

          {/* Card 5: Danger Zone */}
          <div className="bg-rose-50/50 rounded-2xl p-6 border border-rose-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4 pb-4 border-b border-rose-100">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-rose-900">Danger Zone</h2>
                <p className="text-xs text-rose-600">Irreversible actions regarding your organization data and account.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-sm font-semibold text-rose-900">Delete this workspace</span>
                <p className="text-xs text-rose-600 mt-0.5">
                  Once deleted, all templates, active envelopes, and audit logs will be permanently erased.
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm('CAUTION: Are you absolutely certain you want to delete this workspace? This cannot be undone.')) {
                    triggerSave('Workspace deletion initiated.');
                  }
                }}
                className="btn btn-outline btn-error text-xs font-semibold px-4 py-2.5 rounded-xl whitespace-nowrap self-start sm:self-auto"
              >
                Delete Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. PROFILE TAB (Matching Production index.html.erb) */}
      {/* ========================================================================= */}
      {activeTab === 'profile' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Profile</h1>
            <p className="text-sm text-slate-500 mt-1">Manage your personal credentials, digital signature stamps, and account authentication.</p>
          </div>

          {/* Card 1: Personal Profile */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1D72FE] to-[#3B82F6] flex items-center justify-center text-white font-bold text-base shadow-sm">
                {firstName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Personal Information</h2>
                <p className="text-xs text-slate-500">Your profile details displayed to document signers and team members</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">First Name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="base-input w-full h-11 px-3.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Last Name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="base-input w-full h-11 px-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="base-input w-full h-11 px-3.5"
                />
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => triggerSave('Profile credentials updated.')}
                  className="btn btn-primary px-6 h-11 font-semibold text-sm"
                >
                  Update Profile
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Pre-saved Signature & Initials Stamps */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <PenTool className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Pre-saved Signature &amp; Initials</h2>
                <p className="text-xs text-slate-500">Your electronic signature stamps automatically applied when you sign documents</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Signature Box */}
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Signature</span>
                    {hasSavedSignature ? (
                      <span className="badge badge-sm badge-success text-emerald-800 bg-emerald-100">Active</span>
                    ) : (
                      <span className="badge badge-sm badge-neutral bg-slate-100 text-slate-500">None</span>
                    )}
                  </div>
                  <div className="h-28 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-3 relative overflow-hidden">
                    {hasSavedSignature ? (
                      <>
                        <button
                          onClick={() => {
                            setHasSavedSignature(false);
                            triggerSave('Signature stamp removed.');
                          }}
                          className="absolute top-2 right-2 text-xs font-semibold text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-md"
                        >
                          Remove
                        </button>
                        <svg className="w-48 h-12" viewBox="0 0 200 60" fill="none">
                          <path d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28" stroke="#1D72FE" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </>
                    ) : (
                      <div className="text-center text-slate-400">
                        <PenTool className="w-6 h-6 mx-auto mb-1 opacity-40" />
                        <span className="text-xs">No signature saved yet</span>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowSignatureModal(true)}
                  className="btn btn-white w-full text-xs font-semibold py-2.5 rounded-xl mt-4 border border-slate-200 hover:bg-slate-50"
                >
                  Update Signature
                </button>
              </div>

              {/* Initials Box */}
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Initials</span>
                    {hasSavedInitials ? (
                      <span className="badge badge-sm badge-success text-emerald-800 bg-emerald-100">Active</span>
                    ) : (
                      <span className="badge badge-sm badge-neutral bg-slate-100 text-slate-500">None</span>
                    )}
                  </div>
                  <div className="h-28 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-3 relative font-serif text-3xl italic text-[#1D72FE]">
                    {hasSavedInitials ? (
                      <>
                        <button
                          onClick={() => {
                            setHasSavedInitials(false);
                            triggerSave('Initials stamp removed.');
                          }}
                          className="absolute top-2 right-2 text-xs font-semibold text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-md font-sans"
                        >
                          Remove
                        </button>
                        <span>{firstName.charAt(0)}.{lastName.charAt(0)}.</span>
                      </>
                    ) : (
                      <div className="text-center text-slate-400 font-sans">
                        <span className="text-xs">No initials saved yet</span>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowInitialsModal(true)}
                  className="btn btn-white w-full text-xs font-semibold py-2.5 rounded-xl mt-4 border border-slate-200 hover:bg-slate-50"
                >
                  Update Initials
                </button>
              </div>
            </div>
          </div>

          {/* Card 3: Password & Credentials */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Change Password</h2>
                <p className="text-xs text-slate-500">Ensure your account is protected with a long, unique passphrase</p>
              </div>
            </div>

            <div className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">New Password</label>
                <input type="password" placeholder="••••••••••••" className="base-input w-full h-11 px-3.5" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Confirm Password</label>
                <input type="password" placeholder="••••••••••••" className="base-input w-full h-11 px-3.5" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Current Password</label>
                <input type="password" placeholder="••••••••••••" className="base-input w-full h-11 px-3.5" />
                <p className="mt-1.5 text-xs text-slate-500">
                  Forgot your password? <button onClick={() => triggerSave('Password reset link dispatched.')} className="text-[#1D72FE] hover:underline font-semibold">Click here to reset it via email</button>.
                </p>
              </div>
              <div className="pt-2">
                <button onClick={() => triggerSave('Password changed successfully.')} className="btn btn-primary px-6 h-11 font-semibold text-sm">
                  Update Password
                </button>
              </div>
            </div>
          </div>

          {/* Card 4: Two-Factor Authentication */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Two-Factor Authentication (TOTP)</h2>
                <p className="text-xs text-slate-500">Add an extra layer of defense with an authenticator app (TOTP)</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="flex items-center space-x-3">
                {twoFactorConfigured ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {twoFactorConfigured ? '2FA has been configured' : '2FA is not configured'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {twoFactorConfigured 
                      ? 'Your account requires a 6-digit TOTP code on every sign-in.'
                      : 'We strongly recommend enabling 2FA to safeguard your account against unauthorized access.'}
                  </p>
                </div>
              </div>

              <div>
                {twoFactorConfigured ? (
                  <button
                    onClick={() => {
                      setTwoFactorConfigured(false);
                      triggerSave('2FA has been deactivated.');
                    }}
                    className="btn btn-outline btn-error text-xs font-semibold px-4 py-2 rounded-xl"
                  >
                    Remove 2FA
                  </button>
                ) : (
                  <button
                    onClick={() => setShowTwoFactorModal(true)}
                    className="btn btn-primary text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm"
                  >
                    Set up 2FA
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. USERS TAB (Matching Production index.html.erb) */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
                {usersFilter === 'archived' ? 'Archived Users' : usersFilter === 'integration' ? 'Embedding & Integration Users' : 'Users & Team Members'}
              </h1>
              <p className="text-sm text-slate-500 mt-1">Manage team members, permissions, and organization account roles.</p>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowAddUserModal(true)}
                className="btn btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-sm self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                <span>New User</span>
              </button>
            </div>
          </div>

          {/* Subtabs Filter */}
          <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
            {[
              { id: 'all', label: 'All Users' },
              { id: 'archived', label: 'Archived Users' },
              { id: 'integration', label: 'Embedding Users' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setUsersFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  usersFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-4">Name</th>
                    <th className="py-3.5 px-4">Email</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Last Session</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {usersList
                    .filter(u => {
                      if (usersFilter === 'archived') return u.archived;
                      if (usersFilter === 'integration') return u.type === 'integration' && !u.archived;
                      return !u.archived;
                    })
                    .map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-slate-800">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#1D72FE] font-bold text-xs flex items-center justify-center">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <span>{member.name}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">{member.email}</td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                            member.role === 'Owner'
                              ? 'bg-purple-100 text-purple-700'
                              : member.role === 'Admin'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {member.role}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-500">{member.lastSession}</td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center space-x-2 justify-end">
                            {!member.archived ? (
                              <>
                                <button
                                  onClick={() => setEditingUser(member)}
                                  className="btn btn-outline btn-xs rounded-lg font-semibold"
                                >
                                  Edit
                                </button>
                                {member.id !== '1' && (
                                  <button
                                    onClick={() => handleArchiveUser(member.id)}
                                    className="btn btn-outline btn-error btn-xs rounded-lg font-semibold"
                                  >
                                    Archive
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => handleUnarchiveUser(member.id)}
                                className="btn btn-outline btn-xs rounded-lg font-semibold text-[#1D72FE]"
                              >
                                Unarchive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. DIGITAL SIGNATURES TAB (Exact Match to Production: All 3 Certs) */}
      {/* ========================================================================= */}
      {activeTab === 'esign' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
              Digital Signatures &amp; Cryptographic Sealing
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Configure cryptographic digital signing certificates, RFC 3161 timestamps, and signature verification.
            </p>
          </div>

          {/* Card 1: Verify Signed PDF */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Verify Signed PDF</h2>
                <p className="text-xs text-slate-500">Upload any signed document to cryptographically verify its signature validity and timestamp</p>
              </div>
            </div>

            <label className="w-full block p-8 text-center bg-slate-50/60 hover:bg-blue-50/30 rounded-2xl border-2 border-slate-200/80 hover:border-[#1D72FE]/40 border-dashed cursor-pointer transition-all group">
              <div className="flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-slate-200 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform text-[#1D72FE]">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-slate-800 mb-1">Verify Signed PDF</div>
                <div className="text-xs text-slate-500">Click to upload or drag and drop signed PDF files</div>
              </div>
              <input type="file" accept="application/pdf" className="hidden" onChange={handleSimulatePdfVerify} />
            </label>

            {verifyingPdf && (
              <div className="mt-4 p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center space-x-3 text-xs text-blue-800">
                <RefreshCw className="w-4 h-4 animate-spin text-[#1D72FE]" />
                <span>Parsing PDF digital signatures, validating X.509 chains, and checking RFC 3161 timestamp authority...</span>
              </div>
            )}

            {verifyResult && (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Cryptographic Seal Verified (PAdES-LTV)</h4>
                    <p className="text-xs text-emerald-800 mt-1">
                      File: <span className="font-semibold">{verifyResult.fileName}</span> • Signer: {verifyResult.signerName}
                    </p>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      TSA Server: Verified at {verifyResult.timestampTime} via RFC 3161 DigiCert Authority. Document has not been modified since signing.
                    </p>
                  </div>
                </div>
                <span className="badge badge-success text-white text-[10px] font-bold">PAdES Valid</span>
              </div>
            )}
          </div>

          {/* Card 2: Signing Certificates Table (The 3 Exact Certificates Requested) */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#0F172A]">Signing Certificates (X.509 / PKCS#12)</h2>
                  <p className="text-xs text-slate-500">Certificates used to digitally seal and timestamp completed PDF documents</p>
                </div>
              </div>
              <button
                onClick={() => setShowUploadCertModal(true)}
                className="btn btn-primary text-xs font-semibold px-4 py-2 rounded-xl flex items-center space-x-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Upload Certificate</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Valid To</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {certsList.map((cert) => (
                    <tr key={cert.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        <div className="flex items-center space-x-2">
                          {cert.isTrustedDocurama && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          )}
                          <span>{cert.name}</span>
                          {cert.isTrustedDocurama && (
                            <div className="relative group cursor-pointer">
                              <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-64 p-2 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-20 pointer-events-none">
                                Sign documents with trusted certificate provided by Docurama. Your documents and data are never shared with third parties.
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs font-mono">
                        {cert.validTo}
                      </td>
                      <td className="py-3.5 px-4">
                        {cert.status === 'default' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-[#1D72FE]">
                            Default
                          </span>
                        )}
                        {cert.status === 'active' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                            Active
                          </span>
                        )}
                        {cert.status === 'available' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border border-slate-300 text-slate-600">
                            Available
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {cert.status === 'default' ? (
                          <span className="text-xs text-slate-400 font-mono">In Use</span>
                        ) : (
                          <button
                            onClick={() => handleMakeDefaultCert(cert.id)}
                            className="btn btn-outline btn-xs rounded-lg font-semibold hover:bg-slate-100"
                          >
                            Make Default
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Card 3: RFC 3161 Timestamp Server */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">RFC 3161 Timestamp Authority (TSA)</h2>
                <p className="text-xs text-slate-500">Connect to a trusted RFC 3161 Timestamp Authority for tamper-evident timestamps</p>
              </div>
            </div>

            <div className="space-y-4 max-w-xl">
              <div>
                <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  <span>Timeserver URL</span>
                  <div className="relative group cursor-pointer">
                    <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-64 p-2 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-20 pointer-events-none">
                      URL of the trusted RFC 3161 timeserver to be used to generate timestamp signatures.
                    </div>
                  </div>
                </label>
                <input
                  type="url"
                  value={timeserverUrl}
                  onChange={(e) => setTimeserverUrl(e.target.value)}
                  className="base-input w-full h-11 px-3.5 text-sm"
                  placeholder="https://timestamp.digicert.com"
                />
              </div>
              <div className="pt-2">
                <button
                  onClick={() => triggerSave('RFC 3161 TSA endpoint saved and validated.')}
                  className="btn btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold"
                >
                  Save Timeserver URL
                </button>
              </div>
            </div>
          </div>

          {/* Card 4: Preferences */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Preferences</h2>
                <p className="text-xs text-slate-500">Configure PDF flattening, multi-signature behavior, and download naming</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Multiple Digital Signatures</span>
                  <p className="text-xs text-slate-500 mt-0.5">Apply multiple PDF digital signatures in the document per each signer</p>
                </div>
                <input
                  type="checkbox"
                  checked={multiSignatures}
                  onChange={(e) => {
                    setMultiSignatures(e.target.checked);
                    triggerSave('Multiple digital signature preference updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Flatten Form Fields</span>
                  <p className="text-xs text-slate-500 mt-0.5">Remove PDF form fillable fields from the signed PDF (flatten form)</p>
                </div>
                <input
                  type="checkbox"
                  checked={flattenPdf}
                  onChange={(e) => {
                    setFlattenPdf(e.target.checked);
                    triggerSave('PDF form field flattening updated.');
                  }}
                  className="toggle"
                />
              </div>

              <div className="py-4">
                <div className="mb-2">
                  <span className="text-sm font-medium text-slate-800">Document download filename format</span>
                  <p className="text-xs text-slate-500 mt-0.5">Template for naming generated PDF files upon download</p>
                </div>
                <select
                  value={downloadFormat}
                  onChange={(e) => {
                    setDownloadFormat(e.target.value);
                    triggerSave('Download filename format updated.');
                  }}
                  className="base-select bg-slate-50/50 focus:bg-white rounded-xl text-sm max-w-md w-full h-11"
                >
                  <option value="{document.name}.pdf">{'{document.name}'}.pdf</option>
                  <option value="{document.name} - {submission.status}.pdf">{'{document.name}'} - {'{submission.status}'}.pdf</option>
                  <option value="{document.name} - {submission.submitters}.pdf">{'{document.name}'} - {'{submission.submitters}'}.pdf</option>
                  <option value="{document.name} - {submission.submitters} - {submission.completed_at}.pdf">{'{document.name}'} - {'{submission.submitters}'} - {'{submission.completed_at}'}.pdf</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. NOTIFICATIONS TAB (Matching Production index.html.erb) */}
      {/* ========================================================================= */}
      {activeTab === 'notifications' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Email Notifications</h1>
            <p className="text-sm text-slate-500 mt-1">Configure automated completion alerts, audit copies, and scheduled signature reminders.</p>
          </div>

          {/* Card 1: Signer Completion Alerts */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Signer Completion Alerts</h2>
                <p className="text-xs text-slate-500">Receive an email notification immediately when all parties complete signing</p>
              </div>
            </div>

            <div className="property-row">
              <div>
                <span className="text-sm font-medium text-slate-800">Receive notification emails on completed submission</span>
                <p className="text-xs text-slate-500 mt-0.5">Send a confirmation email with download links when the document is completed</p>
              </div>
              <input
                type="checkbox"
                checked={notifyOnComplete}
                onChange={(e) => {
                  setNotifyOnComplete(e.target.checked);
                  triggerSave('Completion alert preference updated.');
                }}
                className="toggle"
              />
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                BCC Compliance Audit Trail Email
              </label>
              <div className="flex gap-3 max-w-xl">
                <input
                  type="email"
                  value={bccAuditEmail}
                  onChange={(e) => setBccAuditEmail(e.target.value)}
                  placeholder="audit@stalfe.com"
                  className="base-input flex-1 h-11 px-3.5"
                />
                <button
                  onClick={() => triggerSave('Compliance BCC address updated.')}
                  className="btn btn-primary px-5 h-11 font-semibold text-sm"
                >
                  Save BCC
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Sign Request Email Reminders */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Sign Request Email Reminders</h2>
                <p className="text-xs text-slate-500">Automatically send reminder emails to signers who haven't completed their documents</p>
              </div>
            </div>

            <div className="text-xs text-slate-500 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
              Send automatic email reminders to your recipients until all documents are signed.
            </div>

            <div className="property-row">
              <div>
                <span className="text-sm font-medium text-slate-800">Enable automated reminder sequence</span>
                <p className="text-xs text-slate-500 mt-0.5">Dispatches periodic friendly notifications to pending recipients</p>
              </div>
              <input
                type="checkbox"
                checked={enableReminders}
                onChange={(e) => {
                  setEnableReminders(e.target.checked);
                  triggerSave('Automated reminders updated.');
                }}
                className="toggle"
              />
            </div>

            {enableReminders && (
              <div className="space-y-4 mt-4 pt-4 border-t border-slate-100 max-w-xl">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">First Reminder</label>
                    <select
                      value={remindDaysAfter}
                      onChange={(e) => setRemindDaysAfter(e.target.value)}
                      className="base-select w-full h-11 text-xs"
                    >
                      <option value="1">After 1 day</option>
                      <option value="3">After 3 days</option>
                      <option value="5">After 5 days</option>
                      <option value="7">After 7 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Repeat Every</label>
                    <select
                      value={repeatRemindDays}
                      onChange={(e) => setRepeatRemindDays(e.target.value)}
                      className="base-select w-full h-11 text-xs"
                    >
                      <option value="2">Every 2 days</option>
                      <option value="3">Every 3 days</option>
                      <option value="5">Every 5 days</option>
                      <option value="7">Every 7 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Max Reminders</label>
                    <select
                      value={maxReminders}
                      onChange={(e) => setMaxReminders(e.target.value)}
                      className="base-select w-full h-11 text-xs"
                    >
                      <option value="1">1 reminder</option>
                      <option value="3">3 reminders</option>
                      <option value="5">5 reminders</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Reminder Subject Template</label>
                  <input
                    type="text"
                    value={reminderSubject}
                    onChange={(e) => setReminderSubject(e.target.value)}
                    className="base-input w-full h-11 text-xs px-3.5"
                  />
                </div>

                <button
                  onClick={() => triggerSave('Reminder schedule parameters updated.')}
                  className="btn btn-primary px-5 h-10 text-xs font-semibold"
                >
                  Save Reminder Rules
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. SMS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'sms' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">SMS Delivery Gateway</h1>
            <p className="text-sm text-slate-500 mt-1">Deliver signature links and 2FA authentication codes directly to signers' mobile devices.</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">SMS Service Provider</h2>
                <p className="text-xs text-slate-500">Configure Twilio API or custom REST webhook integration</p>
              </div>
            </div>

            <div className="space-y-4 max-w-xl">
              <div className="property-row">
                <div>
                  <span className="text-sm font-medium text-slate-800">Enable SMS Deliveries</span>
                  <p className="text-xs text-slate-500 mt-0.5">Send instant SMS alerts alongside email invitations</p>
                </div>
                <input
                  type="checkbox"
                  checked={smsEnabled}
                  onChange={(e) => {
                    setSmsEnabled(e.target.checked);
                    triggerSave('SMS service status toggled.');
                  }}
                  className="toggle"
                />
              </div>

              {smsEnabled && (
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Twilio Account SID</label>
                    <input
                      type="text"
                      value={smsAccountSid}
                      onChange={(e) => setSmsAccountSid(e.target.value)}
                      placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                      className="base-input w-full h-11 px-3.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Twilio Auth Token</label>
                    <input
                      type="password"
                      value={smsAuthToken}
                      onChange={(e) => setSmsAuthToken(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="base-input w-full h-11 px-3.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">From Number / Alphanumeric Sender</label>
                    <input
                      type="text"
                      value={smsFromNumber}
                      onChange={(e) => setSmsFromNumber(e.target.value)}
                      placeholder="+15551234567 or DOCURAMA"
                      className="base-input w-full h-11 px-3.5 text-xs"
                    />
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => triggerSave('Twilio SMS gateway settings saved.')}
                      className="btn btn-primary px-6 h-11 font-semibold text-sm"
                    >
                      Save SMS Gateway
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. API KEYS TAB (Including All /docs/api) */}
      {/* ========================================================================= */}
      {activeTab === 'api' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">API &amp; Developer Access</h1>
              <p className="text-sm text-slate-500 mt-1">Authenticate requests and build workflows using the Docurama REST API.</p>
            </div>
            <div className="flex items-center space-x-2">
              <a
                href="/docs/api"
                target="_blank"
                rel="noreferrer"
                className="btn btn-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center space-x-1.5 border border-slate-200"
              >
                <span>Standalone Docs</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="badge badge-info text-xs font-bold px-3 py-1.5">REST API V1</span>
            </div>
          </div>

          {/* Token Secret Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">API Authentication Token</h2>
                <p className="text-xs text-slate-500">Use this secret token in the <code>X-Auth-Token</code> header of your HTTP requests</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">X-Auth-Token</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-grow flex items-center space-x-2">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={apiToken}
                    readOnly
                    className="base-input font-mono text-xs w-full h-11 px-3.5 bg-slate-50"
                  />
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="btn btn-white h-11 px-3 text-xs"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={() => copyToClipboard(apiToken, 'api-token')}
                    className="btn btn-primary h-11 px-4 flex items-center gap-1.5 text-xs font-semibold"
                  >
                    {copiedKey === 'api-token' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedKey === 'api-token' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <button
                  onClick={() => setShowRotateKeyModal(true)}
                  className="btn btn-white h-11 px-4 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Rotate</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quickstart cURL Accordions Matching Production */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">API Endpoints &amp; Integration Quickstart</h2>
                <p className="text-xs text-slate-500">cURL examples for submitting document requests and inspecting templates</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Endpoint 1 */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-800 border border-amber-300 font-mono font-bold text-[11px] px-2 py-0.5 rounded">POST</span>
                    <span className="text-sm font-semibold text-slate-800">Request signature (multiple submitters with default values)</span>
                  </div>
                  <code className="text-xs text-slate-500 font-mono hidden sm:inline">/api/submissions</code>
                </div>
                <div className="bg-slate-900 rounded-xl p-3.5 text-xs font-mono text-slate-200 overflow-x-auto relative">
                  <button
                    onClick={() => copyToClipboard(`curl --location '${window.location.origin}/api/submissions' \\\n  --header 'X-Auth-Token: ${apiToken}' \\\n  --data-raw '{\n    "template_id": 1,\n    "submitters": [\n      {\n        "name": "John Doe",\n        "role": "First Party",\n        "email": "signer@example.com",\n        "values": { "Full Name": "John Doe" }\n      }\n    ]\n  }'`, 'curl-1')}
                    className="absolute top-2 right-2 btn btn-ghost btn-xs text-white/80 hover:text-white"
                  >
                    {copiedKey === 'curl-1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <pre>{`curl --location '${window.location.origin}/api/submissions' \\
  --header 'X-Auth-Token: ${apiToken}' \\
  --data-raw '{
    "template_id": 1,
    "submitters": [
      {
        "name": "John Doe",
        "role": "First Party",
        "email": "signer@example.com",
        "values": {
          "Full Name": "John Doe"
        }
      }
    ]
  }'`}</pre>
                </div>
              </div>

              {/* Endpoint 2 */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-800 border border-amber-300 font-mono font-bold text-[11px] px-2 py-0.5 rounded">POST</span>
                    <span className="text-sm font-semibold text-slate-800">Request signature (single submitter)</span>
                  </div>
                  <code className="text-xs text-slate-500 font-mono hidden sm:inline">/api/submissions/emails</code>
                </div>
                <div className="bg-slate-900 rounded-xl p-3.5 text-xs font-mono text-slate-200 overflow-x-auto relative">
                  <button
                    onClick={() => copyToClipboard(`curl --location '${window.location.origin}/api/submissions/emails' \\\n  --header 'X-Auth-Token: ${apiToken}' \\\n  --data-raw '{\n    "template_id": 1,\n    "emails": "signer@example.com"\n  }'`, 'curl-2')}
                    className="absolute top-2 right-2 btn btn-ghost btn-xs text-white/80 hover:text-white"
                  >
                    {copiedKey === 'curl-2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <pre>{`curl --location '${window.location.origin}/api/submissions/emails' \\
  --header 'X-Auth-Token: ${apiToken}' \\
  --data-raw '{
    "template_id": 1,
    "emails": "signer@example.com"
  }'`}</pre>
                </div>
              </div>
            </div>
          </div>

          {/* Complete Interactive API Documentation Explorer (/docs/api Included) */}
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-[#1D72FE]" />
                <h2 className="text-lg font-bold text-[#0F172A]">Complete API Reference &amp; Schemas</h2>
              </div>
              <span className="text-xs text-slate-500">Interactive API documentation</span>
            </div>
            
            <ApiDocsPage embedded={true} />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. MCP SERVER TAB (Matching Production index.html.erb) */}
      {/* ========================================================================= */}
      {activeTab === 'mcp' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
                Model Context Protocol (MCP) Server
              </h1>
              <p className="text-sm text-slate-500 mt-1">Connect AI coding assistants and autonomous agents directly to Docurama tools.</p>
            </div>
            <button
              onClick={() => setShowNewMcpTokenModal(true)}
              className="btn btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-sm self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>New Token</span>
            </button>
          </div>

          {/* Active MCP Token Notification Banner */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Please copy the token below now as it won't be shown again:
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={mcpToken}
                readOnly
                className="base-input font-mono text-xs w-full h-11 px-3.5 bg-slate-50"
              />
              <button
                onClick={() => copyToClipboard(mcpToken, 'mcp-token')}
                className="btn btn-primary h-11 px-6 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
              >
                {copiedKey === 'mcp-token' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copiedKey === 'mcp-token' ? 'Copied' : 'Copy Token'}</span>
              </button>
            </div>
          </div>

          {/* Instructions Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-6">
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">Connect to Docurama MCP</h2>
                <p className="text-xs text-slate-500">Add the following to your MCP client configuration:</p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto text-xs font-mono text-slate-200 relative">
              <button
                onClick={() => copyToClipboard(JSON.stringify({
                  mcpServers: {
                    docurama: {
                      type: "http",
                      url: `${window.location.origin}/mcp`,
                      headers: {
                        Authorization: `Bearer ${mcpToken}`
                      }
                    }
                  }
                }, null, 2), 'mcp-json')}
                className="absolute top-3 right-3 btn btn-ghost btn-xs text-white/80 hover:text-white"
              >
                {copiedKey === 'mcp-json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <pre>{JSON.stringify({
                mcpServers: {
                  docurama: {
                    type: "http",
                    url: `${window.location.origin}/mcp`,
                    headers: {
                      Authorization: `Bearer ${mcpToken}`
                    }
                  }
                }
              }, null, 2)}</pre>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-600">
                Works with Claude Desktop, Cursor, Windsurf, VS Code, and any MCP-compatible client.
              </div>
              <a
                href={`https://vscode.dev/redirect/mcp/install?name=Docurama&config=${encodeURIComponent(JSON.stringify({ type: 'http', url: `${window.location.origin}/mcp` }))}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center space-x-1.5 border border-slate-200 self-start sm:self-auto"
              >
                <span>Install in VS Code</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* MCP Tools Catalog */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Exposed Agent Tools</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { name: 'docurama_list_templates', desc: 'Fetch all document templates with their roles and field schemas' },
                  { name: 'docurama_get_template', desc: 'Retrieve full fields and signature placement coordinates for a template' },
                  { name: 'docurama_create_submission', desc: 'Dispatch signature requests to signers with prefilled form values' },
                  { name: 'docurama_get_submission_status', desc: 'Poll completion status and download cryptographic PAdES PDF' },
                  { name: 'docurama_verify_document', desc: 'Cryptographically verify X.509 certificates and RFC 3161 timestamps' }
                ].map(tool => (
                  <div key={tool.name} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                    <span className="font-mono font-semibold text-xs text-[#1D72FE]">{tool.name}</span>
                    <p className="text-[11px] text-slate-500 mt-1">{tool.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. New User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Invite New User</h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">First Name</label>
                  <input
                    type="text"
                    value={newUserFirstName}
                    onChange={(e) => setNewUserFirstName(e.target.value)}
                    placeholder="Jane"
                    className="base-input w-full h-10 text-xs px-3"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={newUserLastName}
                    onChange={(e) => setNewUserLastName(e.target.value)}
                    placeholder="Doe"
                    className="base-input w-full h-10 text-xs px-3"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="base-input w-full h-10 text-xs px-3"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Role &amp; Permissions</label>
                <div className="space-y-2">
                  {[
                    { role: 'Owner', desc: 'Full administrative access including workspace billing and deletion' },
                    { role: 'Admin', desc: 'Manage templates, submissions, users, and organization settings' },
                    { role: 'Member', desc: 'Create, edit, and send document templates and view submissions' }
                  ].map(r => (
                    <label
                      key={r.role}
                      className={`flex items-start p-3 rounded-xl border cursor-pointer transition-all ${
                        newUserRole === r.role
                          ? 'border-[#1D72FE] bg-blue-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="user_role"
                        checked={newUserRole === r.role}
                        onChange={() => setNewUserRole(r.role as any)}
                        className="mt-0.5 text-[#1D72FE]"
                      />
                      <div className="ml-3">
                        <span className="text-xs font-bold text-slate-900 block">{r.role}</span>
                        <span className="text-[11px] text-slate-500">{r.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Upload Certificate Modal */}
      {showUploadCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Upload Digital Certificate (PKCS#12)</h3>
              <button onClick={() => setShowUploadCertModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadCert} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Certificate Name</label>
                <input
                  type="text"
                  required
                  value={uploadCertName}
                  onChange={(e) => setUploadCertName(e.target.value)}
                  placeholder="e.g. Corporate Signing Key 2026"
                  className="base-input w-full h-10 text-xs px-3"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">PKCS#12 File (.p12 / .pfx)</label>
                <input
                  type="file"
                  accept=".p12,.pfx"
                  required
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1D72FE] hover:file:bg-blue-100 text-xs text-slate-500 w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Passphrase (optional)</label>
                <input
                  type="password"
                  value={uploadCertPassphrase}
                  onChange={(e) => setUploadCertPassphrase(e.target.value)}
                  placeholder="Certificate private key passphrase"
                  className="base-input w-full h-10 text-xs px-3"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadCertModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Upload &amp; Activate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Rotate Key Confirmation Modal */}
      {showRotateKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 mb-3 text-amber-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">Rotate API Token</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Rotating your API token will immediately invalidate your existing key. Any integrated scripts, bots, or MCP servers using this key will immediately fail authentication until updated.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRotateKeyModal(false)}
                className="btn btn-white text-xs px-4 h-10"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const newToken = 'docurama_sec_live_' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
                  setApiToken(newToken);
                  setShowRotateKeyModal(false);
                  triggerSave('API Token rotated successfully.');
                }}
                className="btn btn-primary text-xs px-5 h-10 font-semibold bg-rose-600 hover:bg-rose-700 border-none"
              >
                Confirm &amp; Rotate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Two-Factor Authentication Modal */}
      {showTwoFactorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Set Up Two-Factor Authentication</h3>
              <button onClick={() => setShowTwoFactorModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Scan this QR code using Google Authenticator, Authy, or 1Password, or manually copy the secret key below:
              </p>

              {/* QR Code Mockup */}
              <div className="flex justify-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="w-36 h-36 bg-white p-2 border border-slate-300 rounded-lg shadow-xs flex flex-col items-center justify-center text-slate-800">
                  <QrCode className="w-24 h-24" />
                  <span className="text-[9px] font-mono mt-1 text-slate-500 font-bold">DOCURAMA 2FA</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Secret Key</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value="JBSWY3DPEHPK3PXP"
                    readOnly
                    className="base-input font-mono text-xs w-full h-9 px-3 bg-slate-50"
                  />
                  <button
                    onClick={() => copyToClipboard('JBSWY3DPEHPK3PXP', 'totp-key')}
                    className="btn btn-white h-9 px-3 text-xs"
                  >
                    {copiedKey === 'totp-key' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Verification Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={totpInputCode}
                  onChange={(e) => setTotpInputCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="base-input font-mono text-center tracking-widest text-lg w-full h-11"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTwoFactorModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTwoFactorConfigured(true);
                    setShowTwoFactorModal(false);
                    setTotpInputCode('');
                    triggerSave('Two-factor authentication successfully enabled.');
                  }}
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Verify &amp; Activate 2FA
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Update Signature Pad Modal */}
      {showSignatureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-lg w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Update Pre-saved Signature</h3>
              <button onClick={() => setShowSignatureModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Draw your signature stamp in the pad below or upload a high-resolution PNG image with transparent background.
              </p>

              <div className="h-44 rounded-xl border-2 border-dashed border-slate-300 bg-white flex flex-col items-center justify-center relative cursor-crosshair">
                <svg className="w-64 h-24" viewBox="0 0 200 60" fill="none">
                  <path d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28" stroke="#1D72FE" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="absolute bottom-2 text-[10px] text-slate-400">Signature Stamp Canvas</span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Format: Vector SVG &amp; PNG</span>
                <label className="text-[#1D72FE] hover:underline cursor-pointer font-semibold">
                  Upload image file
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={() => {
                    setHasSavedSignature(true);
                    setShowSignatureModal(false);
                    triggerSave('Signature stamp uploaded.');
                  }} />
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSignatureModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHasSavedSignature(true);
                    setShowSignatureModal(false);
                    triggerSave('Pre-saved signature stamp saved.');
                  }}
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Save Signature
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Update Initials Modal */}
      {showInitialsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Update Pre-saved Initials</h3>
              <button onClick={() => setShowInitialsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Initials Text</label>
                <input
                  type="text"
                  maxLength={3}
                  value={initialsText}
                  onChange={(e) => setInitialsText(e.target.value.toUpperCase())}
                  className="base-input font-bold text-center text-xl w-full h-12 uppercase"
                />
              </div>

              <div className="h-28 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center font-serif text-4xl italic text-[#1D72FE]">
                {initialsText.split('').join('.')}.
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowInitialsModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHasSavedInitials(true);
                    setShowInitialsModal(false);
                    triggerSave('Initials stamp saved.');
                  }}
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Save Initials
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. New MCP Token Modal */}
      {showNewMcpTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">Generate New MCP Server Token</h3>
              <button onClick={() => setShowNewMcpTokenModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Token Name / Client Label</label>
                <input
                  type="text"
                  value={newMcpTokenName}
                  onChange={(e) => setNewMcpTokenName(e.target.value)}
                  placeholder="e.g. Claude Desktop / Cursor Workstation"
                  className="base-input w-full h-10 text-xs px-3"
                />
              </div>

              <p className="text-xs text-slate-500">
                A new Bearer token will be generated for connecting AI coding subagents to Docurama tools.
              </p>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewMcpTokenModal(false)}
                  className="btn btn-white text-xs px-4 h-10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const newToken = 'mcp_sec_' + Math.random().toString(36).substring(2, 16);
                    setMcpToken(newToken);
                    setShowNewMcpTokenModal(false);
                    setNewMcpTokenName('');
                    triggerSave('New MCP token generated. Please copy it immediately.');
                  }}
                  className="btn btn-primary text-xs px-5 h-10 font-semibold"
                >
                  Create Token
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
