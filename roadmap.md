# Docurama migration roadmap

Full platform port from the GitHub repo (Next.js 16 + Prisma) to this TanStack Start app.
User decision: no Lovable Cloud / no backend — demo data lives in the browser (localStorage), fictional seeded data.

## Done
- [x] 1. Copy UI/marketing/portal components, brand assets, i18n messages; install deps
- [x] 2. Design system: Docurama emerald/mint tokens + fonts into styles.css and root
- [x] 3. Compatibility shims: next/link, next/navigation, next/script, crypto; type-only auth/consent stubs
- [x] 4. Demo data layer: src/lib/demo-store.ts + src/lib/client.ts; global /api fetch interceptor for raw fetches in ported components
- [x] 5. Marketing routes: /, /marketing, /enterprise, /security, /privacy, /terms, /status, /developers, /modeles-de-contrats, /verify
- [x] 6. Portal shell: /login, /documents, /templates, /settings, /welcome, /reset-password
- [x] 7. Admin console: /admin (14 screens)
- [x] 8. Signer flow: /sign/$token, /invite/$token
- [x] 9. Blog/docs structure with representative content (source's 100k generated corpus not ported)
- [x] 10. Verified in browser: home, login → portal, documents, templates, admin, settings, sign demo — no console errors

## Deferred (needs a backend decision later)
- [ ] Real persistence, auth, Stripe billing, SMTP email, SSO/SAML, S3 file storage, API keys, cron sweeps
- [ ] Import real records (no data export was attached to the repo)
- [ ] 100k generated blog articles (representative sample ported instead)
