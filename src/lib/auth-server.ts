import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import type { SessionUser, SessionOrg } from "./auth";

export const SESSION_COOKIE = "docurama_session";
export const SESSION_TOKEN_STORE = "docurama_token";
const PASSWORD_SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_HASH_PREFIX = "scrypt$1$32768$8$3$";
const LEGACY_PASSWORD_HASH = /^[a-f0-9]{64}$/i;
const SCRYPT_PASSWORD_HASH = /^scrypt\$1\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

/** Versioned, salted scrypt password hashing. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, PASSWORD_KEY_BYTES, PASSWORD_SCRYPT);
  return `${PASSWORD_HASH_PREFIX}${salt.toString("hex")}$${key.toString("hex")}`;
}

export function passwordNeedsUpgrade(storedHash: string): boolean {
  return typeof storedHash === "string" && LEGACY_PASSWORD_HASH.test(storedHash);
}

/** Verify password in constant time. */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (typeof password !== "string" || typeof storedHash !== "string" || storedHash.length > 256) return false;
  try {
    if (passwordNeedsUpgrade(storedHash)) {
      return timingSafeEqual(createHash("sha256").update(password).digest(), Buffer.from(storedHash, "hex"));
    }
    const match = SCRYPT_PASSWORD_HASH.exec(storedHash);
    if (!match) return false;
    const actual = scryptSync(password, Buffer.from(match[1], "hex"), PASSWORD_KEY_BYTES, PASSWORD_SCRYPT);
    return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
  } catch {
    return false;
  }
}

/** Create a real server session record in database. */
export async function createSession(userId: string, userAgent?: string, ipAddress?: string) {
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return db.session.create({
    data: {
      userId,
      expiresAt: sessionExpiresAt,
      userAgent: userAgent?.slice(0, 500) || "browser",
      ip: ipAddress || "127.0.0.1",
      lastSeenAt: new Date(),
    },
  });
}

/** Revoke a session. */
export async function revokeSession(sessionId: string) {
  return db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Resolve user session from token/sessionId. */
export async function resolveSessionUser(sessionId: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: {
        where: { status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
        include: { tenant: true },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  // Touch session periodically
  if (session.lastSeenAt.getTime() < Date.now() - 60_000) {
    await db.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastSeenAt: new Date() },
    }).catch(() => undefined);
  }

  const activeTenantId = user.activeTenantId;
  const active =
    user.memberships.find((m) => m.tenantId === activeTenantId) ?? user.memberships[0];

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    totpEnabled: user.totpEnabled,
    tenantId: active?.tenantId ?? null,
    tenantName: active?.tenant.name ?? null,
    tenantSlug: active?.tenant.slug ?? null,
    tenantPlan: active?.tenant.planCode ?? null,
    workspaceRole: active?.role ?? null,
    sessionId: session.id,
    orgs: user.memberships.map((m) => ({
      id: m.tenantId,
      name: m.tenant.name,
      slug: m.tenant.slug,
      role: m.role,
      plan: m.tenant.planCode,
    })),
  };
}

export function extractSessionToken(request: Request): string | null {
  // Check Authorization Bearer header
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const raw = auth.slice("Bearer ".length).trim();
    if (raw.length) return raw;
  }

  // Check Cookie header
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(`${SESSION_COOKIE}=`)) {
        return decodeURIComponent(c.slice(`${SESSION_COOKIE}=`.length));
      }
    }
  }

  return null;
}

export function sessionCookieAttributes(request: Request, token: string): string {
  const isHttps = request.url.startsWith("https:");
  return isHttps
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`
    : `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}
