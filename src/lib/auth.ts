/**
 * Browser-safe session types (ported from the Next.js server's auth module).
 * The demo session lives in localStorage; see src/lib/demo-store.ts.
 */

export type SessionOrg = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
};

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  totpEnabled: boolean;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantPlan: string | null;
  workspaceRole: string | null;
  /** Id of the unrevoked server-side session row backing this request. */
  sessionId: string | null;
  /** Every organization this account belongs to - powers the workspace switcher. */
  orgs: SessionOrg[];
};
