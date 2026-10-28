# Docurama port — roadmap

Full platform port from Next.js repo to this TanStack Start project. No Lovable Cloud (user decision) → client-side demo data layer instead of Prisma/APIs.

- [ ] 1. Design tokens + brand assets + fonts (docurama palette into src/styles.css, public/brand)
- [ ] 2. Copy shadcn UI kit (49 components) + lib/utils, plans, i18n
- [ ] 3. Marketing site routes: /, /enterprise, /security, /privacy, /terms, /status, /developers, /marketing
- [ ] 4. Demo data layer (localStorage): users, envelopes, documents, templates, audit events
- [ ] 5. Auth screens: /login, /reset-password, /welcome (demo sign-in)
- [ ] 6. User portal: /documents, /templates, /settings, /verify + shells
- [ ] 7. Admin console: /admin (14 screens)
- [ ] 8. Signer flow: /sign/$token, /invite/$token
- [ ] 9. Blog/docs structure with representative content
- [ ] 10. Verify build + routes end-to-end; handoff notes (data exports, Stripe/SMTP/SSO deferred)
