import React from 'react';
import { 
  LayoutGrid, 
  FileCheck2, 
  ShieldCheck, 
  Settings as SettingsIcon, 
  Plus, 
  LogOut, 
  Shield, 
  CheckCircle2 
} from 'lucide-react';

interface HeaderProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onNewEnvelope: () => void;
  user: any;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onNewEnvelope,
  user,
  onLogout,
}) => {
  const navItems = [
    { id: 'templates', label: 'Templates', icon: LayoutGrid },
    { id: 'submissions', label: 'Submissions', icon: FileCheck2 },
    { id: 'verify', label: 'Verify Portal', icon: ShieldCheck },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-white/10 px-4 sm:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-6">
          <div 
            onClick={() => onSelectTab('templates')}
            className="flex items-center gap-3 cursor-pointer group select-none"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1.5px] shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Shield className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                  Docurama
                </span>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  Docurama Trust
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Digital Seal & E-Signature Studio</p>
            </div>
          </div>

          {/* Navigation Pills */}
          <nav className="hidden md:flex items-center gap-1.5 ml-4 bg-slate-900/60 p-1 rounded-xl border border-white/5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-600/90 text-white shadow-sm shadow-indigo-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Actions & User */}
        <div className="flex items-center gap-3">
          <button
            onClick={onNewEnvelope}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white btn-primary-glow"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Envelope</span>
            <span className="sm:hidden">Send</span>
          </button>

          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-white/10">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-indigo-400/30 flex items-center justify-center text-xs font-bold text-indigo-300">
                {(user.first_name?.[0] || user.email?.[0] || 'U').toUpperCase()}
              </div>
              <button
                onClick={onLogout}
                title="Sign out"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
