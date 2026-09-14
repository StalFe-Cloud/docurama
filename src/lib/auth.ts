import { createHash } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "docurama_session";
export const hashPassword = (pw: string) => createHash("sha256").update(pw).digest("hex");

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
};

/**
 * Resolve the signed-in user from the session cookie.
 * Returns null when no valid session exists.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const userId = jar.get(SESSION_COOKIE)?.value;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { tenant: true }, take: 1 } },
  });
  if (!user || user.status === "SUSPENDED") return null;

  const m = user.memberships[0];
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    totpEnabled: user.totpEnabled,
    tenantId: m?.tenantId ?? null,
    tenantName: m?.tenant.name ?? null,
    tenantSlug: m?.tenant.slug ?? null,
    tenantPlan: m?.tenant.planCode ?? null,
    workspaceRole: m?.role ?? null,
  };
}

/** Guard for platform-admin API routes. Throws a 403 Response when not authorised. */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== "PLATFORM_ADMIN") {
    throw new Response(JSON.stringify({ error: "Platform administrator access required" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
}

/** Guard for authenticated workspace users (any role). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
}

export async function recordAudit(input: {
  actor: string; actorRole: string; action: string; resource: string;
  severity?: string; tenantName?: string | null; detail?: string; ip?: string;
}) {
  await db.auditEvent.create({
    data: {
      actor: input.actor, actorRole: input.actorRole, action: input.action,
      resource: input.resource, severity: input.severity ?? "INFO",
      tenantName: input.tenantName ?? null, detail: input.detail ?? null,
      ip: input.ip ?? "10.42.0.7",
    },
  });
}
