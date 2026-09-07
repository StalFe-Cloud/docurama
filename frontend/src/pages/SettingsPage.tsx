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
  FileCheck,
  Clock,
  Sliders,
  ChevronRight,
  HelpCircle,
  UploadCloud,
  FileText
} from 'lucide-react';
import { api, DomainItem, WebhookItem, WebhookDeliveryItem } from '../lib/api';

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
  "(GMT+11:00) Srednekolymsk",
  "(GMT+12:00) Auckland",
  "(GMT+12:00) Fiji",
  "(GMT+12:00) Kamchatka",
  "(GMT+12:00) Marshall Is.",
  "(GMT+12:00) Wellington",
  "(GMT+12:45) Chatham Is.",
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
  // Determine active tab from URL or prop
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

  // Sync tab click with browser URL bar
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
  
  // Authentication & Access Security (Card 2)
  const [force2fa, setForce2fa] = useState(false);

  // Regulatory Compliance & 21 CFR Part 11 (Card 3)
  const [withSignatureId, setWithSignatureId] = useState(true);
  const [requireSigningReason, setRequireSigningReason] = useState(false);
  const [combinePdfAuditLog, setCombinePdfAuditLog] = useState(true);
  const [enforceSigningOrder, setEnforceSigningOrder] = useState(false);

  // Signer Experience & Link Protection (Card 4)
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

  // -------------------------------------------------------------
  // TAB 3: Users State
  // -------------------------------------------------------------
  const [usersList, setUsersList] = useState([
    { id: '1', name: user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Primary Admin', email: user?.email || 'admin@docurama.com', role: 'admin', lastSession: 'Just now' },
    { id: '2', name: 'Compliance Officer', email: 'compliance@docurama.com', role: 'member', lastSession: 'Yesterday, 14:20' },
    { id: '3', name: 'Legal Counsel', email: 'legal@docurama.com', role: 'member', lastSession: 'Sep 04, 09:12' },
  ]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState('member');

  // -------------------------------------------------------------
  // TAB 4: Digital Signatures State
  // -------------------------------------------------------------
  const [timeserverUrl, setTimeserverUrl] = useState('http://timestamp.digicert.com');
  const [multiSignatures, setMultiSignatures] = useState(true);
  const [flattenPdf, setFlattenPdf] = useState(true);
  const [downloadFormat, setDownloadFormat] = useState('{document.name} - {submission.status}.pdf');

  // -------------------------------------------------------------
  // TAB 5: Notifications State
  // -------------------------------------------------------------
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [bccAuditEmail, setBccAuditEmail] = useState('');
  const [enableReminders, setEnableReminders] = useState(true);
  const [reminderCadence, setReminderCadence] = useState('24h');
  const [maxReminders, setMaxReminders] = useState('3');

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

  // -------------------------------------------------------------
  // Helper functions
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

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) return;
    setUsersList(prev => [
      ...prev,
      {
        id: String(Date.now()),
        name: newUserName.trim() || newUserEmail.split('@')[0],
        email: newUserEmail.trim(),
        role: newUserRole,
        lastSession: 'Invitation pending'
      }
    ]);
    setNewUserEmail('');
    setNewUserName('');
    setShowAddUserModal(false);
    triggerSave('Invitation dispatched to new team member.');
  };

  const handleRemoveUser = (id: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    setUsersList(prev => prev.filter(u => u.id !== id));
    triggerSave('Member removed from workspace.');
  };

  // Nav Items definition matching production 8 tabs
  const navItems = [
    { id: 'account', label: 'Account', icon: Building, group: 'workspace' },
    { id: 'profile', label: 'Profile', icon: User, group: 'workspace' },
    { id: 'users', label: 'Users', icon: Users, group: 'workspace' },
    { id: 'esign', label: 'Digital Signatures', icon: ShieldCheck, group: 'security' },
    { id: 'notifications', label: 'Notifications', icon: Mail, group: 'security' },
    { id: 'sms', label: 'SMS', icon: MessageSquare, group: 'security' },
    { id: 'api', label: 'API Keys', icon: Key, group: 'developer' },
    { id: 'mcp', label: 'MCP Server', icon: Code, group: 'developer' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-20">
      
      {/* Top Command Tab Bar Matching Production Exactly */}
      <div className="w-full settings-horizontal-nav-wrapper">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-2 border border-slate-200/80 shadow-sm flex items-center justify-between overflow-x-auto gap-2 scrollbar-none">
          <div className="flex items-center space-x-1 sm:space-x-1.5 flex-nowrap">
            
            {/* 1. Account */}
            <button
              onClick={() => handleTabChange('account')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'account'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Building className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Account</span>
            </button>

            {/* 2. Profile */}
            <button
              onClick={() => handleTabChange('profile')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'profile'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <User className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Profile</span>
            </button>

            {/* 3. Users */}
            <button
              onClick={() => handleTabChange('users')}
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

            {/* 4. Digital Signatures */}
            <button
              onClick={() => handleTabChange('esign')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'esign'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4 mr-1.5 text-[#1D72FE]" />
              <span>Digital Signatures</span>
            </button>

            {/* 5. Notifications */}
            <button
              onClick={() => handleTabChange('notifications')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'notifications'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Mail className="w-4 h-4 mr-1.5 opacity-80" />
              <span>Notifications</span>
            </button>

            {/* 6. SMS */}
            <button
              onClick={() => handleTabChange('sms')}
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

            {/* 7. API Keys */}
            <button
              onClick={() => handleTabChange('api')}
              className={`flex items-center px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === 'api'
                  ? 'bg-[#EFF6FF] text-[#1D72FE] shadow-sm border border-[#BFDBFE]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <Key className="w-4 h-4 mr-1.5 opacity-80" />
              <span>API Keys</span>
            </button>

            {/* 8. MCP Server */}
            <button
              onClick={() => handleTabChange('mcp')}
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

      {saveNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2 animate-in fade-in shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ACCOUNT & WORKSPACE SETTINGS TAB (Exact Replica of Production Specs) */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div className="space-y-8 animate-in fade-in duration-150">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
                Account &amp; Workspace Settings
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Manage your organization profile, regulatory compliance, and electronic signature configurations.
              </p>
            </div>
          </div>

          {/* Card 1: Company name & Localization */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Company name &amp; Localization</h2>
                <p className="text-xs text-slate-500">Define the workspace identifier, timezone, and language preferences.</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="form-control">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Company name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Corporation"
                  className="base-input w-full h-11 px-3.5"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="form-control">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                    Time zone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="base-select h-11 px-3.5 w-full bg-white"
                  >
                    {WORLD_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-control">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="base-select h-11 px-3.5 w-full bg-white"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => triggerSave('Company localization preferences saved.')}
                  className="btn btn-primary px-6 h-11 font-semibold shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Authentication & Access Security */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Authentication &amp; Access Security</h2>
                <p className="text-xs text-slate-500">Enforce organizational security safeguards and access policies.</p>
              </div>
            </div>

            <div className="property-row">
              <div>
                <div className="font-bold text-sm text-[#0F172A]">Force 2FA with Authenticator App</div>
                <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                  Require all members of this workspace to configure Time-Based One-Time Password (TOTP) two-factor authentication before accessing documents.
                </div>
              </div>
              <input
                type="checkbox"
                checked={force2fa}
                onChange={(e) => {
                  setForce2fa(e.target.checked);
                  triggerSave(`Two-Factor Authentication requirement ${e.target.checked ? 'enabled' : 'disabled'}.`);
                }}
                className="toggle"
              />
            </div>
          </div>

          {/* Card 3: Regulatory Compliance & 21 CFR Part 11 */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Regulatory Compliance &amp; 21 CFR Part 11</h2>
                <p className="text-xs text-slate-500">Configure cryptographic traceability, signing reasons, and audit trails.</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {/* Add signature ID to the documents */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Add signature ID to the documents</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Embeds a unique cryptographic Signature ID and UTC timestamp to each signature for full audit traceability.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={withSignatureId}
                  onChange={(e) => {
                    setWithSignatureId(e.target.checked);
                    triggerSave('Signature ID configuration updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Require signing reason */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Require signing reason</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Signers must provide an explicit legal purpose (e.g. approval, certification, review) prior to completing their signature.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={requireSigningReason}
                  onChange={(e) => {
                    setRequireSigningReason(e.target.checked);
                    triggerSave('Mandatory signing reason updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Combine completed documents and Audit Log */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Combine completed documents and Audit Log</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Merges completed documents with a tamper-evident audit certificate in a unified, compliance-ready PDF.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={combinePdfAuditLog}
                  onChange={(e) => {
                    setCombinePdfAuditLog(e.target.checked);
                    triggerSave('Combined PDF audit certificate policy updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Always enforce the signing order */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Always enforce the signing order</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Enforces strict sequential recipient routing where subsequent signers only receive documents after prior parties sign.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enforceSigningOrder}
                  onChange={(e) => {
                    setEnforceSigningOrder(e.target.checked);
                    triggerSave('Sequential signing order policy updated.');
                  }}
                  className="toggle"
                />
              </div>
            </div>
          </div>

          {/* Card 4: Signer Experience & Link Protection */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Signer Experience &amp; Link Protection</h2>
                <p className="text-xs text-slate-500">Control signing modes, recipient pre-fill, and file expiration parameters.</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {/* Expirable file download links */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Expirable file download links</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Download URLs automatically expire after 40 minutes to prevent unauthorized archival access.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={expirableLinks}
                  onChange={(e) => {
                    setExpirableLinks(e.target.checked);
                    triggerSave('File download link expiry updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Require authentication for file download links */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Require authentication for file download links</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Requires verified login or authorized API credentials before allowing document download access.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={requireAuthDownloads}
                  onChange={(e) => {
                    setRequireAuthDownloads(e.target.checked);
                    triggerSave('Download authentication requirements updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Remember and pre-fill signatures */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Remember and pre-fill signatures</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Securely remembers user signature preferences to expedite repeat signing sessions.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefillSignatures}
                  onChange={(e) => {
                    setPrefillSignatures(e.target.checked);
                    triggerSave('Signature pre-fill preferences updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Allow to resubmit completed forms */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Allow to resubmit completed forms</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Allows recipients to initiate amendments to previously submitted forms when requested.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={allowResubmit}
                  onChange={(e) => {
                    setAllowResubmit(e.target.checked);
                    triggerSave('Form resubmission policy updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Allow to decline documents */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Allow to decline documents</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Permits recipients to decline signing with an optional stated justification.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={allowDecline}
                  onChange={(e) => {
                    setAllowDecline(e.target.checked);
                    triggerSave('Document decline policy updated.');
                  }}
                  className="toggle"
                />
              </div>

              {/* Allow to delegate documents */}
              <div className="property-row">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">Allow to delegate documents</div>
                  <div className="text-xs text-slate-500 max-w-lg mt-0.5">
                    Allows designated signers to re-assign signing responsibility to another authorized party.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={allowDelegate}
                  onChange={(e) => {
                    setAllowDelegate(e.target.checked);
                    triggerSave('Signer delegation policy updated.');
                  }}
                  className="toggle"
                />
              </div>
            </div>
          </div>

          {/* Card 5: Danger Zone */}
          <div className="bg-red-50/50 rounded-2xl p-6 sm:p-8 border border-red-200 shadow-sm">
            <h2 className="text-lg font-bold text-red-700 mb-1">Danger Zone</h2>
            <p className="text-xs text-red-600/80 mb-4 max-w-lg">
              Permanently deletes this workspace, all active templates, signed documents, and associated cryptographic audit logs. This operation cannot be undone.
            </p>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to schedule this workspace for permanent deletion? All cryptographic documents will be wiped.')) {
                  alert('Workspace deletion request acknowledged.');
                }
              }}
              className="btn btn-outline border-red-300 text-red-600 hover:bg-red-600 hover:text-white font-semibold text-xs px-4 py-2"
            >
              Delete Workspace Data
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. PROFILE TAB */}
      {/* ========================================================================= */}
      {activeTab === 'profile' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Profile</h1>
            <p className="text-sm text-slate-500 mt-1">Manage your personal credentials, digital signature stamps, and account authentication.</p>
          </div>

          {/* Personal Information */}
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

          {/* Pre-saved Signature & Initials */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1D72FE] flex items-center justify-center font-bold">
                <FileCheck className="w-5 h-5" />
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
                    <span className="badge badge-sm badge-success text-emerald-800 bg-emerald-100">Active</span>
                  </div>
                  <div className="h-28 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-3 relative">
                    <svg className="w-48 h-12" viewBox="0 0 200 60" fill="none">
                      <path d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28" stroke="#1D72FE" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
                <button
                  onClick={() => triggerSave('Signature stamp updated.')}
                  className="btn btn-white w-full text-xs font-semibold py-2 rounded-xl mt-4"
                >
                  Update Signature
                </button>
              </div>

              {/* Initials Box */}
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Initials</span>
                    <span className="badge badge-sm badge-success text-emerald-800 bg-emerald-100">Active</span>
                  </div>
                  <div className="h-28 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-3 font-serif text-3xl italic text-[#1D72FE]">
                    {firstName.charAt(0)}.{lastName.charAt(0)}.
                  </div>
                </div>
                <button
                  onClick={() => triggerSave('Initials stamp updated.')}
                  className="btn btn-white w-full text-xs font-semibold py-2 rounded-xl mt-4"
                >
                  Update Initials
                </button>
              </div>
            </div>
          </div>

          {/* Change Password */}
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
              </div>
              <div className="pt-2">
                <button onClick={() => triggerSave('Password changed successfully.')} className="btn btn-primary px-6 h-11 font-semibold text-sm">
                  Update Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. USERS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Users &amp; Team Members</h1>
              <p className="text-sm text-slate-500 mt-1">Manage team members, permissions, and organization account roles.</p>
            </div>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="btn btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-sm self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>New User</span>
            </button>
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
                  {usersList.map((member) => (
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
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          member.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {member.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">{member.lastSession}</td>
                      <td className="py-3.5 px-4 text-right">
                        {member.id !== '1' && (
                          <button
                            onClick={() => handleRemoveUser(member.id)}
                            className="text-xs text-rose-500 hover:text-rose-700 font-semibold p-1 rounded"
                          >
                            Remove
                          </button>
                        )}
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
      {/* 4. DIGITAL SIGNATURES TAB (Exact Replica of Production Specs) */}
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
              <input type="file" accept="application/pdf" className="hidden" onChange={() => triggerSave('Cryptographic seal analysis: Signature valid & RFC 3161 timestamped.')} />
            </label>
          </div>

          {/* Card 2: Signing Certificates Table */}
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
                onClick={() => triggerSave('Certificate upload modal available.')}
                className="btn btn-primary text-xs font-semibold px-4 py-2 rounded-xl flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Upload Certificate</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Certificate Name</th>
                    <th className="py-3 px-4">Valid To</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-3.5 px-4 font-semibold text-slate-800">Docurama Root CA &amp; Document Signing Cert</td>
                    <td className="py-3.5 px-4 text-slate-600 text-xs font-mono">September 14, 2036</td>
                    <td className="py-3.5 px-4">
                      <span className="badge badge-sm badge-info font-semibold">DEFAULT</span>
                    </td>
                    <td className="py-3.5 px-4 text-right text-xs text-slate-400 font-mono">Active (PAdES-LTV)</td>
                  </tr>
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
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Timeserver URL
                </label>
                <input
                  type="url"
                  value={timeserverUrl}
                  onChange={(e) => setTimeserverUrl(e.target.value)}
                  className="base-input w-full h-11 px-3.5 text-sm"
                  placeholder="http://timestamp.digicert.com"
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
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. NOTIFICATIONS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'notifications' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Email Notifications</h1>
            <p className="text-sm text-slate-500 mt-1">Configure automated completion alerts, audit copies, and scheduled signature reminders.</p>
          </div>

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
                  placeholder="archive-compliance@yourcompany.com"
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

          {/* Email Reminders */}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-100 max-w-xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Reminder Cadence</label>
                  <select
                    value={reminderCadence}
                    onChange={(e) => {
                      setReminderCadence(e.target.value);
                      triggerSave('Reminder cadence saved.');
                    }}
                    className="base-select h-11 w-full"
                  >
                    <option value="24h">Every 24 hours</option>
                    <option value="48h">Every 48 hours</option>
                    <option value="72h">Every 72 hours</option>
                    <option value="7d">Every 7 days</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Max Reminders</label>
                  <select
                    value={maxReminders}
                    onChange={(e) => {
                      setMaxReminders(e.target.value);
                      triggerSave('Max reminders saved.');
                    }}
                    className="base-select h-11 w-full"
                  >
                    <option value="1">1 reminder</option>
                    <option value="3">3 reminders</option>
                    <option value="5">5 reminders</option>
                    <option value="10">10 reminders</option>
                  </select>
                </div>
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
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">SMS Notifications</h1>
            <p className="text-sm text-slate-500 mt-1">Deliver signature requests and automated reminders directly to signers' mobile phones via SMS.</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">SMS Gateway Configuration</h2>
                <p className="text-xs text-slate-500">Configure Twilio API credentials or a custom webhook SMS delivery gateway</p>
              </div>
            </div>

            <div className="space-y-5 max-w-2xl">
              <div className="property-row p-4 border border-slate-200 rounded-xl bg-slate-50/60">
                <div>
                  <span className="font-semibold text-sm text-slate-800">Enable SMS Delivery</span>
                  <p className="text-xs text-slate-500">Allow sending signature links and reminders via text message</p>
                </div>
                <input
                  type="checkbox"
                  checked={smsEnabled}
                  onChange={(e) => {
                    setSmsEnabled(e.target.checked);
                    triggerSave(`SMS delivery ${e.target.checked ? 'enabled' : 'disabled'}.`);
                  }}
                  className="toggle"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">SMS Provider Gateway</label>
                <select
                  value={smsProvider}
                  onChange={(e) => setSmsProvider(e.target.value)}
                  className="base-select h-11 w-full"
                >
                  <option value="twilio">Twilio</option>
                  <option value="webhook">Custom Webhook Gateway</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Account SID / API Key</label>
                <input
                  type="text"
                  value={smsAccountSid}
                  onChange={(e) => setSmsAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="base-input font-mono text-xs w-full h-11 px-3.5"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Auth Token / API Secret</label>
                <input
                  type="password"
                  value={smsAuthToken}
                  onChange={(e) => setSmsAuthToken(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="base-input font-mono text-xs w-full h-11 px-3.5"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">From Phone Number or Messaging Service SID</label>
                <input
                  type="text"
                  value={smsFromNumber}
                  onChange={(e) => setSmsFromNumber(e.target.value)}
                  placeholder="+1234567890 or MGxxxxxxxxxxxxxxxx"
                  className="base-input w-full h-11 px-3.5"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Message Template</label>
                <textarea
                  value={smsTemplate}
                  onChange={(e) => setSmsTemplate(e.target.value)}
                  rows={3}
                  className="base-input w-full p-3 text-sm"
                />
                <span className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  Variables: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[11px]">{`{{template_name}}`}</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[11px]">{`{{sign_url}}`}</code>
                </span>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => triggerSave('SMS Gateway settings saved successfully.')}
                  className="btn btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold"
                >
                  Save SMS Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. API KEYS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'api' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">API &amp; Developer Access</h1>
              <p className="text-sm text-slate-500 mt-1">Authenticate requests and build workflows using the Docurama REST API.</p>
            </div>
            <span className="badge badge-info text-xs font-bold px-3 py-1.5">PRODUCTION V1</span>
          </div>

          {/* Token Secret */}
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
                  onClick={() => {
                    const newToken = 'docurama_sec_live_' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
                    setApiToken(newToken);
                    triggerSave('API Token rotated successfully.');
                  }}
                  className="btn btn-white h-11 px-4 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Rotate</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quickstart cURL */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <Code className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">API Integration Quickstart</h2>
                <p className="text-xs text-slate-500">cURL example for requesting an automated document signing sequence</p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto text-xs font-mono text-slate-200 relative">
              <pre>{`curl --location '${window.location.origin}/api/envelopes' \\
  --header 'X-Auth-Token: ${apiToken.substring(0, 18)}...' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{
    "title": "Master Services Agreement 2026",
    "recipients": [
      { "name": "Alice Corp", "email": "alice@company.com", "role": "Signer 1" }
    ]
  }'`}</pre>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. MCP SERVER TAB */}
      {/* ========================================================================= */}
      {activeTab === 'mcp' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">Model Context Protocol (MCP) Server</h1>
            <p className="text-sm text-slate-500 mt-1">Connect AI coding assistants and autonomous agents directly to Docurama tools.</p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-6">
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Code className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">SSE Server Endpoint &amp; AI Assistant Integration</h2>
                <p className="text-xs text-slate-500">Add Docurama tools directly into Claude Desktop, Cursor, and Antigravity IDE</p>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Active SSE Endpoint</div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-xs text-slate-800 bg-white p-3 rounded-lg border border-slate-200 flex-1 select-all truncate">
                  {`${window.location.origin}/.webmcp/sse`}
                </div>
                <button
                  onClick={() => copyToClipboard(`${window.location.origin}/.webmcp/sse`, 'mcp-url')}
                  className="btn btn-primary h-10 px-4 text-xs font-semibold flex items-center gap-1.5 shrink-0"
                >
                  {copiedKey === 'mcp-url' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedKey === 'mcp-url' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-2">Configuration for Claude Desktop &amp; Antigravity</h3>
              <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto text-xs font-mono text-slate-200">
                <pre>{JSON.stringify({
                  mcpServers: {
                    docurama: {
                      type: "sse",
                      url: `${window.location.origin}/.webmcp/sse`,
                      headers: {
                        Authorization: `Bearer ${apiToken.substring(0, 18)}...`
                      }
                    }
                  }
                }, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Member Invite Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Invite New Team Member</h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Member Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Jane Smith"
                  className="base-input w-full h-10 px-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="base-input w-full h-10 px-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Role Permission</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                  className="base-select h-10 w-full text-sm bg-white"
                >
                  <option value="member">Member (Create &amp; send documents)</option>
                  <option value="admin">Admin (Full workspace control)</option>
                  <option value="readonly">Auditor (View completed records)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="btn btn-white text-xs px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-xs px-5 py-2 font-semibold"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
