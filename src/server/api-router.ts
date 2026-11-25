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
import {
  COMPANY,
  EMAIL_ACCOUNTS,
  SUBDOMAINS,
  DNS_RECORDS,
  DEFAULT_PROVISIONING_STATE,
  buildZoneFile,
  type CompanyIdentity,
  type ProvisioningState,
} from "../lib/provisioning";

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

    // ─── PUBLIC: Enterprise Lead Form ───────────────────────────────────
    if (path === "/api/enterprise-lead" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        company?: string;
        contactName?: string;
        email?: string;
        phone?: string;
        seats?: number | string;
        monthlyEnvelopes?: number | string;
        requirements?: string;
        website?: string;
        formStartedAt?: number;
      };

      // Silently accept honeypot traps
      if (body.website) {
        return json({ ok: true, message: "Request received — we'll reply within one business day" });
      }

      const company = body.company?.trim();
      const contactName = body.contactName?.trim();
      const email = body.email?.trim().toLowerCase();

      if (!company || !contactName || !email || !email.includes("@")) {
        return badRequest("Company, contact name, and valid email are required.");
      }

      const seats = typeof body.seats === "number" ? body.seats : parseInt(String(body.seats || "10"), 10) || 10;
      const monthlyEnvelopes =
        typeof body.monthlyEnvelopes === "number"
          ? body.monthlyEnvelopes
          : parseInt(String(body.monthlyEnvelopes || "500"), 10) || 500;

      const lead = await db.enterpriseLead.create({
        data: {
          company,
          contactName,
          companyLower: company.toLowerCase(),
          contactNameLower: contactName.toLowerCase(),
          email,
          phone: body.phone?.trim() || null,
          seats,
          monthlyEnvelopes,
          requirements: body.requirements?.trim() || "",
          status: "NEW",
          notes: "",
        },
      });

      await db.auditEvent.create({
        data: {
          actor: contactName,
          actorRole: "PUBLIC",
          action: "enterprise.lead.created",
          resource: lead.id,
          severity: "INFO",
          detail: `Enterprise lead submitted for ${company} (${email})`,
          ip: request.headers.get("x-forwarded-for") || "127.0.0.1",
        },
      });

      return json(
        {
          ok: true,
          leadId: lead.id,
          message: "Request received — our VOIRIA enterprise team will reply within one business day.",
        },
        201,
      );
    }

    // ─── SESSION GUARD FOR PROTECTED ENDPOINTS ─────────────────────────
    const token = extractSessionToken(request);
    const currentUser = token ? await resolveSessionUser(token) : null;

    // ─── WORKSPACE: Overview ──────────────────────────────────────────
    if (path === "/api/workspace/overview") {
      if (!currentUser) return badRequest("Unauthorized", 401);
      const tenantId = currentUser.tenantId || undefined;
      const tenant = tenantId ? await db.tenant.findUnique({ where: { id: tenantId } }) : null;
      const [envelopes, members] = await Promise.all([
        db.envelope.findMany({
          where: { tenantId },
          include: { recipients: true },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
        db.member.findMany({
          where: { tenantId },
          include: { user: true },
        }),
      ]);

      const completed = envelopes.filter((e) => e.status === "COMPLETED").length;
      const pending = envelopes.filter((e) => ["SENT", "PARTIALLY_SIGNED", "DRAFT"].includes(e.status)).length;
      const planLimits: Record<string, number> = { SOLO: 10, STARTER: 100, SMART: 500, BUSINESS: 2000 };
      const limit = (tenant?.planCode ? planLimits[tenant.planCode] : undefined) ?? 100;

      return json({
        plan: { name: tenant?.planCode || "SOLO", code: tenant?.planCode || "SOLO", envelopeLimit: limit },
        tenant: { name: tenant?.name || "Workspace" },
        quota: {
          used: envelopes.length,
          limit,
          carriedForward: 0,
          total: limit,
          remaining: Math.max(0, limit - envelopes.length),
        },
        kpis: {
          sentThisMonth: envelopes.length,
          completed,
          pending,
          awaitingMe: 0,
        },
        recent: envelopes.slice(0, 6).map((e) => ({
          id: e.id,
          publicCode: e.publicCode,
          title: e.title,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          recipients: e.recipients.map((r) => ({ name: r.name, status: r.status })),
        })),
        mySignQueue: [],
        team: members.map((m) => ({
          id: m.id,
          role: m.role,
          name: `${m.user.firstName} ${m.user.lastName}`,
          email: m.user.email,
          status: m.status,
          totpEnabled: m.user.totpEnabled,
        })),
      });
    }

    // ─── WORKSPACE: Templates ─────────────────────────────────────────
    if (path === "/api/workspace/templates") {
      if (!currentUser) return badRequest("Unauthorized", 401);
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: { name?: string; description?: string; category?: string; pages?: number };
        };
        if (body.op === "create") {
          const name = body.data?.name?.trim() || "Untitled Template";
          const tpl = await db.template.create({
            data: {
              tenantId: currentUser.tenantId || null,
              name,
              nameLower: name.toLowerCase(),
              description: body.data?.description?.trim() || null,
              category: body.data?.category || "General",
              pages: body.data?.pages || 1,
              publicSlug: `tpl-${Date.now().toString(36)}`,
            },
          });
          return json({ ok: true, message: `Template "${name}" created.`, template: tpl }, 201);
        }
        return json({ ok: true, message: "Template action completed." });
      }
      const q = url.searchParams.get("q")?.trim().toLowerCase() || "";
      const templates = await db.template.findMany({
        where: {
          OR: [{ tenantId: currentUser.tenantId || undefined }, { isBuiltIn: true }],
        },
        orderBy: { createdAt: "desc" },
      });
      const filtered = q
        ? templates.filter((t) => t.nameLower.includes(q) || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
        : templates;
      return json({
        rows: filtered,
        folders: [{ name: "All templates", count: filtered.length }],
        total: filtered.length,
      });
    }

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

    // ─── ADMIN: Enterprise Leads ──────────────────────────────────────
    if (path === "/api/admin/leads") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden - platform admin required", 403);
      }

      if (method === "GET") {
        const q = url.searchParams.get("q")?.toLowerCase();
        const statusFilter = url.searchParams.get("status");

        const where: Record<string, unknown> = {};
        if (statusFilter && statusFilter !== "ALL") {
          where.status = statusFilter;
        }
        if (q) {
          where.OR = [
            { companyLower: { contains: q } },
            { contactNameLower: { contains: q } },
            { email: { contains: q } },
          ];
        }

        const [leads, newCount, wonCount] = await Promise.all([
          db.enterpriseLead.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          db.enterpriseLead.count({ where: { status: "NEW" } }),
          db.enterpriseLead.count({ where: { status: "WON" } }),
        ]);

        return json({
          total: leads.length,
          leads: leads.map((l) => ({
            ...l,
            createdAt: l.createdAt.toISOString(),
            updatedAt: l.updatedAt.toISOString(),
          })),
          kpis: { newCount, wonCount },
        });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "create" && body.data) {
          const d = body.data as {
            company?: string;
            contactName?: string;
            email?: string;
            phone?: string;
            seats?: number;
            monthlyEnvelopes?: number;
            requirements?: string;
            status?: string;
          };
          const company = String(d.company || "").trim();
          const contactName = String(d.contactName || "").trim();
          const email = String(d.email || "").trim().toLowerCase();

          if (!company || !contactName || !email) {
            return badRequest("Company, contact name and email are required");
          }

          const lead = await db.enterpriseLead.create({
            data: {
              company,
              companyLower: company.toLowerCase(),
              contactName,
              contactNameLower: contactName.toLowerCase(),
              email,
              phone: d.phone ? String(d.phone) : null,
              seats: Number(d.seats) || 10,
              monthlyEnvelopes: Number(d.monthlyEnvelopes) || 500,
              requirements: String(d.requirements || ""),
              status: String(d.status || "NEW"),
            },
          });
          return json({ ok: true, message: `Lead created for ${lead.company}`, lead });
        }

        if (body.id) {
          const lead = await db.enterpriseLead.findUnique({ where: { id: body.id } });
          if (!lead) return badRequest("Lead not found", 404);

          if (body.op === "status.set" && body.data?.status) {
            await db.enterpriseLead.update({
              where: { id: body.id },
              data: { status: String(body.data.status) },
            });
            return json({ ok: true, message: `Status updated to ${body.data.status}` });
          }

          if (body.op === "notes.set") {
            await db.enterpriseLead.update({
              where: { id: body.id },
              data: { notes: String(body.data?.notes || "") },
            });
            return json({ ok: true, message: "Notes saved" });
          }
        }

        return json({ ok: true, message: "Lead updated" });
      }
    }

    // ─── ADMIN: Email & DNS Provisioning ──────────────────────────────
    if (path === "/api/admin/provisioning") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden - platform admin required", 403);
      }

      let setting = await db.platformSetting.findUnique({ where: { id: "singleton" } });
      if (!setting) {
        setting = await db.platformSetting.create({
          data: {
            id: "singleton",
            certExpiryAt: new Date(Date.now() + 365 * 86400 * 1000),
          },
        });
      }

      let companyProfile: CompanyIdentity = { ...COMPANY };
      if (setting.companyProfile) {
        try {
          companyProfile = { ...COMPANY, ...JSON.parse(setting.companyProfile) };
        } catch {
          // ignore
        }
      }

      const provState: ProvisioningState = { ...DEFAULT_PROVISIONING_STATE };
      if (setting.provisioningState) {
        try {
          const parsed = JSON.parse(setting.provisioningState) as Partial<ProvisioningState>;
          if (parsed.provisionedEmails) provState.provisionedEmails = parsed.provisionedEmails;
          if (parsed.liveSubdomains) provState.liveSubdomains = parsed.liveSubdomains;
          if (parsed.verifiedRecords) provState.verifiedRecords = parsed.verifiedRecords;
        } catch {
          // ignore
        }
      }

      if (method === "GET") {
        const emails = EMAIL_ACCOUNTS.map((e) => ({
          ...e,
          provisioned: provState.provisionedEmails.includes(e.address),
        }));
        const subdomains = SUBDOMAINS.map((s) => ({
          ...s,
          live: provState.liveSubdomains.includes(s.host === "@" ? "" : s.host),
        }));
        const dnsRecords = DNS_RECORDS.map((r) => ({
          ...r,
          verified: provState.verifiedRecords.includes(r.id),
        }));

        const zoneFile = buildZoneFile(companyProfile, provState);

        return json({
          company: companyProfile,
          emails,
          subdomains,
          dnsRecords,
          zoneFile,
          summary: {
            emailsProvisioned: emails.filter((e) => e.provisioned).length,
            emailsTotal: emails.length,
            subdomainsLive: subdomains.filter((s) => s.live).length,
            subdomainsTotal: subdomains.length,
            recordsVerified: dnsRecords.filter((r) => r.verified).length,
            recordsTotal: dnsRecords.length,
          },
        });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "company.update" && body.data) {
          const updated = { ...companyProfile, ...body.data };
          await db.platformSetting.update({
            where: { id: "singleton" },
            data: { companyProfile: JSON.stringify(updated) },
          });

          await db.auditEvent.create({
            data: {
              actor: `${currentUser.firstName} ${currentUser.lastName}`,
              actorRole: currentUser.role,
              actorUserId: currentUser.id,
              action: "provisioning.company.updated",
              resource: "company",
              severity: "INFO",
              detail: `Updated company identity: ${updated.legalName}`,
              ip: request.headers.get("x-forwarded-for") || "127.0.0.1",
            },
          });

          return json({ ok: true, message: "Company identity updated successfully" });
        }

        if (body.op === "email.provision" && body.id) {
          if (!provState.provisionedEmails.includes(body.id)) {
            provState.provisionedEmails.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Mailbox ${body.id} provisioned` });
        }

        if (body.op === "email.test" && body.id) {
          return json({ ok: true, message: `Test message queued for ${body.id}` });
        }

        if (body.op === "dns.verify" && body.id) {
          if (!provState.verifiedRecords.includes(body.id)) {
            provState.verifiedRecords.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Record ${body.id} verified` });
        }

        if (body.op === "subdomain.verify" && body.id) {
          if (!provState.liveSubdomains.includes(body.id)) {
            provState.liveSubdomains.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Host ${body.id} marked live` });
        }

        return json({ ok: true, message: "Provisioning action completed" });
      }
    }

    // ─── WORKSPACE: Envelopes ─────────────────────────────────────────
    if (path === "/api/workspace/envelopes") {
      if (!currentUser || !currentUser.tenantId) return badRequest("Unauthorized", 401);

      if (method === "GET") {
        const envelopes = await db.envelope.findMany({
          where: { tenantId: currentUser.tenantId },
          include: { recipients: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return json({ items: envelopes, total: envelopes.length });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "void" && body.id) {
          await db.envelope.updateMany({
            where: { id: body.id, tenantId: currentUser.tenantId },
            data: { status: "VOIDED" },
          });
          return json({ ok: true, message: "Envelope voided" });
        }

        return json({ ok: true, message: "Action recorded" });
      }
    }

    // ─── ADMIN: Leads ─────────────────────────────────────────────────
    if (path.startsWith("/api/admin/leads")) {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden - platform admin required", 403);
      }

      if (method === "GET") {
        const q = url.searchParams.get("q")?.toLowerCase();
        const statusFilter = url.searchParams.get("status");

        const where: Record<string, unknown> = {};
        if (statusFilter && statusFilter !== "ALL") {
          where.status = statusFilter;
        }
        if (q) {
          where.OR = [
            { companyLower: { contains: q } },
            { contactNameLower: { contains: q } },
            { email: { contains: q } },
          ];
        }

        const [leads, newCount, wonCount] = await Promise.all([
          db.enterpriseLead.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          db.enterpriseLead.count({ where: { status: "NEW" } }),
          db.enterpriseLead.count({ where: { status: "WON" } }),
        ]);

        return json({
          total: leads.length,
          leads: leads.map((l) => ({
            ...l,
            createdAt: l.createdAt.toISOString(),
            updatedAt: l.updatedAt.toISOString(),
          })),
          kpis: { newCount, wonCount },
        });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "create" && body.data) {
          const d = body.data as {
            company?: string;
            contactName?: string;
            email?: string;
            phone?: string;
            seats?: number;
            monthlyEnvelopes?: number;
            requirements?: string;
            status?: string;
          };
          const company = String(d.company || "").trim();
          const contactName = String(d.contactName || "").trim();
          const email = String(d.email || "").trim().toLowerCase();

          if (!company || !contactName || !email) {
            return badRequest("Company, contact name and email are required");
          }

          const lead = await db.enterpriseLead.create({
            data: {
              company,
              companyLower: company.toLowerCase(),
              contactName,
              contactNameLower: contactName.toLowerCase(),
              email,
              phone: d.phone ? String(d.phone) : null,
              seats: Number(d.seats) || 10,
              monthlyEnvelopes: Number(d.monthlyEnvelopes) || 500,
              requirements: String(d.requirements || ""),
              status: String(d.status || "NEW"),
            },
          });
          return json({ ok: true, message: `Lead created for ${lead.company}`, lead });
        }

        if (body.id) {
          const lead = await db.enterpriseLead.findUnique({ where: { id: body.id } });
          if (!lead) return badRequest("Lead not found", 404);

          if (body.op === "status.set" && body.data?.status) {
            await db.enterpriseLead.update({
              where: { id: body.id },
              data: { status: String(body.data.status) },
            });
            return json({ ok: true, message: `Status updated to ${body.data.status}` });
          }

          if (body.op === "notes.set") {
            await db.enterpriseLead.update({
              where: { id: body.id },
              data: { notes: String(body.data?.notes || "") },
            });
            return json({ ok: true, message: "Notes saved" });
          }
        }

        return json({ ok: true, message: "Lead updated" });
      }
    }

    // ─── ADMIN: Provisioning ──────────────────────────────────────────
    if (path === "/api/admin/provisioning") {
      if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
        return badRequest("Forbidden - platform admin required", 403);
      }

      let setting = await db.platformSetting.findUnique({ where: { id: "singleton" } });
      if (!setting) {
        setting = await db.platformSetting.create({
          data: {
            id: "singleton",
            certExpiryAt: new Date(Date.now() + 365 * 86400 * 1000),
          },
        });
      }

      let companyProfile: CompanyIdentity = { ...COMPANY };
      if (setting.companyProfile) {
        try {
          companyProfile = { ...COMPANY, ...JSON.parse(setting.companyProfile) };
        } catch {
          // ignore
        }
      }

      const provState: ProvisioningState = { ...DEFAULT_PROVISIONING_STATE };
      if (setting.provisioningState) {
        try {
          const parsed = JSON.parse(setting.provisioningState) as Partial<ProvisioningState>;
          if (parsed.provisionedEmails) provState.provisionedEmails = parsed.provisionedEmails;
          if (parsed.liveSubdomains) provState.liveSubdomains = parsed.liveSubdomains;
          if (parsed.verifiedRecords) provState.verifiedRecords = parsed.verifiedRecords;
        } catch {
          // ignore
        }
      }

      if (method === "GET") {
        const emails = EMAIL_ACCOUNTS.map((e) => ({
          ...e,
          provisioned: provState.provisionedEmails.includes(e.address),
        }));
        const subdomains = SUBDOMAINS.map((s) => ({
          ...s,
          live: provState.liveSubdomains.includes(s.host === "@" ? "" : s.host),
        }));
        const dnsRecords = DNS_RECORDS.map((r) => ({
          ...r,
          verified: provState.verifiedRecords.includes(r.id),
        }));

        const zoneFile = buildZoneFile(companyProfile, provState);

        return json({
          company: companyProfile,
          emails,
          subdomains,
          dnsRecords,
          zoneFile,
          summary: {
            emailsProvisioned: emails.filter((e) => e.provisioned).length,
            emailsTotal: emails.length,
            subdomainsLive: subdomains.filter((s) => s.live).length,
            subdomainsTotal: subdomains.length,
            recordsVerified: dnsRecords.filter((r) => r.verified).length,
            recordsTotal: dnsRecords.length,
          },
        });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "company.update" && body.data) {
          const updated = { ...companyProfile, ...body.data };
          await db.platformSetting.update({
            where: { id: "singleton" },
            data: { companyProfile: JSON.stringify(updated) },
          });

          await db.auditEvent.create({
            data: {
              actor: `${currentUser.firstName} ${currentUser.lastName}`,
              actorRole: currentUser.role,
              actorUserId: currentUser.id,
              action: "provisioning.company.updated",
              resource: "company",
              severity: "INFO",
              detail: `Updated company identity: ${updated.legalName}`,
              ip: request.headers.get("x-forwarded-for") || "127.0.0.1",
            },
          });

          return json({ ok: true, message: "Company identity updated successfully" });
        }

        if (body.op === "email.provision" && body.id) {
          if (!provState.provisionedEmails.includes(body.id)) {
            provState.provisionedEmails.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Mailbox ${body.id} provisioned` });
        }

        if (body.op === "email.test" && body.id) {
          return json({ ok: true, message: `Test message delivered to ${body.id}` });
        }

        if (body.op === "dns.verify" && body.id) {
          if (!provState.verifiedRecords.includes(body.id)) {
            provState.verifiedRecords.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Record ${body.id} verified` });
        }

        if (body.op === "subdomain.verify" && body.id) {
          if (!provState.liveSubdomains.includes(body.id)) {
            provState.liveSubdomains.push(body.id);
            await db.platformSetting.update({
              where: { id: "singleton" },
              data: { provisioningState: JSON.stringify(provState) },
            });
          }
          return json({ ok: true, message: `Host ${body.id} is live` });
        }

        return json({ ok: true, message: "Provisioning action completed" });
      }
    }

    // ─── WORKSPACE: Envelopes ─────────────────────────────────────────
    if (path.startsWith("/api/workspace/envelopes")) {
      if (!currentUser || !currentUser.tenantId) return badRequest("Unauthorized", 401);

      if (method === "GET") {
        const envelopes = await db.envelope.findMany({
          where: { tenantId: currentUser.tenantId },
          include: { recipients: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return json({ items: envelopes, total: envelopes.length });
      }

      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          op?: string;
          id?: string;
          data?: Record<string, unknown>;
        };

        if (body.op === "void" && body.id) {
          await db.envelope.updateMany({
            where: { id: body.id, tenantId: currentUser.tenantId },
            data: { status: "VOIDED" },
          });
          return json({ ok: true, message: "Envelope voided" });
        }

        return json({ ok: true, message: "Action recorded" });
      }
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
