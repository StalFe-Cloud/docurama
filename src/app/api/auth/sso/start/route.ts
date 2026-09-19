import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import {
  buildOidcAuthorizeUrl, buildSamlLoginUrl, encodeSsoTxn, findSsoConnection,
  oidcDiscovery, pkcePair, SSO_TXN_COOKIE, txnCookieAttributes,
} from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/sso/start?email=…[&post=/welcome] — begin the SSO flow for
 * the email's domain: 302 to the IdP (OIDC authorize / SAML AuthnRequest)
 * with a signed transaction cookie carrying state, PKCE and nonce.
 */
export async function GET(req: NextRequest) {
  const email = (new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  const postLogin = new URL(req.url).searchParams.get("post") ?? "/";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.redirect(new URL("/login?sso=invalid-email", new URL(req.url).origin));
  }

  const connection = await findSsoConnection(email);
  if (!connection) {
    return NextResponse.redirect(new URL("/login?sso=none", new URL(req.url).origin));
  }

  const state = randomBytes(24).toString("base64url");
  const origin = new URL(req.url).origin;

  try {
    if (connection.protocol === "OIDC") {
      if (!connection.issuerUrl || !connection.clientId) {
        return NextResponse.redirect(new URL("/login?sso=misconfigured", new URL(req.url).origin));
      }
      const discovery = await oidcDiscovery(connection.issuerUrl);
      const pkce = pkcePair();
      const nonce = randomBytes(24).toString("base64url");
      const txn = encodeSsoTxn({
        state, connectionId: connection.id, codeVerifier: pkce.verifier, nonce,
        postLogin: postLogin.startsWith("/") ? postLogin : "/",
      });
      const url = buildOidcAuthorizeUrl({
        discovery, clientId: connection.clientId, origin, state, nonce,
        codeChallenge: pkce.challenge, loginHint: email,
      });
      const res = NextResponse.redirect(url);
      res.headers.append("set-cookie", `${SSO_TXN_COOKIE}=${txn}; ${txnCookieAttributes()}`);
      return res;
    }

    if (connection.protocol === "SAML") {
      if (!connection.idpMetadataXml) {
        return NextResponse.redirect(new URL("/login?sso=misconfigured", new URL(req.url).origin));
      }
      const txn = encodeSsoTxn({
        state, connectionId: connection.id,
        postLogin: postLogin.startsWith("/") ? postLogin : "/",
      });
      const url = await buildSamlLoginUrl({
        idpMetadataXml: connection.idpMetadataXml, origin, relayState: state,
      });
      const res = NextResponse.redirect(url);
      res.headers.append("set-cookie", `${SSO_TXN_COOKIE}=${txn}; ${txnCookieAttributes()}`);
      return res;
    }

    return NextResponse.redirect(new URL("/login?sso=unknown-protocol", new URL(req.url).origin));
  } catch (err) {
    console.error("sso/start", err);
    return NextResponse.redirect(new URL("/login?sso=error", new URL(req.url).origin));
  }
}
