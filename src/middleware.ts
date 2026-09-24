import { NextRequest, NextResponse } from "next/server";

/**
 * Host-aware routing for the deployment's sub-domains.
 *
 * The base domain is ROOT_DOMAIN (default: docurama.eu) so self-hosted and
 * white-label deployments get the same vanity-subdomain behaviour without
 * forking the middleware:
 *
 *   status.{root}    any path  → /status          (public status page)
 *   docs.{root}      any path  → /docs            (documentation)
 *   security.{root}  any path  → /security        (security hub)
 *   verify.{root}    /         → /verify          (public verification)
 *   mta-sts.{root}   any path  → /.well-known/mta-sts.txt (RFC 8460)
 *   api.{root}       non-/api  → /api             (API index)
 *   admin.{root}     /         → /admin           (admin console, auth-gated)
 *   mail.{root}      /         → /mail            (mail service page)
 *   app. / staging. / apex / www / localhost: untouched (handled by page.tsx),
 *   except apex sign-in/workspace paths → APP_HOST (see below)
 *
 * Requests to /api/*, /_next/*, static files and well-known paths always
 * pass through so health checks and API clients keep working on every host.
 */

const ROOT_DOMAIN = (process.env.ROOT_DOMAIN || "docurama.eu").toLowerCase();

const SUBDOMAIN_ROUTES: Record<string, string> = {
  "status": "/status",
  "docs": "/docs",
  "security": "/security",
  "mta-sts": "/.well-known/mta-sts.txt",
};

const ROOT_ROUTES: Record<string, string> = {
  "verify": "/verify",
  "mail": "/mail",
  "sign": "/sign",
};

// Sign-in and the workspace live on the app host; the apex serves the
// marketing site. The session cookie is host-only, so signing in on the apex
// would strand the session there — apex requests for these paths are sent to
// the app host instead (query preserved: verification and invite links keep
// working). Default for the Docurama cloud; self-hosters opt in with
// APP_HOST=app.example.com, and APP_HOST=off disables it.
const APP_HOST = (process.env.APP_HOST || (ROOT_DOMAIN === "docurama.eu" ? "app.docurama.eu" : "")).trim().toLowerCase();
const APP_ONLY_PATHS = ["/login", "/welcome", "/reset-password", "/invite", "/settings", "/admin", "/documents", "/templates"];

function isApexHost(host: string): boolean {
  const bare = host.toLowerCase().split(":")[0];
  return bare === ROOT_DOMAIN || bare === `www.${ROOT_DOMAIN}`;
}

function subdomain(host: string): string {
  const bare = host.toLowerCase().split(":")[0];
  if (!bare.endsWith(`.${ROOT_DOMAIN}`)) return "";
  const label = bare.slice(0, -(`.${ROOT_DOMAIN}`).length);
  // apex, www, app, staging and empty are handled elsewhere
  return label;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Vanity / legacy auth redirects so /sign-in and /sign-up never 404
  if (pathname === "/sign-in" || pathname === "/signin") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url, 307);
  }
  if (pathname === "/sign-up" || pathname === "/signup") {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.redirect(url, 307);
  }

  const host = req.headers.get("host") ?? "";
  if (APP_HOST && APP_HOST !== "off" && isApexHost(host) &&
      APP_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.redirect(`https://${APP_HOST}${pathname}${search}`, 308);
  }

  const label = subdomain(host);
  if (!label) return NextResponse.next();

  // Never intercept infrastructure paths on any host.
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/.well-known") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Whole-host surfaces.
  const whole = SUBDOMAIN_ROUTES[label];
  if (whole) {
    const url = req.nextUrl.clone();
    url.search = search;
    if (pathname === "/" || pathname === "") {
      url.pathname = whole;
      return NextResponse.rewrite(url);
    }
    if (pathname === whole || pathname.startsWith(whole + "/")) {
      return NextResponse.next();
    }
    // Deep-link rewrite: e.g. docs.docurama.eu/guide -> /docs/guide
    url.pathname = `${whole}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Root-rewriting hosts: / maps to their surface, other paths pass through.
  const root = ROOT_ROUTES[label];
  if (root && (pathname === "/" || pathname === "")) {
    const url = req.nextUrl.clone();
    url.pathname = root;
    url.search = search;
    return NextResponse.rewrite(url);
  }

  // admin host: redirect / to the admin console so client-side routing
  // sees the real path (the portal derives its section from the URL).
  if (label === "admin" && (pathname === "/" || pathname === "")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }

  // api host: everything that is not /api becomes the API index.
  if (label === "api") {
    const url = req.nextUrl.clone();
    url.pathname = "/api";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
