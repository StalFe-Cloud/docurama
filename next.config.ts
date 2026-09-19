import type { NextConfig } from "next";

/**
 * Security headers applied to every response. The CSP is deliberately scoped
 * to directives that cannot break Next.js hydration (frame-ancestors,
 * object-src, base-uri); a nonce-based script policy is the follow-up once a
 * proxy terminates TLS and can inject per-request nonces.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@napi-rs/canvas", "sharp", "tesseract.js", "pdfjs-dist"],
  // F3 (docs/IMPROVEMENT-PLAN.md): type errors fail the build again.
  // Kept clean via `bunx tsc --noEmit`, enforced in CI (.github/workflows/e2e.yml).
  reactStrictMode: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The signer portal embeds the token-authenticated PDF review endpoint
      // in a same-origin iframe. The catch-all above would frame-block it
      // (XFO DENY + frame-ancestors 'none' apply to the FRAMED resource),
      // so this rule relaxes exactly that one path to SAMEORIGIN — every
      // other response keeps the strictest framing policy.
      {
        source: "/api/sign/:token/document",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/sign_up", destination: "/login", permanent: false },
      { source: "/signup", destination: "/login", permanent: false },
      // NOTE: the old "/sign -> /documents" vanity redirect was removed —
      // /sign is now the public signer portal (/sign/{token}).
    ];
  },
};

export default nextConfig;
