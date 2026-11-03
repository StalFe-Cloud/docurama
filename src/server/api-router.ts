import { db } from "../lib/db";
import {
  extractSessionToken,
  resolveSessionUser,
  createSession,
  revokeSession,
  verifyPassword,
  hashPassword,
  sessionCookieAttributes,
  SESSION_COOKIE,
} from "../lib/auth-server";

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function badRequest(message: string, status = 400) {
  return json({ error: message }, status);
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  try {
    // ─── AUTH: Session Check ──────────────────────────────────────────
    if (path === "/api/auth/session" || path === "/api/auth/me") {
      const token = extractSessionToken(request);
      if (!token) return json({ user: null });
      const user = await resolveSessionUser(token);
      return json({ user });
    }

    // ─── AUTH: Login ──────────────────────────────────────────────────
    if (path === "/api/auth/login" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        password?: string;
      };
      const email = body.email?.trim().toLowerCase();
      const password = body.password;

      if (!email || !password) {
        return badRequest("Email and password are required.");
      }

      const user = await db.user.findUnique({
        where: { email },
        include: {
          memberships: {
            where: { status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
            include: { tenant: true },
          },
        },
      });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        return badRequest("Invalid email or password.", 401);
      }

      const session = await createSession(
        user.id,
        request.headers.get("user-agent") || undefined,
        request.headers.get("x-forwarded-for") || undefined,
      );

      const sessionUser = await resolveSessionUser(session.id);
      const cookieHeader = sessionCookieAttributes(request, session.id);

      await db.auditEvent.create({
        data: {
          actor: `${user.firstName} ${user.lastName}`,
          actorRole: user.role,
          actorUserId: user.id,
          action: "auth.login.success",
          resource: "user",
          severity: "INFO",
          detail: `User ${user.email} signed in successfully.`,
          ip: request.headers.get("x-forwarded-for") || "127.0.0.1",
        },
      });

      return json(
        { ok: true, user: sessionUser, token: session.id },
        200,
        { "Set-Cookie": cookieHeader },
      );
    }

    // ─── AUTH: Signup / Register ──────────────────────────────────────
    if (path === "/api/auth/register" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        password?: string;
        firstName?: string;
        lastName?: string;
        organizationName?: string;
      };

      const email = body.email?.trim().toLowerCase();
      const password = body.password;
      const firstName = body.firstName?.trim() || "User";
      const lastName = body.lastName?.trim() || "";
      const orgName = body.organizationName?.trim() || `${firstName}'s Team`;

      if (!email || !password) return badRequest("Email and password are required.");
      if (password.length < 8) return badRequest("Password must be at least 8 characters.");

      const existing = await db.user.findUnique({ where: { email } });
      if (existing) return badRequest("An account with this email already exists.", 409);

      // Create tenant
      const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
      const slug = `${baseSlug}-${Date.now().toString(36)}`;
      const tenant = await db.tenant.create({
        data: {
          name: orgName,
          slug,
          planCode: "STARTER",
          status: "ACTIVE",
        },
      });

      // Create user
      const user = await db.user.create({
        data: {
          email,
          passwordHash: hashPassword(password),
          firstName,
          lastName,
          role: "MEMBER",
          status: "ACTIVE",
          activeTenantId: tenant.id,
          emailVerifiedAt: new Date(),
        },
      });

      // Create owner membership
      await db.member.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      const session = await createSession(user.id);
      const sessionUser = await resolveSessionUser(session.id);
      const cookieHeader = sessionCookieAttributes(request, session.id);

      return json({ ok: true, user: sessionUser, token: session.id }, 201, {
        "Set-Cookie": cookieHeader,
      });
    }

    // ─── AUTH: Logout ─────────────────────────────────────────────────
    if (path === "/api/auth/logout" && method === "POST") {
      const token = extractSessionToken(request);
      if (token) await revokeSession(token);
      return json({ ok: true }, 200, {
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
      });
    }

    // ─── SESSION GUARD FOR PROTECTED ENDPOINTS ─────────────────────────
    const token = extractSessionToken(request);
    const currentUser = token ? await resolveSessionUser(token) : null;

    // ─── DOCUMENTS / ENVELOPES ────────────────────────────────────────
    if (path === "/api/documents") {
      if (!currentUser) return badRequest("Unauthorized", 401);
      const envelopes = await db.envelope.findMany({
        where: { tenantId: currentUser.tenantId || undefined },
        include: { recipients: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return json({ items: envelopes, total: envelopes.length });
    }

    if (path === "/api/documents/new" && method === "POST") {
      if (!currentUser || !currentUser.tenantId) return badRequest("Unauthorized", 401);
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
        recipients?: Array<{ name: string; email: string; role?: string }>;
        fileName?: string;
      };

      const title = body.title?.trim() || "Untitled Envelope";
      const publicCode = `ENV-${Date.now().toString(36).toUpperCase()}`;

      const envelope = await db.envelope.create({
        data: {
          title,
          publicCode,
          tenantId: currentUser.tenantId,
          createdById: currentUser.id,
          status: "DRAFT",
          recipients: {
            create: (body.recipients || []).map((r, idx) => ({
              name: r.name,
              email: r.email,
              role: r.role || "SIGNER",
              order: idx + 1,
              accessToken: `tok_${Date.now().toString(36)}_${idx}`,
            })),
          },
        },
        include: { recipients: true },
      });

      await db.auditEvent.create({
        data: {
          actor: `${currentUser.firstName} ${currentUser.lastName}`,
          actorRole: currentUser.role,
          actorUserId: currentUser.id,
          tenantId: currentUser.tenantId,
          action: "envelope.created",
          resource: envelope.id,
          severity: "INFO",
          detail: `Created envelope "${envelope.title}" (${envelope.publicCode})`,
          ip: request.headers.get("x-forwarded-for") || "127.0.0.1",
        },
      });

      return json({ ok: true, envelope });
    }

    // ─── ADMIN: Overview ──────────────────────────────────────────────
    if (path === "/api/admin/overview") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden - platform admin required", 403);
      }

      const [tenantCount, userCount, envelopeCount, completedCount, auditEvents] =
        await Promise.all([
          db.tenant.count(),
          db.user.count(),
          db.envelope.count(),
          db.envelope.count({ where: { status: "COMPLETED" } }),
          db.auditEvent.findMany({
            orderBy: { at: "desc" },
            take: 20,
          }),
        ]);

      return json({
        kpis: {
          tenants: tenantCount,
          users: userCount,
          envelopes: envelopeCount,
          sealed: completedCount,
          mrr: 847,
          activeToday: userCount,
          completionRate: envelopeCount ? completedCount / envelopeCount : 1,
          dsarOpen: 0,
          dmcaOpen: 0,
          incidentsOpen: 0,
        },
        health: {
          dbOk: true,
          storageOk: true,
          mailOk: true,
          queueDepth: 0,
          signingConformance: "PAdES-B-LT",
          tsaReachable: true,
        },
        auditEvents,
      });
    }

    // ─── ADMIN: Tenants & Users ───────────────────────────────────────
    if (path === "/api/admin/tenants") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden", 403);
      }
      const tenants = await db.tenant.findMany({
        include: { _count: { select: { members: true, envelopes: true } } },
        orderBy: { createdAt: "desc" },
      });
      return json({ items: tenants, total: tenants.length });
    }

    if (path === "/api/admin/users") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden", 403);
      }
      const users = await db.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          lastActiveAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return json({ items: users, total: users.length });
    }

    // Fallback: endpoint not found
    return json({ error: `Not Found: ${method} ${path}` }, 404);
  } catch (error) {
    console.error(`API Error on ${method} ${path}:`, error);
    return json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      500,
    );
  }
}
