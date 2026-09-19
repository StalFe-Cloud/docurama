/**
 * Billing domain — the single source of truth for plans, prices and billing
 * periods. The database `Plan` rows are seeded from these definitions and the
 * quota engine (`src/lib/quota.ts`) enforces what the active subscription
 * negotiated. Marketing, admin, the welcome wizard and the signup API all
 * read from here so a plan change is a one-file change.
 *
 * Pricing strategy (2026 revision):
 * - SOLO and STARTER are clearly differentiated (price, seats AND envelopes)
 *   while keeping every competitive feature: 35-day billing months ("weekends
 *   on us"), unused-envelope rollover, no engagement, cancel anytime.
 * - SMART TEAM (previously "Business") is the 10-seat API tier.
 * - BUSINESS is the new 50-seat tier with 1,000 envelopes per month.
 * - ENTERPRISE is custom-priced; seats, envelopes and price are negotiated
 *   per deal (Subscription overrides) — never a public number.
 */

export type PlanCode = "SOLO" | "STARTER" | "SMART_TEAM" | "BUSINESS" | "ENTERPRISE";

export interface PlanDef {
  code: PlanCode;
  name: string;
  /** Monthly list price in EUR. Ignored when customPricing is true. */
  monthlyEur: number;
  seatLimit: number;
  envelopeLimit: number;
  storageGb: number;
  apiAccess: boolean;
  /** Length of one billing month in days. 35 on entry plans: weekends on us. */
  periodDays: number;
  slaUptime: string;
  support: string;
  /** Pipe-separated feature strings shown in cards and admin. */
  features: string[];
  /** Value-first copy (no "most popular" badges — each plan states its job). */
  blurb: string;
  outcome: string;
  helps: string;
  /** Self-serve checkout possible (ENTERPRISE goes through /enterprise). */
  selfServe: boolean;
  /** Price is negotiated per deal — render "Custom" everywhere. */
  customPricing: boolean;
}

export const PLAN_DEFS: PlanDef[] = [
  {
    code: "SOLO",
    name: "Solo",
    monthlyEur: 9,
    seatLimit: 1,
    envelopeLimit: 50,
    storageGb: 5,
    apiAccess: false,
    periodDays: 35,
    slaUptime: "99.5%",
    support: "Email support",
    features: [
      "1 seat", "50 envelopes per 35-day month", "PAdES B-B sealing",
      "Email signing and public verify portal", "2 templates", "Unused envelopes roll over",
    ],
    blurb: "One person, every document, no friction.",
    outcome: "Send your first envelope in under five minutes.",
    helps: "Independent professionals who sign contracts weekly and want EU-grade evidence without a team tool.",
    selfServe: true,
    customPricing: false,
  },
  {
    code: "STARTER",
    name: "Starter",
    monthlyEur: 19,
    seatLimit: 3,
    envelopeLimit: 100,
    storageGb: 5,
    apiAccess: false,
    periodDays: 35,
    slaUptime: "99.5%",
    support: "Email support",
    features: [
      "3 seats", "100 envelopes per 35-day month", "PAdES B-B sealing",
      "Email signing and public verify portal", "2 templates", "Unused envelopes roll over",
    ],
    blurb: "A tiny team's serious signing desk.",
    outcome: "Share the workload across three seats with one shared audit trail.",
    helps: "Small teams (2-3 people) sending tens of envelopes a month who need shared templates and a team inbox for signatures.",
    selfServe: true,
    customPricing: false,
  },
  {
    code: "SMART_TEAM",
    name: "Smart Team",
    monthlyEur: 79,
    seatLimit: 10,
    envelopeLimit: 250,
    storageGb: 50,
    apiAccess: true,
    periodDays: 30,
    slaUptime: "99.9%",
    support: "Priority email support",
    features: [
      "10 seats", "250 envelopes / month", "PAdES B-LT sealing", "SMS + WhatsApp delivery",
      "API access and webhooks", "DNS domain attestation", "Unlimited templates",
      "Unused envelopes roll over",
    ],
    blurb: "Automation for teams that live in documents.",
    outcome: "Wire Docurama into your CRM or product and send from your own domain.",
    helps: "Operations and legal teams up to ten people who need API access, webhooks and verified sender domains.",
    selfServe: true,
    customPricing: false,
  },
  {
    code: "BUSINESS",
    name: "Business",
    monthlyEur: 249,
    seatLimit: 50,
    envelopeLimit: 1000,
    storageGb: 200,
    apiAccess: true,
    periodDays: 30,
    slaUptime: "99.9%",
    support: "Priority support + onboarding session",
    features: [
      "50 seats", "1,000 envelopes / month", "PAdES B-LT sealing", "SMS + WhatsApp delivery",
      "API access and webhooks", "DNS domain attestation", "Unlimited templates",
      "Teams within your workspace", "Unused envelopes roll over",
    ],
    blurb: "A department-wide signing operation.",
    outcome: "Organize 50 people into teams with per-group envelope views.",
    helps: "Larger organizations that route contracts through several departments and need volume plus structure.",
    selfServe: true,
    customPricing: false,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    monthlyEur: 0,
    seatLimit: 100,
    envelopeLimit: 5000,
    storageGb: 500,
    apiAccess: true,
    periodDays: 30,
    slaUptime: "99.99%",
    support: "24/7 support + TAM",
    features: [
      "Custom seats and envelope volume", "PAdES B-LTA sealing", "BYO certificates and SSO/SAML",
      "21 CFR Part 11 mode", "Audit chain exports", "Custom retention and legal hold",
      "Dedicated onboarding", "Unused envelopes roll over",
    ],
    blurb: "Regulated teams with audit obligations.",
    outcome: "Negotiated seats, volume and price with SSO and your own certificates.",
    helps: "Regulated companies that need B-LTA conformance, SSO, bring-your-own certificates and legal hold workflows.",
    selfServe: false,
    customPricing: true,
  },
];

// ─── Billing periods ─────────────────────────────────────────────────────────

export interface BillingPeriodDef {
  months: number;
  label: string;
  /** Discount percentage applied to every month of the period. */
  discountPct: number;
  note?: string;
}

/** Prepaid periods are optional savings — never a lock-in requirement. */
export const BILLING_PERIODS: BillingPeriodDef[] = [
  { months: 1, label: "Monthly", discountPct: 0, note: "No engagement — cancel anytime" },
  { months: 3, label: "3 months", discountPct: 5 },
  { months: 6, label: "6 months", discountPct: 10 },
  { months: 12, label: "12 months", discountPct: 15, note: "Best saving" },
];

export const VALID_BILLING_MONTHS = BILLING_PERIODS.map((p) => p.months) as number[];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function planDef(code: string): PlanDef | undefined {
  return PLAN_DEFS.find((p) => p.code === code);
}

export function billingPeriod(months: number): BillingPeriodDef {
  return BILLING_PERIODS.find((p) => p.months === months) ?? BILLING_PERIODS[0];
}

/** Effective monthly price after the period discount (whole EUR). */
export function monthlyEffectiveEur(monthlyEur: number, months: number): number {
  const pct = billingPeriod(months).discountPct;
  return Math.round(monthlyEur * (1 - pct / 100));
}

/** Total charged for one prepaid period (whole EUR). */
export function periodTotalEur(monthlyEur: number, months: number): number {
  return monthlyEffectiveEur(monthlyEur, months) * months;
}

/** What a customer saves over the period versus 12× monthly (whole EUR). */
export function periodSavingsEur(monthlyEur: number, months: number): number {
  return monthlyEur * months - periodTotalEur(monthlyEur, months);
}

/** Length of one billing period in milliseconds, honouring 35-day months. */
export function periodMs(periodDays: number, months: number): number {
  return months * periodDays * 24 * 3600 * 1000;
}

/** Rollover cap: one full period's envelope limit (max allowance = 2× limit). */
export function rolloverCap(envelopeLimit: number): number {
  return envelopeLimit;
}

export function eur(n: number): string {
  return `€${n}`;
}

/** "per 35-day month" vs "per month" — honest about the calendar. */
export function periodDaysLabel(periodDays: number): string {
  return periodDays === 30 ? "per month" : `per ${periodDays}-day month`;
}

/** Plans a visitor can start themselves (used by signup + wizard). */
export const SELF_SERVE_PLANS = PLAN_DEFS.filter((p) => p.selfServe);

/** True when a signup/wizard plan code is acceptable for self-serve checkout. */
export function isSelfServePlan(code: string): boolean {
  const def = planDef(code);
  return Boolean(def?.selfServe);
}

/** Marketing-safe price label: "€19" or "Custom". */
export function priceLabel(def: PlanDef): string {
  return def.customPricing ? "Custom" : eur(def.monthlyEur);
}
