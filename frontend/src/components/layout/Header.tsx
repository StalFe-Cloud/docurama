import React, { useState } from 'react';
import { 
  Plus, 
  Settings as SettingsIcon, 
  User as UserIcon, 
  LogOut,
  ShieldCheck
} from 'lucide-react';

interface HeaderProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onNewEnvelope: () => void;
  user: any;
  onLogout: () => void;
  onSignIn?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onNewEnvelope,
  user,
  onLogout,
  onSignIn,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="pt-4 pb-2 px-4 max-w-6xl mx-auto w-full">
      <div className="navbar navbar-glass px-4 py-2.5 flex items-center justify-between transition-all">
        
        {/* Left: Brand Identity Matching Production */}
        <div className="flex items-center space-x-3">
          <div 
            onClick={() => onSelectTab(user ? 'templates' : 'landing')}
            className="flex items-center space-x-3 group cursor-pointer select-none"
          >
            <div className="w-8 h-8 md:w-9 md:h-9 transition-transform group-hover:scale-105 inline-flex items-center justify-center">
              <img src="/logo.svg" alt="Docurama" className="w-8 h-8 md:w-9 md:h-9 object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl md:text-2xl font-bold tracking-tight text-[#0F172A] leading-tight font-heading">
                Docu<span className="text-[#1D72FE]">rama</span>
              </span>
              <span className="text-[8px] md:text-[9px] uppercase tracking-widest text-[#64748B] font-semibold">
                DOCUMENTS • SIGNED • SIMPLIFIED
              </span>
            </div>
          </div>
        </div>

        {/* Center & Right: Conditional on Authenticated state */}
        {user ? (
          <>
            {/* Center: Navigation link pills */}
            <div className="hidden md:flex items-center space-x-1 bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0]">
              <button 
                onClick={() => onSelectTab('templates')}
                className={`nav-link-pill ${currentTab === 'templates' || currentTab === 'builder' ? 'active' : ''}`}
              >
                Templates
              </button>
              <button 
                onClick={() => onSelectTab('submissions')}
                className={`nav-link-pill ${currentTab === 'submissions' ? 'active' : ''}`}
              >
                Submissions
              </button>
              <button 
                onClick={() => onSelectTab('settings')}
                className={`nav-link-pill ${currentTab === 'settings' ? 'active' : ''}`}
              >
                Settings
              </button>
            </div>

            {/* Right: + Create Button & Avatar Dropdown */}
            <div className="flex items-center space-x-3">
              <button
                onClick={onNewEnvelope}
                className="btn btn-primary px-3.5 py-2 text-xs md:text-sm font-semibold gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span className="hidden sm:inline">Create</span>
              </button>

              {/* User Avatar Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#1D72FE] to-[#6366F1] flex items-center justify-center text-white font-bold text-sm shadow-sm ring-2 ring-[#E2E8F0] hover:ring-[#1D72FE] transition-all"
                >
                  {user?.email ? user.email.charAt(0).toUpperCase() : 'D'}
                </button>

                {dropdownOpen && (
                  <div 
                    onMouseLeave={() => setDropdownOpen(false)}
                    className="absolute right-0 mt-3 z-50 p-2 shadow-xl bg-white rounded-2xl w-60 border border-[#E2E8F0] animate-in fade-in zoom-in-95 duration-150"
                  >
                    <div className="px-3 py-2 border-b border-[#F1F5F9] mb-1">
                      <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider block">
                        {user?.account_name || "Docurama Organization"}
                      </span>
                      <span className="text-sm font-medium text-[#0F172A] truncate block">
                        {user?.email || "admin@docurama.com"}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <button
                        onClick={() => { onSelectTab('settings'); setDropdownOpen(false); }}
                        className="w-full rounded-lg py-2 px-3 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] flex items-center gap-2 text-left"
                      >
                        <SettingsIcon className="w-4 h-4 text-[#64748B]" />
                        <span>Settings</span>
                      </button>
                      <button
                        onClick={() => { onSelectTab('verify'); setDropdownOpen(false); }}
                        className="w-full rounded-lg py-2 px-3 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] flex items-center gap-2 text-left"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Verify Portal</span>
                      </button>
                    </div>
                    <div className="border-t border-[#F1F5F9] mt-1 pt-1">
                      <button
                        onClick={() => { setDropdownOpen(false); onLogout(); }}
                        className="rounded-lg py-2 px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 w-full text-left flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="w-4 h-4 text-rose-500" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Unauthenticated Right Menu matching production */
          <div className="flex items-center space-x-3">
            <button
              onClick={onSignIn}
              className="btn btn-sm btn-ghost font-semibold text-[#334155] hover:text-[#0F172A] px-4 py-2 rounded-xl transition-colors text-sm"
            >
              Sign In
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
