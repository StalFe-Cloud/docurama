import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { LandingPage } from './pages/LandingPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { SubmissionsPage } from './pages/SubmissionsPage';
import { BuilderPage } from './pages/BuilderPage';
import { SigningStudioPage } from './pages/SigningStudioPage';
import { VerifyPage } from './pages/VerifyPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { PublicFormPage } from './pages/PublicFormPage';
import { ApiDocsPage } from './pages/ApiDocsPage';
import { AdminPage } from './pages/AdminPage';
import { CompliancePage } from './pages/CompliancePage';
import { ActivationPage } from './pages/ActivationPage';
import { TrustPage } from './pages/TrustPage';
import { api } from './lib/api';

export const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<string>('landing');

  // Check URL routes
  const path = window.location.pathname;

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      setLoading(true);
      const u = await api.getMe();
      if (u && u.email) {
        setUser(u);
        if (currentTab === 'landing' || currentTab === 'signin') {
          setCurrentTab('templates');
        }
      } else {
        setUser(null);
      }
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {
      // ignore
    }
    setUser(null);
    setCurrentTab('landing');
  };

  // 1. Public Self-Service Template Intake Form: /d/:slug
  if (path.startsWith('/d/')) {
    const slug = path.replace('/d/', '').split('?')[0];
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] p-4 sm:p-8">
        <PublicFormPage slug={slug} />
      </div>
    );
  }

  // 2. Direct Signing Link Route: /s/:token or /sign/:token
  if (path.startsWith('/s/') || path.startsWith('/sign/')) {
    const token = (path.startsWith('/s/') ? path.replace('/s/', '') : path.replace('/sign/', '')).split('?')[0];
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] p-2 sm:p-6">
        <SigningStudioPage token={token} onDone={() => { window.location.href = '/verify'; }} />
      </div>
    );
  }

  // Password reset email link: /reset-password?token=...
  // The reset email has always linked here; without this route the link fell through
  // to the landing page and the reset could never be completed.
  if (path === '/reset-password') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <main className="flex-1 flex items-center justify-center">
          <ResetPasswordPage onDone={() => { window.location.href = '/sign_in'; }} />
        </main>
      </div>
    );
  }

  // Post-signup onboarding questionnaire: /onboarding
  if (path === '/onboarding') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <main className="flex-1 flex items-center justify-center">
          <OnboardingPage />
        </main>
      </div>
    );
  }

  // 3. Direct Public Verification Route: /verify
  if (path === '/verify') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="verify"
          onSelectTab={(tab) => {
            if (tab === 'landing') window.location.href = '/';
            else setCurrentTab(tab);
          }}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
        />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          <VerifyPage />
        </main>
      </div>
    );
  }

  // 4. Direct Sign-In Route: /sign_in
  if (path === '/sign_in' || currentTab === 'signin') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="signin"
          onSelectTab={(tab) => setCurrentTab(tab)}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
        />
        <main className="flex-1 flex items-center justify-center">
          <SignInPage
            onSuccess={(u) => {
              setUser(u);
              setCurrentTab('templates');
            }}
            onCancel={() => setCurrentTab('landing')}
          />
        </main>
      </div>
    );
  }

  // Direct Sign-Up Route: /sign_up, with /signup accepted as an alias.
  // Registration hands back a session cookie, so success navigates to the
  // onboarding wizard with a fresh page load.
  if (path === '/sign_up' || path === '/signup') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="signin"
          onSelectTab={(tab) => setCurrentTab(tab)}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
        />
        <main className="flex-1 flex items-center justify-center">
          <SignUpPage />
        </main>
      </div>
    );
  }

  // 6b. Platform admin console: /admin. The API enforces the platform-admin
  // gate on every route it serves; the UI renders a sign-in prompt for
  // everyone else rather than pretending the page exists for them.
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (!user || !user.is_platform_admin) {
      return (
        <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
          <Header
            currentTab="signin"
            onSelectTab={(tab) => setCurrentTab(tab)}
            onNewEnvelope={() => setCurrentTab('builder')}
            user={user}
            onLogout={handleLogout}
            onSignIn={() => setCurrentTab('signin')}
          />
          <main className="flex-1 flex items-center justify-center">
            <SignInPage
              onSuccess={(u) => setUser(u)}
              onCancel={() => { window.location.href = '/'; }}
            />
          </main>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="settings"
          onSelectTab={(tab) => {
            if (tab === 'landing') window.location.href = '/';
            else setCurrentTab(tab);
          }}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
          onUserUpdate={(u) => setUser(u)}
        />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          {path.startsWith('/admin/compliance') ? <CompliancePage /> : <AdminPage />}
        </main>
      </div>
    );
  }

  // 6c. Domain-join account activation: /activate?token=… (§18). Public by
  // design - the holder of the single-use email link lands here.
  if (path === '/activate') {
    return <ActivationPage />;
  }

  // 6d. Public trust center: /trust. No auth, no badges — the facts and the
  // readiness vocabulary, served from GET /api/trust.
  if (path === '/trust') {
    return <TrustPage />;
  }

  // 5. Direct API Documentation Route: /api-docs, /docs/api, or /api/docs
  if (path.startsWith('/api-docs') || path.startsWith('/docs/api') || path.startsWith('/api/docs')) {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="settings"
          onSelectTab={(tab) => {
            if (tab === 'landing') window.location.href = '/';
            else setCurrentTab(tab);
          }}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
        />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          <ApiDocsPage />
        </main>
      </div>
    );
  }

  // 6. Direct Settings Route: /settings, /settings/account, /settings/profile, etc.
  if (path.startsWith('/settings')) {
    const subtab = path.replace('/settings', '').replace('/', '') || 'account';

    // Settings is account data. It previously rendered for anyone, because a hardcoded
    // administrator identity stood in for a signed-out visitor and made the page look
    // authenticated while every request behind it failed.
    if (!user) {
      return (
        <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
          <Header
            currentTab="signin"
            onSelectTab={(tab) => setCurrentTab(tab)}
            onNewEnvelope={() => setCurrentTab('builder')}
            user={user}
            onLogout={handleLogout}
            onSignIn={() => setCurrentTab('signin')}
          />
          <main className="flex-1 flex items-center justify-center">
            <SignInPage
              onSuccess={(u) => setUser(u)}
              onCancel={() => { window.location.href = '/'; }}
            />
          </main>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="settings"
          onSelectTab={(tab) => {
            if (tab === 'landing') window.location.href = '/';
            else setCurrentTab(tab);
          }}
          onNewEnvelope={() => setCurrentTab('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => setCurrentTab('signin')}
          onUserUpdate={(u) => setUser(u)}
        />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          <SettingsPage user={user} initialSubtab={subtab} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        onNewEnvelope={() => setCurrentTab('builder')}
        user={user}
        onLogout={handleLogout}
        onSignIn={() => setCurrentTab('signin')}
        onUserUpdate={(u) => setUser(u)}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
        {/* Unauthenticated Landing Hero */}
        {!user && currentTab === 'landing' && (
          <LandingPage onGetStarted={() => setCurrentTab('signin')} />
        )}

        {/* Authenticated Pages */}
        {user && currentTab === 'templates' && (
          <TemplatesPage
            onSelectTemplate={() => setCurrentTab('builder')}
            onNewEnvelope={() => setCurrentTab('builder')}
          />
        )}

        {user && currentTab === 'submissions' && (
          <SubmissionsPage />
        )}

        {user && currentTab === 'builder' && (
          <BuilderPage
            onSuccess={() => setCurrentTab('submissions')}
            onCancel={() => setCurrentTab('templates')}
          />
        )}

        {currentTab === 'verify' && (
          <VerifyPage />
        )}

        {user && currentTab === 'settings' && (
          <SettingsPage user={user} />
        )}
      </main>

      {/* Production Footer */}
      <footer className="w-full border-t border-[#E2E8F0] py-6 px-4 text-center text-xs text-[#64748B] bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; {new Date().getFullYear()} Docurama Technologies. All rights reserved.</span>
          <div className="flex items-center gap-4 text-[11px] text-[#64748B]">
            <span>PAdES-LTV Digital Trust</span>
            <span>•</span>
            <span>RFC 3161 Certified</span>
            <span>•</span>
            <span>Enterprise Clean-Room</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
