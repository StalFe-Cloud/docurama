import React, { useState } from 'react';
import { 
  Plus, 
  Settings as SettingsIcon, 
  LogOut,
  ShieldCheck,
  FileCheck,
  Code
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
    <div className="sticky top-0 z-40 w-full bg-white border-b border-[#e5e3df]">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
        
        {/* Left: Official Docurama Logo (from preview.png) */}
        <div className="flex items-center space-x-4 sm:space-x-6">
          <div 
            onClick={() => onSelectTab(user ? 'templates' : 'landing')}
            className="flex items-center space-x-2.5 group cursor-pointer select-none"
          >
            <img 
              src="/logo_horizontal.png" 
              alt="Docurama: Documents Signed Simplified" 
              className="h-8 md:h-9 object-contain" 
            />
            <span className="hidden sm:inline-block text-[10px] font-semibold text-[#0075de] bg-[#dcecfa] border border-[#0075de]/20 rounded-full px-2 py-0.5 tracking-wide uppercase">
              Digital Signatures &amp; Seals
            </span>
          </div>

          {/* Center Navigation Links for Authenticated Users */}
          {user && (
            <nav className="hidden md:flex items-center space-x-1">
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
              <button 
                onClick={() => onSelectTab('verify')}
                className={`nav-link-pill ${currentTab === 'verify' ? 'active' : ''}`}
              >
                Verify Portal
              </button>
            </nav>
          )}
        </div>

        {/* Right Actions */}
        {user ? (
          <div className="flex items-center space-x-3">
            {/* Signature Notion Purple Button (8px rectangle, NOT pill) */}
            <button
              onClick={onNewEnvelope}
              className="btn btn-primary px-3.5 py-1.5 text-xs font-medium gap-1.5 rounded-md"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">New Document</span>
            </button>

            {/* User Avatar */}
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
                  className="absolute right-0 mt-2 z-50 p-1.5 bg-white rounded-lg w-60 border border-[#e5e3df] shadow-notion-modal animate-in fade-in duration-100"
                >
                  <div className="px-3 py-2 border-b border-[#e5e3df] mb-1">
                    <span className="text-[11px] font-semibold text-[#787671] block uppercase tracking-wider">
                      {user?.account_name || "Docurama Organization"}
                    </span>
                    <span className="text-xs text-[#1a1a1a] truncate block font-medium mt-0.5">
                      {user?.email || "admin@docurama.com"}
                    </span>
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
    </div>
  );
};
