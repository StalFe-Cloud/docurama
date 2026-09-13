import React, { useState, useEffect, useCallback } from 'react';
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
import { AdminSetupPage } from './pages/AdminSetupPage';
import { CompliancePage } from './pages/CompliancePage';
import { ActivationPage } from './pages/ActivationPage';
import { TrustPage } from './pages/TrustPage';
import { LegalPage } from './pages/LegalPage';
import { PricingPage } from './pages/PricingPage';
import { DocsPage } from './pages/DocsPage';
import { BlogPage } from './pages/BlogPage';
import { HelpPage } from './pages/HelpPage';
import { GalleryPage } from './pages/GalleryPage';
import { I18nProvider, useI18n } from './i18n';
import { ToastProvider } from './components/ui/Toast';
import { api } from './lib/api';

/**
 * Tabs that require an authenticated session. Deep links to these resolve to
 * the sign-in screen for visitors instead of pretending the page is public.
 */
const AUTH_TABS = new Set(['templates', 'submissions', 'builder', 'settings']);

/** Map a pathname to the tab that should render. Unknown paths land on `/`. */
const resolveTabFromPath = (pathname: string): string => {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '') return 'landing';
  if (p.startsWith('/templates')) return 'templates';
  if (p.startsWith('/submissions')) return 'submissions';
  if (p.startsWith('/builder')) return 'builder';
  return 'landing';
};

export const App: React.FC = () => (
  <ToastProvider>
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  </ToastProvider>
);

/** Shared public marketing shell: header + centered content + footer. */
const MarketingShell: React.FC<{
  user: any;
  navigate: (tab: string) => void;
  handleLogout: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ user, navigate, handleLogout, children, wide }) => (
  <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
    <Header
      currentTab="landing"
      onSelectTab={navigate}
      onNewEnvelope={() => navigate('builder')}
      user={user}
      onLogout={handleLogout}
      onSignIn={() => navigate('signin')}
      onUserUpdate={undefined}
    />
    <main className={`flex-1 w-full mx-auto px-4 pt-6 pb-14 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>
      {children}
    </main>
    <MarketingFooter navigate={navigate} />
  </div>
);

const MarketingFooter: React.FC<{ navigate: (tab: string) => void }> = () => {
  const { t } = useI18n();
  return (
    <footer className="w-full border-t border-[#e5e3df] bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <p className="text-xs font-semibold text-[#1a1a1a]">
            &copy; {new Date().getFullYear()} DOCURAMA - a product of STALFE · 1 Rue Marguerin, 75014 Paris, France
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#787671] max-w-md">{t('footer.trust')}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-[#5d5b54]">
          <a href="/pricing" className="hover:text-[#1a1a1a] transition-colors">{t('nav.pricing')}</a>
          <a href="/docs" className="hover:text-[#1a1a1a] transition-colors">{t('footer.docs')}</a>
          <a href="/blog" className="hover:text-[#1a1a1a] transition-colors">{t('nav.blog')}</a>
          <a href="/help" className="hover:text-[#1a1a1a] transition-colors">{t('footer.help')}</a>
          <a href="/templates-gallery" className="hover:text-[#1a1a1a] transition-colors">{t('nav.gallery')}</a>
          <a href="/legal/terms" className="hover:text-[#1a1a1a] transition-colors">Terms</a>
          <a href="/legal/privacy" className="hover:text-[#1a1a1a] transition-colors">Privacy</a>
          <a href="/legal/dpa" className="hover:text-[#1a1a1a] transition-colors">DPA</a>
          <a href="/trust" className="hover:text-[#1a1a1a] transition-colors">{t('footer.trustcenter')}</a>
          <a href="/verify" className="hover:text-[#1a1a1a] transition-colors">{t('footer.verify')}</a>
          <a href="/api-docs" className="hover:text-[#1a1a1a] transition-colors">API</a>
          <a
            href="https://github.com/StalFe-Cloud/docurama"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-[#1a1a1a] transition-colors"
          >
            {t('footer.source')}
          </a>
        </nav>
      </div>
    </footer>
  );
};

const AppShell: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // The initial tab comes from the URL, so /submissions renders the ledger on
  // first paint instead of the landing page.
  const [currentTab, setCurrentTab] = useState<string>(() => resolveTabFromPath(window.location.pathname));

  const path = window.location.pathname;

  useEffect(() => {
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward re-resolve the tab from the history entry the user
  // navigated to. pushState below keeps every in-app tab a real URL.
  useEffect(() => {
    const onPop = () => {
      const tab = resolveTabFromPath(window.location.pathname);
      setCurrentTab(tab);
      if (window.location.pathname === '/sign_in') setCurrentTab('signin');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Navigate in-app: update state, push a shareable URL, scroll to top. */
  const navigate = useCallback((tab: string) => {
    setCurrentTab(tab);
    const urlFor: Record<string, string> = {
      landing: '/',
      templates: '/templates',
      submissions: '/submissions',
      builder: '/builder',
      verify: '/verify',
      settings: '/settings',
    };
    const target = urlFor[tab];
    if (target && window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const checkSession = async () => {
    try {
      setLoading(true);
      const u = await api.getMe();
      if (u && u.email) {
        setUser(u);
        // Only bounce to the workspace from genuinely public entry points.
        // A deep link like /submissions must render where it points.
        const p = window.location.pathname;
        if (p === '/' || p === '/sign_in') {
          setCurrentTab('templates');
          window.history.replaceState({}, '', '/templates');
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
    navigate('landing');
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
  if (path === '/verify' || (currentTab === 'verify' && !path.startsWith('/admin'))) {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="verify"
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
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
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
        />
        <main className="flex-1 flex items-center justify-center">
          <SignInPage
            onSuccess={(u) => {
              setUser(u);
              navigate('templates');
            }}
            onCancel={() => navigate('landing')}
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
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
        />
        <main className="flex-1 flex items-center justify-center">
          <SignUpPage />
        </main>
      </div>
    );
  }

  // Sprint 8: public marketing & content routes. All public, all translated.
  if (path === '/pricing') {
    return (
      <MarketingShell user={user} navigate={navigate} handleLogout={handleLogout}>
        <PricingPage onNavigate={navigate} />
      </MarketingShell>
    );
  }

  if (path === '/docs' || (path.startsWith('/docs/') && !path.startsWith('/docs/api'))) {
    const sub = path.replace('/docs', '').replace(/^\//, '').split('?')[0];
    return (
      <MarketingShell user={user} navigate={navigate} handleLogout={handleLogout}>
        <DocsPage slug={sub || undefined} onNavigate={navigate} />
      </MarketingShell>
    );
  }

  if (path === '/blog' || path.startsWith('/blog/')) {
    const sub = path.replace('/blog', '').replace(/^\//, '').split('?')[0];
    return (
      <MarketingShell user={user} navigate={navigate} handleLogout={handleLogout}>
        <BlogPage slug={sub || undefined} onNavigate={navigate} />
      </MarketingShell>
    );
  }

  if (path === '/help' || path.startsWith('/help/')) {
    return (
      <MarketingShell user={user} navigate={navigate} handleLogout={handleLogout}>
        <HelpPage />
      </MarketingShell>
    );
  }

  if (path === '/templates-gallery' || path === '/gallery') {
    return (
      <MarketingShell user={user} navigate={navigate} handleLogout={handleLogout} wide>
        <GalleryPage onNavigate={navigate} />
      </MarketingShell>
    );
  }

  // Platform Administrator Setup: /admin/setup, with /setup and /admin/signup as aliases.
  if (path === '/admin/setup' || path === '/setup' || path === '/admin/signup') {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="signin"
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
        />
        <main className="flex-1 flex items-center justify-center p-4">
          <AdminSetupPage
            onSetupComplete={(u) => {
              setUser(u);
              window.location.href = '/admin';
            }}
          />
        </main>
        <MarketingFooter navigate={navigate} />
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
            onSelectTab={navigate}
            onNewEnvelope={() => navigate('builder')}
            user={user}
            onLogout={handleLogout}
            onSignIn={() => navigate('signin')}
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
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
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

  // 6d. Public trust center: /trust. No auth, no badges - the facts and the
  // readiness vocabulary, served from GET /api/trust.
  if (path === '/trust') {
    return <TrustPage />;
  }

  // 6e. Public legal pages: /legal, /legal/terms, /legal/privacy, /legal/dpa,
  // /legal/imprint - Terms, Privacy Notice, DPA and publisher information.
  if (path === '/legal' || path.startsWith('/legal/')) {
    const seg = path.split('/')[2];
    const initialDoc = (['terms', 'privacy', 'dpa', 'imprint'] as const).find((d) => d === seg);
    return <LegalPage initialDoc={initialDoc} />;
  }

  // 5. Direct API Documentation Route: /api-docs, /docs/api, or /api/docs
  if (path.startsWith('/api-docs') || path.startsWith('/docs/api') || path.startsWith('/api/docs')) {
    return (
      <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <Header
          currentTab="settings"
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
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
            onSelectTab={navigate}
            onNewEnvelope={() => navigate('builder')}
            user={user}
            onLogout={handleLogout}
            onSignIn={() => navigate('signin')}
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
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
          onUserUpdate={(u) => setUser(u)}
        />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          <SettingsPage user={user} initialSubtab={subtab} />
        </main>
      </div>
    );
  }

  // Default shell: landing (public) and the three authenticated workspaces.
  // A signed-out visitor deep-linking a workspace sees sign-in, matching how
  // /settings already behaves, instead of being silently dropped on marketing.
  const needsAuth = AUTH_TABS.has(currentTab);
  const renderBody = () => {
    if (loading) {
      // Public landing renders immediately; only workspace deep links wait on
      // the session probe. Matches the pre-routing behaviour for anonymous
      // visitors while keeping auth-gated tabs flash-free.
      if (needsAuth) {
        return (
          <div className="py-24 text-center text-sm text-[#787671]" role="status" aria-live="polite">
            Loading workspace…
          </div>
        );
      }
      return <LandingPage onGetStarted={() => navigate('signin')} />;
    }
    if (!user) {
      if (needsAuth) {
        return (
          <SignInPage
            onSuccess={(u) => {
              setUser(u);
              navigate(currentTab);
            }}
            onCancel={() => navigate('landing')}
          />
        );
      }
      return <LandingPage onGetStarted={() => navigate('signin')} />;
    }
    switch (currentTab) {
      case 'templates':
        return (
          <TemplatesPage
            onSelectTemplate={() => navigate('builder')}
            onNewEnvelope={() => navigate('builder')}
            onNavigate={navigate}
          />
        );
      case 'submissions':
        return <SubmissionsPage onNavigate={navigate} />;
      case 'builder':
        return (
          <BuilderPage
            onSuccess={() => navigate('submissions')}
            onCancel={() => navigate('templates')}
          />
        );
      case 'verify':
        return <VerifyPage />;
      case 'settings':
        return <SettingsPage user={user} />;
      default:
        return <LandingPage onGetStarted={() => navigate('signin')} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex flex-col font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:top-2 focus:left-2 focus:rounded-md focus:bg-[#5645d4] focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <Header
          currentTab={currentTab}
          onSelectTab={navigate}
          onNewEnvelope={() => navigate('builder')}
          user={user}
          onLogout={handleLogout}
          onSignIn={() => navigate('signin')}
          onUserUpdate={(u) => setUser(u)}
        />

        <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-2 pt-4 pb-12">
          {renderBody()}
        </main>

        {/* Footer: honest, linked, and in the app's own tokens. The trust line
            describes what the platform does, never what it was certified for. */}
        <footer className="w-full border-t border-[#e5e3df] bg-white">
          <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold text-[#1a1a1a]">
                &copy; {new Date().getFullYear()} DOCURAMA - a product of STALFE · 1 Rue Marguerin, 75014 Paris, France
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#787671] max-w-md">
                PAdES signatures with X.509 seals, RFC 3161 timestamping, and a
                verifiable audit trail. European data residency by default.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-[#5d5b54]">
              <a href="/legal/terms" className="hover:text-[#1a1a1a] transition-colors">Terms</a>
              <a href="/legal/privacy" className="hover:text-[#1a1a1a] transition-colors">Privacy</a>
              <a href="/legal/dpa" className="hover:text-[#1a1a1a] transition-colors">DPA</a>
              <a href="/trust" className="hover:text-[#1a1a1a] transition-colors">Trust center</a>
              <a href="/verify" className="hover:text-[#1a1a1a] transition-colors">Verify a PDF</a>
              <a href="/api-docs" className="hover:text-[#1a1a1a] transition-colors">API docs</a>
              <a
                href="https://github.com/StalFe-Cloud/docurama"
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-[#1a1a1a] transition-colors"
              >
                Source
              </a>
            </nav>
          </div>
        </footer>
      </div>
  );
};
