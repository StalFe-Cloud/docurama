# Docurama Multi-Session Worklog

Branch: `feat/pricing-onboarding` (from quality @ 8d8b19c)

## Session 2 (current) — 2026-09-19

**Critical finding**: Session 1's implementation (billing.ts, schema changes, quota.ts)
was LOST — branch feat/pricing-onboarding did not exist, no files on disk. Rebuilding
from scratch with REVISED pricing per user's latest instructions:

- SOLO €9 / 1 seat / 50 envelopes / 35-day month (clear differentiation from Starter)
- STARTER €19 / 3 seats / 100 envelopes / 35-day month
- BUSINESS renamed → "Smart Team" (SMART_TEAM code) €79 / 10 seats / 250 envelopes
- NEW BUSINESS plan €249 / 50 seats / 1000 envelopes
- ENTERPRISE: Custom pricing (customPricing flag), negotiable seats/envelopes/price
  via Subscription overrides set by admin during lead conversion
- Keep all competitive features on basic plans (no stripping)
- Differentiators section + honest compare table on marketing page
- Billing periods 1/3/6/12 months: −5/−10/−15%

---
Task ID: 1
Agent: main
Task: Execute full pending backlog (pricing/onboarding + audit + UI/UX) with revised strategy

Work Log:
- billing.ts (single source): SOLO €9/1/50/35d, STARTER €19/3/100/35d, SMART_TEAM €79/10/250,
  new BUSINESS €249/50/1000, ENTERPRISE customPricing; periods 1/3/6/12 = 5/10/15%
- Schema: Plan.periodDays+customPricing, Subscription billingMonths/discountPct/periodStartedAt/
  overrides+createdAt, Tenant.periodStartedAt+envelopeRollover, Team/TeamMember/EnterpriseLead,
  Envelope.teamId, User.teamMemberships — db push to db/custom.db (NOTE: prisma resolves
  file:./db/custom.db relative to prisma/ → use DATABASE_URL="file:../db/custom.db" for CLI)
- quota.ts: lazy renewal (guard 24), rollover capped at one period limit, seatsUsed = members +
  pending invites, checkEnvelopeQuota (SUSPENDED/402), checkSeatAvailable, checkApiAccess
- seed.ts: plans from PLAN_DEFS, SMART_TEAM migration, SOLO + BUSINESS tenants + users,
  billing months variety, 5 teams + members, 5 enterprise leads — seeded OK
- Signup: planCode+billingMonths → TRIALING subscription; auto-join seat gate; org.create
  in settings now uses PlatformSetting trial length + plan selection + subscription
- Workspace API: quota engine in overview+send (402 with rollover/upgrade copy), teamId
  on send + team in rows/overview, tryDeliverSoon after send
- Settings handlers: seat gate on invite-member, apiAccess gate on create-key, team ops
  (create/rename/delete/member add/remove, BUSINESS+ only)
- Onboarding API: plan.select op (seat-fit guard, window restart, subscription sync);
  invite.send seat gate; onboarding state now carries live quota snapshot
- Marketing: 5 value cards + billing toggle (monthly default "no engagement"), differentiators
  grid (6 grounded claims), honest compare table, Enterprise CTA → /enterprise, FAQ updates
- /enterprise page + form component + POST /api/enterprise (honeypot, rate limit 3/24h, audit)
- Wizard: new "plan" step (switch plans, billing period, per-plan walkthrough; ENTERPRISE
  deployment checklist variant), AccountStep plan picker with ?plan=&months= preselect,
  InvitesStep seat meter
- Admin: leads pipeline (status/notes/convert with negotiated overrides → tenant + owner
  invite), plan editor (/admin/plans), billing columns (period selector, quota+rollover,
  renew-now), tenants plan labels, overview "Launch readiness" checklist (real checks),
  admin-shell nav + portal-root wiring
- SMTP: nodemailer via SMTP_URL (src/lib/mail.ts), queueMail delivers when configured,
  admin test-smtp now sends for real (was fake), mail.flush + mail.requeue ops, .env.example
- docs/STORAGE-OPTIONS.md (SeaweedFS vs MinIO vs Garage)

Stage Summary:
- Core pricing/quota/onboarding/enterprise pipeline complete and typechecking clean.
- Remaining: teams UI in settings, production audit (14 sections), UI/UX sprint, verify+PR.

Task ID: 1 (continued)
Agent: main

Work Log (part 2 — teams UI, audit, UI/UX, verification):
- Teams UI: GroupsCard in settings-users (create/delete/add/remove members, BUSINESS+ gated),
  settings GET payload includes teams with member + envelope counts
- Audit fixes: not-found.tsx + error.tsx + global-error.tsx created (none existed);
  security headers in next.config (HSTS, CSP subset frame-ancestors/object-src/base-uri,
  XFO DENY, nosniff, Referrer-Policy, Permissions-Policy); sitemap +/enterprise;
  JSON-LD (Organization + SoftwareApplication offers + FAQPage) on marketing;
  honest cookie notice (strictly-necessary only, useSyncExternalStore, localStorage);
  compliance wording sweep clean (security page already honest, no fake badges);
  secrets sweep clean (.env gitignored, demo creds build-time gated)
- UI/UX: Hike-style hero contour SVG (inline, ~600B, aria-hidden); StatusBadge motion
  (breathing dot for in-flight states, chip-enter settle, reduced-motion safe);
  audit timeline latest-event pulse for in-flight envelopes
- Seed robustness: strict dependency-order deletes (fixed intermittent P2003),
  4 consecutive idempotent runs verified
- Verification: tsc ✅, eslint ✅, next build ✅ (/enterprise + /api/enterprise built);
  smoke-pricing.sh 23/23; test-quota-engine.ts 4/4 scenarios; test-onboarding-api.sh
  40/40 (updated for seat-aware invites); e2e api/evidence/transparency 39/39;
  Maestro browser flows NOT run (tool unavailable in this environment)
- Committed fc42b47 on feat/pricing-onboarding, pushed, PR #11 → quality:
  https://github.com/StalFe-Cloud/docurama/pull/11

Stage Summary (final):
- ALL implementable pending work executed. External dependencies remaining:
  SMTP_URL credentials (real delivery), payment provider integration
  (checkout is out-of-band), Maestro browser E2E re-run in a capable environment.

---
Task ID: 1 (session 3 — pricing alignment + cleanup)
Agent: main
Task: Align pricing ladder with user's final instructions; clean phantom
working-tree noise; re-verify everything; push to PR #11.

Work Log:
- Restored working tree: 1,405 phantom mode-only changes (644→755, 0 content
  diffs, filesystem artifact) reverted + 4 deleted upload/ assets restored
  via git checkout
- Pricing aligned to user's final ladder (previous session had drifted):
  SOLO €9→€12 (1 seat, 50 env, 35d), STARTER envelopes 100→50 (identical
  allowance to Solo — seats 1 vs 3 is the ONLY difference), BUSINESS
  €249→€199 (50 seats, 1,000 env); SMART_TEAM €79 and ENTERPRISE Custom
  unchanged
- billing.ts header comment documents the seats-only differentiation;
  STARTER blurb "Everything in Solo, plus two more seats", outcome states
  the same-allowance-as-Solo fact
- Marketing: explicit "Solo and Starter include the same allowance" note
  under the pricing grid + new FAQ "What is the difference between Solo and
  Starter?" (also feeds FAQPage JSON-LD)
- admin-tenants plan labels + seed MRR rows corrected; db/custom.db
  reseeded from PLAN_DEFS
- Fixed scripts/test-quota-engine.ts dead line referencing removed
  windowDaysRemainingLabel field (broke tsc --noEmit at repo root)
- Verification: tsc ✅, eslint ✅, next build ✅, quota engine 4/4,
  smoke-pricing 23/23, onboarding API 40/40, e2e api/evidence/transparency
  39/39; live marketing page renders €12/€19/€79/€199/Custom in cards and
  SoftwareApplication JSON-LD offers
- Committed 9a27c18, pushed to PR #11

Stage Summary:
- Pricing ladder now exactly matches the user's final instructions. Repo
  clean, all suites green. Remaining items are external only: SMTP_URL
  credentials, payment provider checkout, Maestro browser E2E in a capable
  environment.
