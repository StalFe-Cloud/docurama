/// <reference types="bun-types" />

/**
 * SSO E2E — OIDC and SAML wiring, hermetic.
 *
 * Run: bun test e2e/sso.test.ts   (run.sh wires a scratch DATABASE_URL)
 * Own process — it owns SSO_TXN_SECRET and spawns a stub OIDC provider.
 *
 * Covered:
 *  1. transaction-cookie sign/verify (tamper → rejected);
 *  2. OIDC: discovery, authorize URL (PKCE + nonce), full code exchange
 *     against a stub provider with a jose-signed id_token, nonce mismatch
 *     rejection, domain-bound JIT login (user + member + session + audit);
 *  3. SAML: SP metadata generation, a samlify-signed AuthnResponse
 *     round-trip (openssl-generated IdP key/cert), attribute extraction,
 *     JIT login;
 *  4. routes: lookup answers for matching/unknown domains, SP metadata
 *     endpoint serves valid XML.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as jose from "jose";

/* ── Scratch database ──────────────────────────────────────────────────────── */

const SCRATCH = join(mkdtempSync(join(tmpdir(), "sso-e2e-")), "scratch.db");
cpSync("db/custom.db", SCRATCH);
process.env.DATABASE_URL = `file:${SCRATCH}`;
process.env.SSO_TXN_SECRET = "sso-e2e-secret";

const db = new PrismaClient();

const lib = await import("../src/lib/sso");

/* ── Stub OIDC provider (discovery + authorize + token + JWKS) ─────────────── */

const ISSUER_PATH = "/idp";
const oidcStub = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `${ISSUER_PATH}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: `${url.origin}${ISSUER_PATH}`,
        authorization_endpoint: `${url.origin}${ISSUER_PATH}/authorize`,
        token_endpoint: `${url.origin}${ISSUER_PATH}/token`,
        jwks_uri: `${url.origin}${ISSUER_PATH}/jwks.json`,
      });
    }
    if (req.method === "GET" && url.pathname === `${ISSUER_PATH}/jwks.json`) {
      return Response.json(jwks);
    }
    if (req.method === "GET" && url.pathname === `${ISSUER_PATH}/authorize`) {
      // A compliant IdP would render a login page; the test drives the code
      // exchange directly, so just acknowledge.
      return new Response("authorize", { status: 200 });
    }
    if (req.method === "POST" && url.pathname === `${ISSUER_PATH}/token`) {
      const body = new URLSearchParams(await req.text());
      const code = body.get("code") ?? "";
      const issued = issuedTokens.get(code);
      if (!issued) return Response.json({ error: "invalid_grant" }, { status: 400 });
      issuedTokens.delete(code);
      return Response.json(issued);
    }
    return new Response("not found", { status: 404 });
  },
});

const ISSUER = `http://127.0.0.1:${oidcStub.port}${ISSUER_PATH}`;
const issuedTokens = new Map<string, { id_token: string; access_token: string }>();

const { publicKey, privateKey } = await jose.generateKeyPair("RS256", { extractable: true });
const jwks = {
  keys: [{ ...(await jose.exportJWK(publicKey)), alg: "RS256", use: "sig", kid: "sso-e2e-key" }],
};

async function issueOidcToken(code: string, claims: Record<string, unknown>) {
  const id_token = await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "sso-e2e-key" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience("sso-e2e-client")
    .setExpirationTime("5m")
    .sign(privateKey);
  issuedTokens.set(code, { id_token, access_token: "at_test" });
}

/* ── Fixtures: tenant + SSO connections ────────────────────────────────────── */

const tenant = await db.tenant.findUnique({ where: { slug: "solstice-media" } });
if (!tenant) throw new Error("seed tenant solstice-media missing — run bun run test:e2e:seed first");

const SSO_DOMAIN = "ssotest.example";

await db.ssoConnection.create({
  data: {
    tenantId: tenant.id,
    protocol: "OIDC",
    label: "SSO E2E Entra",
    emailDomain: SSO_DOMAIN,
    issuerUrl: ISSUER,
    clientId: "sso-e2e-client",
    clientSecret: "sso-e2e-secret-value",
  },
});

/* SAML IdP material (openssl-generated key + cert, embedded in metadata). */

const tmp = mkdtempSync(join(tmpdir(), "sso-idp-"));
const keyPath = join(tmp, "idp-key.pem");
const certPath = join(tmp, "idp-cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
  "-nodes", "-subj", "/CN=idp.ssotest.example", "-days", "2"], { stdio: "pipe" });
const idpKey = await Bun.file(keyPath).text();
const idpCertMod = (await Bun.file(certPath).text())
  .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

const IDP_ENTITY_ID = "https://idp.ssotest.example/metadata";
const idpMetadataXml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${IDP_ENTITY_ID}">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${idpCertMod}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.ssotest.example/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

await db.ssoConnection.create({
  data: {
    tenantId: tenant.id,
    protocol: "SAML",
    label: "SSO E2E SAML",
    emailDomain: "samlexample.test",
    idpMetadataXml,
  },
});

afterAll(async () => {
  await db.$disconnect();
  oidcStub.stop(true);
  rmSync(join(SCRATCH, ".."), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

/* ── 1. Transaction cookie ─────────────────────────────────────────────────── */

describe("sso transaction cookie", () => {
  test("round-trips and rejects tampering", () => {
    const txn = { state: "abc", connectionId: "c1", postLogin: "/welcome", nonce: "n", codeVerifier: "v" };
    const encoded = lib.encodeSsoTxn(txn);
    expect(lib.decodeSsoTxn(encoded)).toEqual(txn);
    expect(lib.decodeSsoTxn(undefined)).toBeNull();
    expect(lib.decodeSsoTxn("garbage")).toBeNull();
    const [body] = encoded.split(".");
    expect(lib.decodeSsoTxn(`${body}.forged`)).toBeNull();
  });
});

/* ── 2. OIDC ───────────────────────────────────────────────────────────────── */

describe("oidc flow", () => {
  test("connection lookup matches by email domain", async () => {
    const conn = await lib.findSsoConnection(`someone@${SSO_DOMAIN}`);
    expect(conn?.protocol).toBe("OIDC");
    expect(conn?.label).toBe("SSO E2E Entra");
    expect(await lib.findSsoConnection("nobody@unknown.example")).toBeNull();
  });

  test("discovery resolves the endpoints", async () => {
    const doc = await lib.oidcDiscovery(ISSUER);
    expect(doc.authorization_endpoint).toContain("/authorize");
    expect(doc.token_endpoint).toContain("/token");
    expect(doc.jwks_uri).toContain("/jwks.json");
  });

  test("authorize URL carries PKCE, nonce, state and login hint", () => {
    const pkce = lib.pkcePair();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    const url = new URL(lib.buildOidcAuthorizeUrl({
      discovery: {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks.json`,
      },
      clientId: "sso-e2e-client",
      origin: "http://127.0.0.1:3000",
      state: "st1", nonce: "n1", codeChallenge: pkce.challenge, loginHint: "a@b.c",
    }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/auth/sso/callback/oidc");
    expect(url.searchParams.get("login_hint")).toBe("a@b.c");
  });

  test("full code exchange verifies signature, issuer, audience and nonce", async () => {
    const nonce = "nonce-123";
    await issueOidcToken("good-code", { email: `ada@${SSO_DOMAIN}`, name: "Ada Lovelace", nonce });
    const discovery = await lib.oidcDiscovery(ISSUER);
    const identity = await lib.verifyOidcCallback({
      discovery, clientId: "sso-e2e-client", clientSecret: "sso-e2e-secret-value",
      code: "good-code", codeVerifier: "v", nonce, origin: "http://127.0.0.1:3000",
    });
    expect(identity.email).toBe(`ada@${SSO_DOMAIN}`);
    expect(identity.name).toBe("Ada Lovelace");
    expect(identity.issuer).toBe(ISSUER);
  });

  test("a nonce mismatch is rejected (replay protection)", async () => {
    await issueOidcToken("replay-code", { email: `eve@${SSO_DOMAIN}`, name: "Eve", nonce: "original" });
    const discovery = await lib.oidcDiscovery(ISSUER);
    await expect(lib.verifyOidcCallback({
      discovery, clientId: "sso-e2e-client", clientSecret: "sso-e2e-secret-value",
      code: "replay-code", codeVerifier: "v", nonce: "different", origin: "http://127.0.0.1:3000",
    })).rejects.toThrow(/nonce/);
  });

  test("JIT login provisions the user, enrolls them in the tenant and opens a session", async () => {
    const conn = await lib.findSsoConnection(`grace@${SSO_DOMAIN}`);
    expect(conn).toBeTruthy();
    const login = await lib.jitSsoLogin({
      email: `grace@${SSO_DOMAIN}`, name: "Grace Hopper",
      connectionId: conn!.id, ip: "10.0.0.9", userAgent: "sso-e2e",
      provider: "OIDC", issuer: ISSUER,
    });
    expect(login.created).toBe(true);

    const user = await db.user.findUnique({ where: { email: `grace@${SSO_DOMAIN}` } });
    expect(user?.status).toBe("ACTIVE");
    expect(user?.emailVerifiedAt).toBeTruthy();
    // SSO accounts cannot fall back to password login (hash is not a real one).
    expect(user?.passwordHash.startsWith("sso!")).toBe(true);

    const member = await db.member.findFirst({ where: { userId: user!.id, tenantId: tenant.id } });
    expect(member?.role).toBe("MEMBER");

    const session = await db.session.findUnique({ where: { id: login.sessionId } });
    expect(session?.userId).toBe(user!.id);

    const audit = await db.auditEvent.findFirst({ where: { action: "user.login.sso_oidc", resource: `user:grace@${SSO_DOMAIN}` } });
    expect(audit?.detail).toContain("JIT-provisioned");

    // Second login: same user, no duplicate, no re-provision.
    const second = await lib.jitSsoLogin({
      email: `grace@${SSO_DOMAIN}`, name: "Grace Hopper",
      connectionId: conn!.id, ip: "10.0.0.9", userAgent: "sso-e2e",
      provider: "OIDC", issuer: ISSUER,
    });
    expect(second.created).toBe(false);
    expect(await db.member.count({ where: { userId: user!.id, tenantId: tenant.id } })).toBe(1);
  });
});

/* ── 3. SAML ───────────────────────────────────────────────────────────────── */

describe("saml flow", () => {
  test("SP metadata is generated from the origin with the ACS bound", () => {
    const xml = lib.spMetadataXml("http://127.0.0.1:3000");
    expect(xml).toContain('entityID="http://127.0.0.1:3000/api/auth/sso/metadata/saml"');
    expect(xml).toContain('Location="http://127.0.0.1:3000/api/auth/sso/callback/saml"');
    expect(xml).toContain('WantAssertionsSigned="true"');
  });

  test("a signed AuthnResponse round-trips: extraction, signature and JIT login", async () => {
    const samlify = await import("samlify");
    const sp = samlify.ServiceProvider({ metadata: lib.spMetadataXml("http://127.0.0.1:3000") });
    const idp = samlify.IdentityProvider({ metadata: idpMetadataXml, privateKey: idpKey });
    const { context } = await idp.createLoginResponse(
      sp,
      null as never,
      "post",
      { email: "alan@samlexample.test" },
      undefined as never,
    );
    // Post-binding context is already the base64 SAMLResponse form value.
    const samlResponse = String(context);

    const identity = await lib.verifySamlResponse({
      idpMetadataXml, origin: "http://127.0.0.1:3000", samlResponse,
    });
    // The default template maps user.email to the NameID; the lib falls back
    // to the email-format NameID when no attribute statement is present.
    expect(identity.email).toBe("alan@samlexample.test");
    expect(identity.issuer).toContain("idp.ssotest.example");

    const conn = await lib.findSsoConnection("alan@samlexample.test");
    expect(conn?.protocol).toBe("SAML");
    const login = await lib.jitSsoLogin({
      email: identity.email, name: identity.name,
      connectionId: conn!.id, ip: "10.0.0.9", userAgent: "sso-e2e",
      provider: "SAML", issuer: identity.issuer,
    });
    expect(login.created).toBe(true);
    const audit = await db.auditEvent.findFirst({ where: { action: "user.login.sso_saml", resource: "user:alan@samlexample.test" } });
    expect(audit).toBeTruthy();
  });

  test("a tampered assertion is rejected by signature verification", async () => {
    const samlify = await import("samlify");
    const sp = samlify.ServiceProvider({ metadata: lib.spMetadataXml("http://127.0.0.1:3000") });
    const idp = samlify.IdentityProvider({ metadata: idpMetadataXml, privateKey: idpKey });
    const { context } = await idp.createLoginResponse(sp, null as never, "post", { email: "alan@samlexample.test" }, undefined as never);
    // Re-sign nothing: swap the signed NameID after the fact — the signature
    // no longer covers the document, so verification must fail.
    const xml = Buffer.from(String(context), "base64").toString("utf8")
      .replace("alan@samlexample.test", "mallory@samlexample.test");
    const tampered = Buffer.from(xml, "utf8").toString("base64");
    await expect(lib.verifySamlResponse({
      idpMetadataXml, origin: "http://127.0.0.1:3000", samlResponse: tampered,
    })).rejects.toThrow();
  });
});

/* ── 4. Routes (cookie-free ones, invoked directly) ────────────────────────── */

describe("sso routes", () => {
  test("lookup answers for a configured domain and stays silent otherwise", async () => {
    const route = await import("../src/app/api/auth/sso/lookup/route");
    const req = new Request(`http://127.0.0.1:3000/api/auth/sso/lookup?email=ada@${SSO_DOMAIN}`) as never;
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sso: boolean; label?: string };
    expect(body.sso).toBe(true);
    expect(body.label).toBe("SSO E2E Entra");

    const none = new Request("http://127.0.0.1:3000/api/auth/sso/lookup?email=x@unknown.example") as never;
    expect(((await (await route.GET(none)).json()) as { sso: boolean }).sso).toBe(false);
  });

  test("SP metadata endpoint serves the XML", async () => {
    const route = await import("../src/app/api/auth/sso/metadata/saml/route");
    const res = await route.GET(new Request("http://127.0.0.1:3000/api/auth/sso/metadata/saml") as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("md:EntityDescriptor");
  });
});
