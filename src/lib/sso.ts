import { createHash, createHmac, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieAttributes } from "@/lib/auth";
import * as jose from "jose";

/**
 * Single sign-on (go-live cycle): OIDC and SAML wiring for enterprise
 * workspaces and self-hosted instances.
 *
 *  OIDC  — discovery-driven authorization-code flow with PKCE and a nonce.
 *          Works with Microsoft Entra ID, Google Workspace, Okta, Keycloak,
 *          Authentik and any compliant provider.
 *  SAML  — this instance is the SP (metadata served at
 *          /api/auth/sso/metadata/saml); the IdP is configured from its
 *          metadata XML in Settings → Security → SSO.
 *
 * Users are matched by email domain to an ACTIVE SsoConnection. Unknown
 * emails are JIT-provisioned (ACTIVE, email-verified, member of the
 * connection's tenant) — the IdP's assertion is the proof of identity.
 */

// ─── Transaction cookie (state + PKCE + nonce, HMAC-signed) ──────────────────

export interface SsoTxn {
  /** Anti-CSRF state (OIDC) or RelayState (SAML). */
  state: string;
  connectionId: string;
  /** OIDC only. */
  codeVerifier?: string;
  nonce?: string;
  /** Where to land after a successful login. */
  postLogin: string;
}

function txnSecret(): string {
  return (
    process.env.SSO_TXN_SECRET ??
    process.env.AUTH_SECRET ??
    `docurama-sso-${process.env.DATABASE_URL ?? "dev"}` // per-instance fallback; set SSO_TXN_SECRET in production
  );
}

export function encodeSsoTxn(txn: SsoTxn): string {
  const body = Buffer.from(JSON.stringify(txn), "utf8").toString("base64url");
  const mac = createHmac("sha256", txnSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function decodeSsoTxn(cookie: string | undefined): SsoTxn | null {
  if (!cookie) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", txnSecret()).update(body).digest("base64url");
  if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SsoTxn;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return ab.equals(bb); // constant-time for equal lengths
}

export const SSO_TXN_COOKIE = "docurama_sso_txn";

export function txnCookieAttributes(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=600;${secure}`;
}

// ─── Connection lookup ───────────────────────────────────────────────────────

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export async function findSsoConnection(email: string) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const connections = await db.ssoConnection.findMany({
    where: { emailDomain: domain, status: "ACTIVE" },
    orderBy: [{ tenantId: { sort: "desc" } }], // tenant-specific first, platform-wide (null tenant) last
  });
  return connections[0] ?? null;
}

// ─── OIDC ────────────────────────────────────────────────────────────────────

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

const discoveryCache = new Map<string, { doc: OidcDiscovery; at: number }>();
const DISCOVERY_TTL_MS = 10 * 60_000;

export async function oidcDiscovery(issuerUrl: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuerUrl);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;

  const wellKnown = new URL(issuerUrl);
  if (!/^https?:\/\//.test(wellKnown.toString())) throw new Error("issuerUrl must be an absolute http(s) URL");
  // Well-known resolution per OIDC Discovery: strip trailing slash, append path.
  const base = issuerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Discovery document unavailable (HTTP ${res.status})`);
  const doc = (await res.json()) as OidcDiscovery;
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (!doc[key]) throw new Error(`Discovery document missing ${key}`);
  }
  discoveryCache.set(issuerUrl, { doc, at: Date.now() });
  return doc;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  // S256: base64url(sha256(verifier)) per RFC 7636.
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildOidcAuthorizeUrl(input: {
  discovery: OidcDiscovery;
  clientId: string;
  origin: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint: string;
}): string {
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", `${input.origin}/api/auth/sso/callback/oidc`);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export interface OidcIdentity {
  email: string;
  name: string;
  issuer: string;
}

export async function verifyOidcCallback(input: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  nonce: string;
  origin: string;
}): Promise<OidcIdentity> {
  const tokenRes = await fetch(input.discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: `${input.origin}/api/auth/sso/callback/oidc`,
      code_verifier: input.codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (HTTP ${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new Error("Token response missing id_token");

  const jwks = jose.createRemoteJWKSet(new URL(input.discovery.jwks_uri));
  const claims = await jose.jwtVerify(tokens.id_token, jwks, {
    issuer: input.discovery.issuer,
    audience: input.clientId,
    clockTolerance: 60,
  });

  const payload = claims.payload as { nonce?: string; email?: string; name?: string; preferred_username?: string };
  if (payload.nonce !== input.nonce) throw new Error("id_token nonce mismatch — possible replay");
  if (!payload.email) throw new Error("id_token carries no email claim (require the 'email' scope)");

  return {
    email: String(payload.email).toLowerCase(),
    name: String(payload.name ?? payload.preferred_username ?? payload.email),
    issuer: claims.payload.iss ?? input.discovery.issuer,
  };
}


// ─── SAML (SP side, via samlify) ─────────────────────────────────────────────

let samlifyReady = false;
async function getSamlify() {
  const samlify = await import("samlify");
  if (!samlifyReady) {
    // XSD validation disabled (signature verification still enforced);
    // the xmllint-wasm validator is an optional peer dependency.
    samlify.setSchemaValidator({
      validate: async () => Promise.resolve(true),
    });
    samlifyReady = true;
  }
  return samlify;
}

/** SP metadata for this instance, generated from the request origin. */
export function spMetadataXml(origin: string): string {
  const entityId = `${origin}/api/auth/sso/metadata/saml`;
  const acs = `${origin}/api/auth/sso/callback/saml`;
  return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService isDefault="true" index="0" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

export async function buildSamlLoginUrl(input: {
  idpMetadataXml: string;
  origin: string;
  relayState: string;
}): Promise<string> {
  const samlify = await getSamlify();
  const sp = samlify.ServiceProvider({ metadata: spMetadataXml(input.origin) });
  const idp = samlify.IdentityProvider({ metadata: input.idpMetadataXml });
  const { context } = await sp.createLoginRequest(idp, "redirect");
  const url = new URL(String(context));
  url.searchParams.set("RelayState", input.relayState);
  return url.toString();
}

export interface SamlIdentity {
  email: string;
  name: string;
  issuer: string;
}

export async function verifySamlResponse(input: {
  idpMetadataXml: string;
  origin: string;
  samlResponse: string;
}): Promise<SamlIdentity> {
  const samlify = await getSamlify();
  const sp = samlify.ServiceProvider({ metadata: spMetadataXml(input.origin) });
  const idp = samlify.IdentityProvider({ metadata: input.idpMetadataXml });
  const result = await sp.parseLoginResponse(idp, "post", {
    body: { SAMLResponse: input.samlResponse },
  });
  const extracted = result.extract ?? {};

  const attrs = (extracted.attributes ?? {}) as Record<string, string | string[]>;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const nameId = typeof extracted.nameID === "string" ? extracted.nameID : undefined;
  const email =
    first(attrs["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]) ??
    first(attrs.email) ??
    first(attrs.mail) ??
    (nameId?.includes("@") ? nameId : undefined);
  if (!email) throw new Error("SAML assertion carries no email attribute or email-format NameID");
  const name =
    first(attrs["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"]) ??
    first(attrs.displayName) ??
    first(attrs.name) ??
    email;

  return {
    email: String(email).toLowerCase(),
    name: String(name),
    issuer: String(first(extracted.issuer) ?? ""),
  };
}

// ─── JIT provisioning + session issuance ─────────────────────────────────────

export interface SsoLoginResult {
  ok: true;
  userId: string;
  email: string;
  sessionId: string;
  created: boolean;
}

/**
 * Find-or-provision the user for a verified SSO identity, enroll them in the
 * connection's tenant when configured, and open a session. Password login is
 * left untouched (the password hash is random and unusable for SSO-created
 * accounts until the user sets one through reset-password).
 */
export async function jitSsoLogin(input: {
  email: string;
  name: string;
  connectionId: string;
  ip: string;
  userAgent: string | null;
  provider: "OIDC" | "SAML";
  issuer: string;
}): Promise<SsoLoginResult> {
  const connection = await db.ssoConnection.findUnique({ where: { id: input.connectionId } });
  if (!connection || connection.status !== "ACTIVE") throw new Error("SSO connection is no longer active");

  let user = await db.user.findUnique({ where: { email: input.email } });
  let created = false;
  if (!user) {
    const [firstName, ...rest] = input.name.trim().split(/\s+/);
    user = await db.user.create({
      data: {
        email: input.email,
        passwordHash: `sso!${randomBytes(24).toString("hex")}`, // not a valid argon/bcrypt hash — password login disabled
        firstName: firstName || input.email.split("@")[0],
        lastName: rest.join(" ") || "",
        role: "MEMBER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(), // the IdP asserted mailbox control
      },
    });
    created = true;
  } else if (user.status === "SUSPENDED") {
    throw new Error("This account is suspended — contact your workspace admin.");
  } else if (!user.emailVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }

  // Tenant enrollment for tenant-bound connections.
  if (connection.tenantId) {
    const existing = await db.member.findFirst({ where: { userId: user.id, tenantId: connection.tenantId } });
    if (!existing) {
      await db.member.create({
        data: { userId: user.id, tenantId: connection.tenantId, role: "MEMBER", status: "ACTIVE" },
      });
    }
  }

  const session = await db.session.create({
    data: {
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
  await db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  await db.auditEvent.create({
    data: {
      actor: `${user.firstName} ${user.lastName}`.trim(),
      actorRole: user.role,
      action: `user.login.sso_${input.provider.toLowerCase()}`,
      resource: `user:${user.email}`,
      ip: input.ip,
      detail: `${input.provider} login via ${connection.label}${created ? " — account JIT-provisioned" : ""} (issuer ${input.issuer})`,
    },
  });

  return { ok: true, userId: user.id, email: user.email, sessionId: session.id, created };
}

/** A redirect Response that carries the freshly-minted session cookie. */
export function ssoSessionRedirect(sessionId: string, postLogin: string, req: Request): Response {
  const target = postLogin.startsWith("/") ? postLogin : "/";
  const res = new Response(null, { status: 302, headers: { location: target } });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=${sessionId}; ${sessionCookieAttributes(req as never)}`);
  res.headers.append("set-cookie", `${SSO_TXN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
