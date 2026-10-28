/** Browser cookie writes must originate from the exact application origin.
 * Protocol callbacks and token-authenticated APIs retain their own validation.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PROTOCOL_ENDPOINTS = new Set([
  "/api/auth/sso/callback/saml",
  "/api/mcp",
  "/api/billing/webhook",
  "/api/attestations",
]);

/** Hosts that are bind addresses only — never valid destinations for emailed
 * links. Next standalone listens on HOSTNAME="0.0.0.0" and synthesizes that
 * value into request.url whenever a request arrives without a Host header. */
const BIND_HOSTS = new Set(["0.0.0.0", "[::]", "::", ""]);

/** Canonical public origin. When DOCURAMA_PUBLIC_ORIGIN is set and well-formed
 * it wins over request-derived authority, so emailed links never depend on the
 * inbound Host header surviving the TLS proxy. */
export function canonicalApplicationOrigin(): string | null {
  const raw = process.env.DOCURAMA_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("shape");
    return url.origin;
  } catch {
    console.warn("[origin] DOCURAMA_PUBLIC_ORIGIN is set but not a bare http(s) origin; ignoring it");
    return null;
  }
}

/** Resolve the application's inbound authority without trusting a caller's
 * Origin. The edge must preserve Host and replace forwarded protocol headers. */
export function requestApplicationOrigin(request: Request): string {
  const canonical = canonicalApplicationOrigin();
  if (canonical) return canonical;
  const target = new URL(request.url);
  const host = request.headers.get("host");
  if (host) {
    const authority = new URL(`${target.protocol}//${host}`);
    if (authority.username || authority.password || authority.pathname !== "/" || authority.search || authority.hash || authority.host.toLowerCase() !== host.toLowerCase()) throw new Error("Invalid application authority");
    target.host = authority.host;
  }
  // A bind address (no Host header reached us and Next synthesized its listen
  // address) must never become a link origin — fail closed instead.
  if (BIND_HOSTS.has(target.hostname)) throw new Error("Invalid application authority");
  const protocol = request.headers.get("x-forwarded-proto");
  if (protocol === "https" || protocol === "http") target.protocol = `${protocol}:`;
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid application protocol");
  return target.origin;
}

export function browserMutationAllowed(request: Request): boolean {
  const target = new URL(request.url);
  // Legacy analysis GET computes and persists OCR metadata. Treat that
  // operation as effectful until the endpoint separates reads from work.
  const analysisGet = ["GET", "HEAD"].includes(request.method.toUpperCase()) && /^\/api\/workspace\/documents\/[^/]+\/analysis\/?$/.test(target.pathname);
  if (SAFE_METHODS.has(request.method.toUpperCase()) && !analysisGet) return true;
  if (!target.pathname.startsWith("/api/")) return true;
  if (PROTOCOL_ENDPOINTS.has(target.pathname) || target.pathname === "/api/v1" || target.pathname.startsWith("/api/v1/")) return true;

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin) {
    // Non-browser clients do not send Origin/Fetch Metadata. A browser's
    // explicit cross-site or sibling-origin request cannot use that path.
    return site !== "cross-site" && site !== "same-site";
  }
  if (origin === "null") return false;
  // Next may normalize a loopback request URL to localhost. The inbound
  // authority is the browser's actual target; never derive it from Origin.
  const host = request.headers.get("host");
  if (host) {
    try {
      const authority = new URL(`${target.protocol}//${host}`);
      if (authority.username || authority.password || authority.pathname !== "/" || authority.search || authority.hash || authority.host.toLowerCase() !== host.toLowerCase()) return false;
      target.host = authority.host;
    } catch { return false; }
  }
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (forwardedProtocol === "https" || forwardedProtocol === "http") target.protocol = `${forwardedProtocol}:`;
  try {
    const supplied = new URL(origin);
    return supplied.origin === origin && supplied.origin === target.origin;
  } catch {
    return false;
  }
}
