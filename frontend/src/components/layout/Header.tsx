import React, { useState } from 'react';
import { 
  Plus, 
  Settings as SettingsIcon, 
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
      <div className="navbar navbar-glass px-5 py-2.5 flex items-center justify-between transition-all">
        
        {/* Left: Brand Identity in xAI Engineered-Restraint Typography */}
        <div className="flex items-center space-x-3">
          <div 
            onClick={() => onSelectTab(user ? 'templates' : 'landing')}
            className="flex items-center space-x-3 group cursor-pointer select-none"
          >
            <div className="w-7 h-7 md:w-8 md:h-8 transition-transform group-hover:scale-105 inline-flex items-center justify-center">
              <img src="/logo.svg" alt="Docurama" className="w-7 h-7 md:w-8 md:h-8 object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg md:text-xl font-normal tracking-[-0.04em] text-white leading-none">
                Docu<span className="text-[#dadbdf]">rama</span>
              </span>
              <span className="caption-mono-sm text-[8px] md:text-[9px] text-[#7d8187] tracking-[1.4px] mt-0.5">
                DOCUMENT INTELLIGENCE
              </span>
            </div>
          </div>
        </div>

        {/* Center & Right: Conditional on Authenticated state */}
        {user ? (
          <>
            {/* Center: Navigation link pills */}
            <div className="hidden md:flex items-center space-x-1 bg-[#1a1c20] p-1 rounded-full border border-[#212327]">
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

            {/* Right: + Create Primary White Pill & Minimal Avatar */}
            <div className="flex items-center space-x-3">
              <button
                onClick={onNewEnvelope}
                className="btn btn-primary px-4 py-1.5 text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2]" />
                <span className="hidden sm:inline">Create</span>
              </button>

              {/* User Avatar Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-8 h-8 rounded-full bg-[#191919] border border-[#212327] hover:border-white/40 flex items-center justify-center text-white text-xs font-normal transition-all"
                >
                  {user?.email ? user.email.charAt(0).toUpperCase() : 'D'}
                </button>

                {dropdownOpen && (
                  <div 
                    onMouseLeave={() => setDropdownOpen(false)}
                    className="absolute right-0 mt-3 z-50 p-2 bg-[#191919] rounded-lg w-60 border border-[#212327] animate-in fade-in duration-150"
                  >
                    <div className="px-3 py-2 border-b border-[#212327] mb-1">
                      <span className="caption-mono-sm text-[9px] text-[#7d8187] block">
                        {user?.account_name || "Docurama Workspace"}
                      </span>
                      <span className="text-xs text-white truncate block font-normal mt-0.5">
                        {user?.email || "admin@docurama.com"}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <button
                        onClick={() => { onSelectTab('settings'); setDropdownOpen(false); }}
                        className="w-full rounded-md py-1.5 px-3 text-xs text-[#dadbdf] hover:bg-[#1a1c20] hover:text-white flex items-center gap-2 text-left transition-colors"
                      >
                        <SettingsIcon className="w-3.5 h-3.5 text-[#7d8187]" />
                        <span>Settings</span>
                      </button>
                      <button
                        onClick={() => { onSelectTab('verify'); setDropdownOpen(false); }}
                        className="w-full rounded-md py-1.5 px-3 text-xs text-[#dadbdf] hover:bg-[#1a1c20] hover:text-white flex items-center gap-2 text-left transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#a0c3ec]" />
                        <span>Verify Portal</span>
                      </button>
                    </div>
                    <div className="border-t border-[#212327] mt-1 pt-1">
                      <button
                        onClick={() => { setDropdownOpen(false); onLogout(); }}
                        className="w-full rounded-md py-1.5 px-3 text-xs text-[#ff7a17] hover:bg-[#ff7a17]/10 flex items-center gap-2 text-left transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5 text-[#ff7a17]" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Unauthenticated Right Menu */
          <div className="flex items-center space-x-3">
            <button
              onClick={onSignIn}
              className="btn btn-outline px-4 py-1.5 text-xs"
            >
              Sign In
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
