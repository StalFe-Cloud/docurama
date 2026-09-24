/**
 * Public addresses of this deployment, for links built outside a request
 * (background jobs) and printed on documents.
 */

const root = () => (process.env.ROOT_DOMAIN || "docurama.eu").toLowerCase();

/**
 * Where the app is served: APP_URL, else https://APP_HOST, else the default
 * app host (as in middleware.ts); APP_HOST="off" serves it on ROOT_DOMAIN.
 */
export function appOrigin(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const configured = process.env.APP_HOST?.trim().toLowerCase();
  const host = configured === "off" ? root() : configured || (root() === "docurama.eu" ? "app.docurama.eu" : root());
  return `https://${host}`;
}

/** The public verification page for one envelope (printed with a QR code on sealed PDFs). */
export function publicVerifyUrl(code: string): string {
  const base = (process.env.PUBLIC_VERIFY_URL || `https://verify.${root()}/`).replace(/\/?$/, "/");
  return `${base}?code=${encodeURIComponent(code)}`;
}
