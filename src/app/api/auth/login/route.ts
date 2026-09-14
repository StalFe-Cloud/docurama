import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, hashPassword, recordAudit, sessionCookieAttributes } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/serializers";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body");
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return jsonError("Email and password are required");

  const user = await db.user.findUnique({ where: { email } });
  // Uniform error — never reveal whether the account exists.
  if (!user || user.passwordHash !== hashPassword(password)) {
    await db.securityEvent.create({
      data: {
        type: "FAILED_LOGIN", severity: "LOW", actor: email || "unknown",
        ip: "198.51.100.7", blocked: false, detail: "Invalid credentials at portal sign-in",
      },
    });
    return jsonError("Invalid email or password", 401);
  }
  if (user.status === "SUSPENDED") {
    return jsonError("This account has been deactivated. Contact your administrator.", 403);
  }

  await db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  await recordAudit({
    actor: `${user.firstName} ${user.lastName}`, actorRole: user.role,
    action: "user.login.portal", resource: `user:${user.email}`, ip: "10.42.0.7",
  });

  // The session token is echoed in the body as a bearer fallback for embedding
  // contexts where the browser refuses to persist any cookie at all.
  const res = jsonOk({
    ok: true,
    token: user.id,
    user: { id: user.id, email: user.email, role: user.role, name: `${user.firstName} ${user.lastName}` },
  });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${user.id}; ${sessionCookieAttributes(req)}`,
  );
  return res;
}
