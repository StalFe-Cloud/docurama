import React, { useState } from 'react';
import { 
  Plus, 
  Settings as SettingsIcon, 
  LogOut, 
  ShieldCheck, 
  Building, 
  ChevronDown, 
  Check, 
  Globe, 
  X, 
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { api, CompanyItem } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { LangSwitcher } from './LangSwitcher';

interface HeaderProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onNewEnvelope: () => void;
  user: any;
  onLogout: () => void;
  onSignIn?: () => void;
  onUserUpdate?: (updatedUser: any) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onNewEnvelope,
  user,
  onLogout,
  onSignIn,
  onUserUpdate,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyDomain, setNewCompanyDomain] = useState('');
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false);
  const { toast } = useToast();

  const companies: CompanyItem[] = user?.companies || [];
  const activeCompany = companies.find(c => c.is_active_company || c.id === user?.account_id);
  const activeCompanyName = activeCompany?.name || user?.account_name || 'Docurama Organization';
  const isDomainVerified = Boolean(user?.domain_verified || activeCompany?.domain_verification_status === 'verified');

  const handleSwitchCompany = async (companyId: string) => {
    if (companyId === user?.account_id) {
      setCompanyDropdownOpen(false);
      return;
    }
    try {
      setIsSwitchingCompany(true);
      const res = await api.switchCompany(companyId);
      if (res && res.user) {
        if (onUserUpdate) {
          // Re-fetch full user profile to refresh all company statuses
          const refreshed = await api.getMe();
          onUserUpdate(refreshed);
        } else {
          window.location.reload();
        }
      }
    } catch (e: any) {
      console.error('Failed to switch company:', e?.message);
      toast(e.message || 'Failed to switch company context', 'error');
    } finally {
      setIsSwitchingCompany(false);
      setCompanyDropdownOpen(false);
    }
  };

  const handleCreateCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    try {
      setIsCreatingCompany(true);
      await api.createCompany({
        name: newCompanyName.trim(),
        domain: newCompanyDomain.trim() || undefined
      });
      setShowCreateCompanyModal(false);
      setNewCompanyName('');
      setNewCompanyDomain('');
      // Refresh current user session
      const refreshed = await api.getMe();
      if (onUserUpdate) {
        onUserUpdate(refreshed);
      } else {
        window.location.reload();
      }
    } catch (e: any) {
      toast(e.message || 'Failed to create new company', 'error');
    } finally {
      setIsCreatingCompany(false);
    }
  };

  return (
    <div className="sticky top-0 z-40 w-full bg-white border-b border-[#e5e3df]">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
        
        {/* Left: Official Docurama Logo & Company Switcher */}
        <div className="flex items-center space-x-3 sm:space-x-5">
          <div 
            onClick={() => onSelectTab(user ? 'templates' : 'landing')}
            className="flex items-center space-x-2.5 group cursor-pointer select-none"
          >
            <img 
              src="/logo_horizontal.png" 
              alt="Docurama: Documents Signed Simplified" 
              className="h-8 md:h-9 object-contain" 
            />
          </div>

          {/* Company Switcher Pill for Logged In User */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
                className="flex items-center space-x-2 px-2.5 py-1 rounded-md text-xs font-medium border border-[#e5e3df] hover:border-[#a4a097] bg-[#fbfbfa] hover:bg-white text-[#1a1a1a] transition-all"
                title="Switch active organization or company"
              >
                <div className="w-4 h-4 rounded bg-[#dcecfa] text-[#0075de] flex items-center justify-center font-bold">
                  <Building className="w-2.5 h-2.5" />
                </div>
                <span className="max-w-[130px] sm:max-w-[170px] truncate font-semibold">
                  {activeCompanyName}
                </span>

                {/* DNS Domain Verification Badge */}
                {isDomainVerified ? (
                  <span 
                    title={`Domain verified: ${user?.verified_domain || activeCompany?.verified_domain || ''}`} 
                    className="flex items-center text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded px-1.5 py-0.2 font-semibold"
                  >
                    <ShieldCheck className="w-3 h-3 mr-0.5 text-emerald-600" />
                    <span className="hidden lg:inline">DNS Verified</span>
                  </span>
                ) : (
                  <span 
                    title="Enterprise domain DNS unverified" 
                    className="hidden sm:inline-flex items-center text-[9px] text-[#787671] bg-[#f6f5f4] rounded px-1 py-0.2"
                  >
                    Standard
                  </span>
                )}

                <ChevronDown className="w-3 h-3 text-[#787671]" />
              </button>

              {/* Company Switcher Dropdown Menu */}
              {companyDropdownOpen && (
                <div 
                  onMouseLeave={() => setCompanyDropdownOpen(false)}
                  className="absolute left-0 mt-1.5 z-50 p-1.5 bg-white rounded-lg w-72 border border-[#e5e3df] shadow-notion-modal animate-in fade-in duration-100"
                >
                  <div className="px-3 py-1.5 border-b border-[#e5e3df] mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-[#787671] uppercase tracking-wider">
                      Organizations ({companies.length || 1})
                    </span>
                    <span className="text-[10px] text-[#0075de] font-medium">
                      Multi-Tenant
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-0.5 scrollbar-thin">
                    {companies.map((c) => {
                      const isActive = c.is_active_company || c.id === user?.account_id;
                      const hasVerifiedDomain = c.domain_verification_status === 'verified';
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleSwitchCompany(c.id)}
                          disabled={isSwitchingCompany}
                          className={`w-full rounded-md py-2 px-2.5 text-xs flex items-center justify-between text-left transition-colors ${
                            isActive
                              ? 'bg-[#eff6ff] text-[#0075de] font-semibold'
                              : 'text-[#37352f] hover:bg-[#f6f5f4] hover:text-[#1a1a1a]'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0 pr-2">
                            <Building className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#0075de]' : 'text-[#787671]'}`} />
                            <div className="truncate">
                              <span className="block truncate">{c.name}</span>
                              <div className="flex items-center space-x-1.5 text-[10px] text-[#787671] mt-0.5">
                                <span className="capitalize">{c.role || 'Member'}</span>
                                {hasVerifiedDomain && (
                                  <>
                                    <span>•</span>
                                    <span className="text-emerald-600 font-medium flex items-center">
                                      <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                                      {c.verified_domain || 'Verified'}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {isActive && <Check className="w-4 h-4 text-[#0075de] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Add Company Trigger Button */}
                  <div className="border-t border-[#e5e3df] mt-1 pt-1">
                    <button
                      onClick={() => {
                        setCompanyDropdownOpen(false);
                        setShowCreateCompanyModal(true);
                      }}
                      className="w-full rounded-md py-1.5 px-2.5 text-xs text-[#0075de] hover:bg-[#eff6ff] flex items-center gap-1.5 font-medium transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create New Company</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Center Navigation Links for Authenticated Users.
              Order follows the work: shape documents, track what was sent,
              then prove authenticity. Settings lives in the account menu. */}
          {user && (
            <nav className="hidden md:flex items-center space-x-1" aria-label="Primary">
              <button 
                onClick={() => onSelectTab('templates')}
                className={`nav-link-pill ${currentTab === 'templates' || currentTab === 'builder' ? 'active' : ''}`}
                aria-current={currentTab === 'templates' || currentTab === 'builder' ? 'page' : undefined}
              >
                Templates
              </button>
              <button 
                onClick={() => onSelectTab('submissions')}
                className={`nav-link-pill ${currentTab === 'submissions' ? 'active' : ''}`}
                aria-current={currentTab === 'submissions' ? 'page' : undefined}
              >
                Submissions
              </button>
              <button 
                onClick={() => onSelectTab('verify')}
                className={`nav-link-pill ${currentTab === 'verify' ? 'active' : ''}`}
                aria-current={currentTab === 'verify' ? 'page' : undefined}
              >
                Verify
              </button>
              {user.is_platform_admin && (
                <button
                  onClick={() => { window.location.href = '/admin'; }}
                  className={`nav-link-pill ${currentTab === 'admin' ? 'active' : ''}`}
                >
                  Admin
                </button>
              )}
            </nav>
          )}
          {/* Marketing navigation for visitors: the public site, not the app.
              Plain anchors: public pages accept a full load (SEO + shareability). */}
          {!user && (
            <nav className="hidden md:flex items-center space-x-1" aria-label="Marketing">
              <a href="/pricing" className={`nav-link-pill ${currentTab === 'pricing' ? 'active' : ''}`}>Pricing</a>
              <a href="/docs" className="nav-link-pill">Docs</a>
              <a href="/blog" className="nav-link-pill">Blog</a>
              <a href="/help" className="nav-link-pill">Help</a>
              <a href="/templates-gallery" className="nav-link-pill">Gallery</a>
            </nav>
          )}
        </div>

        {/* Right Actions */}
        {user ? (
          <div className="flex items-center space-x-3">
            {/* Signature Notion Purple Button */}
            <button
              onClick={onNewEnvelope}
              className="btn btn-primary px-3.5 py-1.5 text-xs font-medium gap-1.5 rounded-md"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">New Document</span>
            </button>

            {/* User Avatar & Menu */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-8 h-8 rounded-full bg-[#f6f5f4] border border-[#e5e3df] hover:border-[#a4a097] flex items-center justify-center text-[#37352f] text-xs font-medium transition-all"
              >
                {user?.email ? user.email.charAt(0).toUpperCase() : 'D'}
              </button>

              {dropdownOpen && (
                <div 
                  onMouseLeave={() => setDropdownOpen(false)}
                  className="absolute right-0 mt-2 z-50 p-1.5 bg-white rounded-lg w-64 border border-[#e5e3df] shadow-notion-modal animate-in fade-in duration-100"
                >
                  <div className="px-3 py-2 border-b border-[#e5e3df] mb-1">
                    <span className="text-[11px] font-semibold text-[#787671] block uppercase tracking-wider">
                      {activeCompanyName}
                    </span>
                    <span className="text-xs text-[#1a1a1a] truncate block font-medium mt-0.5">
                      {user?.email || ""}
                    </span>
                    {isDomainVerified && (
                      <div className="mt-1 flex items-center text-[10px] text-emerald-700 font-medium">
                        <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
                        <span>Corporate DNS Identity Active</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <button
                      onClick={() => { onSelectTab('settings'); setDropdownOpen(false); }}
                      className="w-full rounded-md py-1.5 px-3 text-xs text-[#37352f] hover:bg-[#f6f5f4] hover:text-[#1a1a1a] flex items-center gap-2 text-left transition-colors"
                    >
                      <SettingsIcon className="w-3.5 h-3.5 text-[#787671]" />
                      <span>Settings &amp; Keys</span>
                    </button>
                    <button
                      onClick={() => { onSelectTab('verify'); setDropdownOpen(false); }}
                      className="w-full rounded-md py-1.5 px-3 text-xs text-[#37352f] hover:bg-[#f6f5f4] hover:text-[#1a1a1a] flex items-center gap-2 text-left transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#1aae39]" />
                      <span>Verify Signature</span>
                    </button>
                  </div>
                  <div className="border-t border-[#e5e3df] mt-1 pt-1">
                    <button
                      onClick={() => { setDropdownOpen(false); onLogout(); }}
                      className="w-full rounded-md py-1.5 px-3 text-xs text-[#e03131] hover:bg-rose-50 flex items-center gap-2 text-left transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5 text-[#e03131]" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Unauthenticated Right Menu */
          <div className="flex items-center space-x-2">
            <LangSwitcher />
            <button
              onClick={() => onSelectTab('verify')}
              className="hidden md:inline-flex btn btn-ghost px-2.5 py-1.5 text-xs text-[#5d5b54] hover:text-[#1a1a1a]"
            >
              Verify PDF
            </button>
            <button
              onClick={onSignIn}
              className="btn btn-ghost px-3 py-1.5 text-xs text-[#37352f] hover:text-[#1a1a1a]"
            >
              Log in
            </button>
            <button
              onClick={onSignIn}
              className="btn btn-primary px-3.5 py-1.5 text-xs font-medium text-white rounded-md"
            >
              Start Signing Free
            </button>
          </div>
        )}

      </div>

      {/* Modal: Create New Company */}
      {showCreateCompanyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-notion-modal max-w-md w-full border border-[#e5e3df] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e5e3df] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#dcecfa] text-[#0075de] flex items-center justify-center font-bold">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">Create New Company</h3>
                  <p className="text-[11px] text-[#787671]">Create a dedicated workspace with its own envelopes &amp; DNS domain.</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateCompanyModal(false)}
                className="text-[#787671] hover:text-[#1a1a1a] p-1 rounded-md hover:bg-[#f6f5f4]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCompanySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#37352f] uppercase tracking-wider mb-1.5">
                  Company / Organization Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. StalFe Legal Partners"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="base-input w-full h-10 px-3 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#37352f] uppercase tracking-wider mb-1.5">
                  Corporate Domain (Optional)
                </label>
                <div className="relative">
                  <Globe className="w-3.5 h-3.5 text-[#787671] absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="e.g. stalfe.com (for DNS verification)"
                    value={newCompanyDomain}
                    onChange={(e) => setNewCompanyDomain(e.target.value)}
                    className="base-input w-full h-10 pl-9 pr-3 text-xs"
                  />
                </div>
                <p className="text-[11px] text-[#787671] mt-1">
                  Claiming your corporate domain provides cryptographic identity assertion and DNS-based authentication validation.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-[#e5e3df]">
                <button
                  type="button"
                  onClick={() => setShowCreateCompanyModal(false)}
                  className="btn btn-ghost px-4 h-9 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCompany || !newCompanyName.trim()}
                  className="btn btn-primary px-4 h-9 text-xs font-semibold"
                >
                  {isCreatingCompany ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
