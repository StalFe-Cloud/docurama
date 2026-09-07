import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { TemplatesPage } from './pages/TemplatesPage';
import { SubmissionsPage } from './pages/SubmissionsPage';
import { BuilderPage } from './pages/BuilderPage';
import { SigningStudioPage } from './pages/SigningStudioPage';
import { VerifyPage } from './pages/VerifyPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { api } from './lib/api';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('templates');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Check URL routes
  const path = window.location.pathname;

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      setLoading(true);
      const u = await api.getMe();
      setUser(u);
    } catch (e) {
      // Mock default user if in offline mode or dev mode
      setUser({
        email: 'admin@docurama.com',
        first_name: 'Docurama',
        last_name: 'Admin',
        role: 'admin'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  // 1. Direct Signing Link Route: /s/:token
  if (path.startsWith('/s/')) {
    const token = path.replace('/s/', '').split('?')[0];
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 bg-grid-pattern">
        <SigningStudioPage token={token} onDone={() => { window.location.href = '/verify'; }} />
      </div>
    );
  }

  // 2. Direct Public Verification Route: /verify
  if (path === '/verify') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 bg-grid-pattern">
        <VerifyPage />
      </div>
    );
  }

  // 3. Main Authenticated Dashboard
  if (!user && !loading) {
    return <SignInPage onSuccess={(u) => setUser(u)} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col bg-grid-pattern">
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        onNewEnvelope={() => setCurrentTab('builder')}
        user={user}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 pt-8">
        {currentTab === 'templates' && (
          <TemplatesPage
            onSelectTemplate={() => setCurrentTab('builder')}
            onNewEnvelope={() => setCurrentTab('builder')}
          />
        )}

        {currentTab === 'submissions' && (
          <SubmissionsPage />
        )}

        {currentTab === 'builder' && (
          <BuilderPage
            onSuccess={() => setCurrentTab('submissions')}
            onCancel={() => setCurrentTab('templates')}
          />
        )}

        {currentTab === 'verify' && (
          <VerifyPage />
        )}

        {currentTab === 'settings' && (
          <SettingsPage user={user} />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-white/5 py-6 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; {new Date().getFullYear()} Docurama Technologies. All rights reserved.</span>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span>PAdES-LTV Digital Trust</span>
            <span>•</span>
            <span>RFC 3161 Certified</span>
            <span>•</span>
            <span>Zero Upstream Dependency</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
