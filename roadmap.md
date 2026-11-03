# Docurama migration roadmap

Full platform port from the GitHub repo (Next.js 16 + Prisma) to this TanStack Start app.

## Done
- [x] 1. Copy UI/marketing/portal components, brand assets, i18n messages; install deps
- [x] 2. Design system: Docurama emerald/mint tokens + fonts into styles.css and root
- [x] 3. Compatibility shims: next/link, next/navigation, next/script, crypto; type-only auth/consent stubs
- [x] 4. Demo data layer: src/lib/demo-store.ts + src/lib/client.ts with graceful fallback
- [x] 5. Marketing routes: /, /marketing, /enterprise, /security, /privacy, /terms, /status, /developers, /modeles-de-contrats, /verify
- [x] 6. Portal shell: /login, /documents, /templates, /settings, /welcome, /reset-password
- [x] 7. Admin console: /admin (14 screens)
- [x] 8. Signer flow: /sign/$token, /invite/$token
- [x] 9. Blog/docs structure with representative content
- [x] 10. Verified in browser: home, login → portal, documents, templates, admin, settings, sign demo
- [x] 11. Real database persistence: Prisma client (v6.19.3) + SQLite/PostgreSQL schema with 40+ models
- [x] 12. Server-side API routing: /api/auth/*, /api/documents/*, /api/admin/* wired directly into server.ts
- [x] 13. Persistent session authentication: Scrypt password hashing, session tokens, audit event logging, and database bootstrap seeder

## Deferred / Production Enhancements
- [ ] Connect production SMTP provider (Postmark/SendGrid) for external email dispatch
- [ ] Connect production Stripe webhook secret for live card payments
- [ ] Connect production S3/R2 storage bucket for permanent PDF artifact archiving
