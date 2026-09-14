"use client";

/**
 * Docurama enterprise portal — single-page app shell.
 *
 * Two role-based experiences behind one door:
 *  - PLATFORM_ADMIN → admin control panel (12 sections)
 *  - WORKSPACE_*    → user portal (home, documents, templates, verify, settings)
 *
 * The session is resolved server-side via /api/auth/me; a network error does
 * NOT sign the user out (fixes the "any error = logout" bug).
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client";
import { PortalProviders } from "@/components/portal/providers";
import { SignIn } from "@/components/portal/sign-in";
import { AdminShell, ADMIN_SECTIONS, type AdminSectionKey } from "@/components/portal/admin-shell";
import { UserShell, USER_SECTIONS, type UserSectionKey } from "@/components/portal/user-shell";
import { AdminOverview } from "@/components/portal/admin/admin-overview";
import { AdminTenants } from "@/components/portal/admin/admin-tenants";
import { AdminUsers } from "@/components/portal/admin/admin-users";
import { AdminEnvelopes } from "@/components/portal/admin/admin-envelopes";
import { AdminDomains } from "@/components/portal/admin/admin-domains";
import { AdminLegal } from "@/components/portal/admin/admin-legal";
import { AdminCompliance } from "@/components/portal/admin/admin-compliance";
import { AdminBilling } from "@/components/portal/admin/admin-billing";
import { AdminIntegrations } from "@/components/portal/admin/admin-integrations";
import { AdminSettings } from "@/components/portal/admin/admin-settings";
import { AdminHealth } from "@/components/portal/admin/admin-health";
import { AdminAudit } from "@/components/portal/admin/admin-audit";
import { UserHome } from "@/components/portal/user/user-home";
import { UserDocuments } from "@/components/portal/user/user-documents";
import { UserTemplates } from "@/components/portal/user/user-templates";
import { UserVerify } from "@/components/portal/user/user-verify";
import { UserSettings } from "@/components/portal/user/user-settings";
import type { SessionUser } from "@/lib/auth";
import { FileCheck2 } from "lucide-react";

function Portal({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "PLATFORM_ADMIN";
  const [adminSection, setAdminSection] = useState<AdminSectionKey>("overview");
  const [userSection, setUserSection] = useState<UserSectionKey>("home");

  // Keep the hash in sync so sections are linkable/back-button friendly.
  useEffect(() => {
    const apply = () => {
      const key = window.location.hash.replace("#", "");
      if (isAdmin && ADMIN_SECTIONS.some((s) => s.key === key)) setAdminSection(key as AdminSectionKey);
      if (!isAdmin && USER_SECTIONS.some((s) => s.key === key)) setUserSection(key as UserSectionKey);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [isAdmin]);

  const navigateAdmin = (k: AdminSectionKey) => { setAdminSection(k); window.location.hash = k; };
  const navigateUser = (k: UserSectionKey) => { setUserSection(k); window.location.hash = k; };

  if (isAdmin) {
    return (
      <AdminShell user={user} active={adminSection} onNavigate={navigateAdmin}>
        {adminSection === "overview" && <AdminOverview onNavigate={navigateAdmin} />}
        {adminSection === "tenants" && <AdminTenants />}
        {adminSection === "users" && <AdminUsers />}
        {adminSection === "envelopes" && <AdminEnvelopes />}
        {adminSection === "domains" && <AdminDomains />}
        {adminSection === "legal" && <AdminLegal />}
        {adminSection === "compliance" && <AdminCompliance />}
        {adminSection === "billing" && <AdminBilling />}
        {adminSection === "integrations" && <AdminIntegrations />}
        {adminSection === "settings" && <AdminSettings />}
        {adminSection === "health" && <AdminHealth />}
        {adminSection === "audit" && <AdminAudit />}
      </AdminShell>
    );
  }

  return (
    <UserShell user={user} active={userSection} onNavigate={navigateUser}>
      {userSection === "home" && <UserHome user={user} onNavigate={navigateUser} />}
      {userSection === "documents" && <UserDocuments />}
      {userSection === "templates" && <UserTemplates />}
      {userSection === "verify" && <UserVerify />}
      {userSection === "settings" && <UserSettings />}
    </UserShell>
  );
}

function Boot() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
      <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-primary">
        <FileCheck2 className="h-6 w-6 text-primary-foreground" aria-hidden />
      </span>
      <p className="text-sm text-muted-foreground">Loading Docurama portal…</p>
    </div>
  );
}

function App() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<{ user: SessionUser | null }>("/api/auth/me"),
    retry: 2,
    staleTime: 30_000,
  });

  if (isLoading) return <Boot />;

  // A network failure keeps the user where they are with a retry — it does
  // NOT silently sign them out.
  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm font-semibold">Cannot reach Docurama</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {(error as Error)?.message ?? "A network error occurred."} You have not been signed out — please try again.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data?.user) return <SignIn />;
  return <Portal user={data.user} />;
}

export default function Home() {
  return (
    <PortalProviders>
      <App />
    </PortalProviders>
  );
}
