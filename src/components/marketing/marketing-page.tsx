"use client";

/**
 * docurama.eu public marketing landing page.
 *
 * Served at `/` for unauthenticated visitors on the marketing domain (and at
 * `/marketing` for an always-available preview). The application itself lives
 * at app.docurama.eu. Sign in points to /login, the primary CTA to /welcome.
 *
 * Design rules applied (taste-skill): no em-dashes anywhere, one accent
 * (emerald), one signup CTA label across the page, live product demos only
 * (the hero movie, the bento table and verify demos, and the tabbed live
 * examples), asymmetric hero, bento grid with exact cell count and rhythm,
 * no "Step N" labels, eyebrows rationed to two, middle dots rationed,
 * honest copy ("aligned", never "certified"). The developer section lives
 * on its own /developers page.
 */

import { useState } from "react";
import {
  ArrowRight, BadgeCheck, BellRing, FileSignature, FileCheck2, Fingerprint,
  Lock, Menu, X, PenTool, ScrollText, ShieldCheck, Timer, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo, BRAND_LEGAL_NAME, BRAND_ADDRESS } from "@/components/brand/logo";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { TableDemo } from "@/components/marketing/table-demo";
import { VerifyDemo } from "@/components/marketing/verify-demo";
import { LiveExamples } from "@/components/marketing/live-examples";
import { ScrollTop } from "@/components/marketing/scroll-top";
import { CookieNotice } from "@/components/marketing/cookie-notice";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PLAN_DEFS, BILLING_PERIODS, monthlyEffectiveEur, periodDaysLabel } from "@/lib/billing";

const NAV = [
  { href: "#product", labelKey: "nav.product", fallback: "Product" },
  { href: "#examples", labelKey: "nav.examples", fallback: "Examples" },
  { href: "#compliance", labelKey: "nav.compliance", fallback: "Compliance" },
  { href: "#pricing", labelKey: "nav.pricing", fallback: "Pricing" },
  { href: "/docs", labelKey: "nav.docs", fallback: "Docs" },
  { href: "/developers", labelKey: "nav.developers", fallback: "Developers" },
  { href: "#faq", labelKey: "nav.faq", fallback: "FAQ" },
];

/** The bento: three feature cells plus two live product demos. */
const BENTO_FEATURES = [
  {
    icon: FileSignature,
    title: "Send and eSign",
    body: "Multi-signer envelopes with routing order, carbon copies and reminders. Signers never need an account.",
  },
  {
    icon: Fingerprint,
    title: "Certificates and sealing",
    body: "One-click RSA-2048 signing certificates per workspace. Seal with PAdES conformance from B-B to B-LTA.",
  },
  {
    icon: Timer,
    title: "RFC 3161 timestamps",
    body: "Every signature anchored to an independent Timestamp Authority. Presets for DigiCert, Sectigo, GlobalSign, or your own TSA.",
  },
];

/** Capabilities listed below the bento as a quiet two-column cluster. */
const ALSO_INCLUDED = [
  { icon: BellRing, title: "Smart reminders", body: "Manual nudges, per-envelope jobs or platform schedules with quiet hours and SMS escalation." },
  { icon: MessageSquare, title: "SMS and WhatsApp alerts", body: "Fourteen researched providers, from WhatsApp Cloud API's free tier to EU-hosted gateways." },
  {
    icon: ScrollText,
    title: "Templates & Legal Contracts",
    body: "Turn repeatedly signed documents into templates, or start instantly from our statutory French legal contracts.",
    href: "/modeles-de-contrats",
    linkText: "Explore French legal templates →",
  },
  { icon: BadgeCheck, title: "Sending domains", body: "Send from your own domain after live DNS verification over DNS-over-HTTPS." },
];

const COMPLIANCE = [
  {
    icon: ShieldCheck,
    tag: "GDPR",
    title: "European by design",
    points: [
      "EU data residency. Documents are processed and stored in the European Union.",
      "DSAR intake with access, erasure, rectification and portability workflows.",
      "Versioned consent records captured at signup (Art. 7 proof).",
      "DPO reachable at privacy@docurama.eu within statutory deadlines.",
    ],
  },
  {
    icon: FileCheck2,
    tag: "eIDAS",
    title: "Signature levels that mean something",
    points: [
      "Simple, Advanced and Qualified-aligned signing workflows.",
      "Cryptographic sealing with PAdES conformance levels (B-B to B-LTA).",
      "Per-tenant signing certificates with revocation and thumbprints.",
      "Honest conformance reporting. The level shown is the level applied.",
    ],
  },
  {
    icon: Lock,
    tag: "21 CFR Part 11",
    title: "Controls for regulated teams",
    points: [
      "§11.50 signature manifestation: printed name, date and meaning on every signature.",
      "§11.100 identity and consent records, versioned and audit-logged.",
      "Optional re-authentication before each signing action.",
      "Organization-wide Part 11 mode with policy enforcement.",
    ],
  },
];

// Plans come from src/lib/billing.ts — the same single source of truth the
// signup API, quota engine and admin console read. No price drift possible.
const PLANS = PLAN_DEFS;

// Honest differentiators — every line maps to a shipped capability.
const DIFFERENTIATORS = [
  {
    title: "35-day billing months",
    body: "Solo and Starter run on 35-day months: the weekends are on us. You get five extra free days of envelope allowance every single cycle — we have never seen another platform do this.",
  },
  {
    title: "Unused envelopes roll over",
    body: "Envelopes you paid for and did not send carry into your next period, capped at one full period's allowance. Your budget never evaporates at midnight on the last day of the month.",
  },
  {
    title: "No engagement, ever",
    body: "Monthly is the default, cancel anytime, no sales call to do it. Prepay 3, 6 or 12 months only if you want up to 15% off — savings are a choice, not a lock-in.",
  },
  {
    title: "Proof anyone can check",
    body: "Every sealed envelope gets a public verification code, a transparency-log entry with offline-verifiable inclusion proofs, and a full evidence pack you can export and keep.",
  },
  {
    title: "EU-built, EU-hosted",
    body: "A French company, EU data residency, no transatlantic document transfers. eIDAS-aligned conformance levels (B-B to B-LTA) reported honestly on every document.",
  },
  {
    title: "An API your AI agent can use",
    body: "REST API, signed webhooks and an MCP server — your workflows and your AI agents send envelopes without a human in the loop. Included from Smart Team up.",
  },
];

// Honest comparison — the legacy column describes patterns common to
// traditional e-signature platforms, without naming or inventing specifics.
const COMPARE: [string, string, string][] = [
  ["Billing month", "Calendar month — pay for 30 days", "35-day months on entry plans, weekends included"],
  ["Unused envelopes", "Typically lost at month end", "Roll over, capped at a full period's allowance"],
  ["Commitment", "Annual contracts commonly pushed at checkout", "Monthly by default, cancel anytime, prepay optional"],
  ["Document verification", "Often gated or behind the sender's account", "Free public portal with cryptographic inclusion proofs"],
  ["Evidence export", "A basic audit PDF", "Evidence packs + self-hosted attestation you can verify offline"],
  ["AI integration", "Rarely available", "MCP server plus REST API and webhooks from Smart Team"],
  ["Getting started", "Sales-assisted in many cases", "Self-serve to 50 seats; guided onboarding with a live demo"],
];

const FAQS = [
  {
    q: "Is Docurama an EU company, and where is my data?",
    a: "Docurama SAS is registered at 1 Rue Marguerin, 75014 Paris, France. Customer data is processed and stored in the European Union, with no transatlantic transfers of your documents.",
  },
  {
    q: "Are the signatures legally valid?",
    a: "Docurama implements eIDAS-aligned electronic signature workflows (Simple, Advanced, Qualified-aligned) with cryptographic sealing and RFC 3161 timestamps. For most B2B contracts across the EU, Simple and Advanced eSignatures are sufficient and fully enforceable. The signing level applied to each document is reported honestly in its evidence record.",
  },
  {
    q: "We're a regulated company. Can you support 21 CFR Part 11?",
    a: "Yes. Organizations can enable Part 11 mode, which enforces signature manifestation under §11.50 (printed name, date/time and meaning of signature), versioned signer-consent records under §11.100, optional re-authentication before signing, and audit events on every mutation.",
  },
  {
    q: "Can we send from our own domain?",
    a: "Yes. Add your domain in Settings, then Account, and Docurama verifies it over live DNS (TXT) before any mail is sent from it, protecting both deliverability and your brand.",
  },
  {
    q: "Is there an API?",
    a: "Smart Team, Business and Enterprise plans include a REST API with X-API-Key authentication, envelope and template endpoints, a public verification endpoint and signed webhooks. An MCP server is also available for AI-agent integrations. See the API documentation at docs.docurama.eu.",
  },
  {
    q: "How do we exercise GDPR rights?",
    a: "Write to privacy@docurama.eu or use the DSAR tooling available to workspace administrators. Access, erasure, rectification and portability requests are tracked with statutory due dates and completion records.",
  },
  {
    q: "What is the difference between Solo and Starter?",
    a: "The allowance is identical — 50 envelopes per 35-day month, every core feature, rollover included. Solo has one seat at €12/month; Starter has three seats at €19/month. You are paying for colleagues, not for a bigger limit you might not use.",
  },
  {
    q: "Why do Solo and Starter use 35-day months?",
    a: "Every monthly cycle on our entry plans includes the weekends, on us: you get 35 days of envelope allowance instead of a calendar month's 30. Unused envelopes also roll into your next period (capped at one full period's allowance), so a quiet month is never a wasted month.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Monthly billing is the default and there is no engagement — cancel whenever you want from Settings. If you choose a 3, 6 or 12-month prepaid period for the discount, you can still cancel before it renews.",
  },
  {
    q: "What does Custom pricing mean for Enterprise?",
    a: "Seats, envelope volume, price and terms are negotiated per deal — there is no fixed public number. Tell us what you need on the Enterprise page and we come back with a concrete proposal covering SSO, bring-your-own certificates, retention policies and legal hold.",
  },
];

export function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Billing period shown on the pricing cards. Monthly (no engagement) is the
  // default; prepay options reveal the 3/6/12-month discounts.
  const [billingMonths, setBillingMonths] = useState(1);
  const { t, locale } = useI18n();

  return (
    <div className="min-h-screen bg-background">
      {/* Structured data: Organization + Product offers + FAQ. Static JSON,
          no scripts, no third parties. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "@id": "https://docurama.eu/#org",
                name: "Docurama",
                legalName: "Docurama SAS",
                url: "https://docurama.eu",
                email: "support@docurama.eu",
                address: {
                  "@type": "PostalAddress",
                  streetAddress: "1 Rue Marguerin",
                  addressLocality: "Paris",
                  postalCode: "75014",
                  addressCountry: "FR",
                },
              },
              {
                "@type": "SoftwareApplication",
                name: "Docurama eSignature",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                description:
                  "EU-built electronic signatures with cryptographic evidence: PAdES sealing, RFC 3161 timestamps, public verification and audit trails.",
                offers: PLAN_DEFS.filter((p) => !p.customPricing).map((p) => ({
                  "@type": "Offer",
                  name: p.name,
                  price: p.monthlyEur,
                  priceCurrency: "EUR",
                  description: `${p.seatLimit} seat(s), ${p.envelopeLimit} envelopes per ${p.periodDays === 30 ? "month" : `${p.periodDays}-day month`}`,
                })),
              },
              {
                "@type": "FAQPage",
                mainEntity: FAQS.map((f) => ({
                  "@type": "Question",
                  name: f.q,
                  acceptedAnswer: { "@type": "Answer", text: f.a },
                })),
              },
            ],
          }),
        }}
      />
      {/* Nav: one line, 64px, light */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label="Main">
          <a href="#top" className="flex items-center gap-2" aria-label="Docurama home">
            <BrandLogo tagline size="sm" />
          </a>
          <div className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {t(n.labelKey, n.fallback)}
              </a>
            ))}
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" onClick={() => { window.location.assign("/login"); }}>
              {t("nav.signIn", "Sign in")}
            </Button>
            <Button size="sm" onClick={() => { window.location.assign("/welcome"); }}>
              {t("nav.startTrial", "Start free trial")}
            </Button>
          </div>
          <button
            type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border md:hidden"
            aria-expanded={menuOpen} aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </nav>
        {menuOpen && (
          <div className="space-y-1 border-t bg-background p-4 md:hidden">
            <div className="flex justify-end pb-2 border-b">
              <LanguageSwitcher />
            </div>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted">
                {t(n.labelKey, n.fallback)}
              </a>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { window.location.assign("/login"); }}>
                {t("nav.signIn", "Sign in")}
              </Button>
              <Button className="flex-1" onClick={() => { window.location.assign("/welcome"); }}>
                {t("nav.startTrial", "Start free trial")}
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Hero: centered statement over the live product movie */}
      <section id="top" className="relative overflow-hidden border-b">
        {/* Hike-style layered contour background: one inline SVG, ~600 bytes,
            single accent, opacity low enough to stay behind the content.
            Decorative only — hidden from AT, untouchable by pointer. */}
        <svg
          aria-hidden
          focusable="false"
          viewBox="0 0 1200 320"
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ opacity: 0.05 }}
        >
          <path d="M-40 260 C 180 190, 260 240, 420 180 S 700 90, 880 170 S 1120 250, 1260 190" fill="none" stroke="#0f7a5a" strokeWidth="1.5" />
          <path d="M-40 220 C 160 150, 300 200, 460 140 S 720 50, 900 130 S 1140 210, 1260 150" fill="none" stroke="#0f7a5a" strokeWidth="1.25" />
          <path d="M-40 180 C 150 110, 320 160, 480 100 S 740 10, 920 90 S 1160 170, 1260 110" fill="none" stroke="#0f7a5a" strokeWidth="1" />
          <path d="M-40 300 C 200 230, 280 280, 440 220 S 720 130, 900 210 S 1140 290, 1260 230" fill="none" stroke="#1a1a1a" strokeWidth="1" />
          <circle cx="420" cy="180" r="2.5" fill="#0f7a5a" />
          <circle cx="880" cy="170" r="2.5" fill="#0f7a5a" />
          <circle cx="480" cy="100" r="2" fill="#1a1a1a" />
        </svg>
        <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="text-center">
            <h1 className="hero-in mx-auto max-w-3xl text-4xl font-semibold leading-[1.06] tracking-tighter sm:text-5xl lg:text-6xl">
              {locale === "fr" ? (
                <>
                  Signez vos documents.<br />
                  <span className="text-primary">Prouvez l'essentiel.</span>
                </>
              ) : (
                <>
                  Sign documents.<br />
                  <span className="text-primary">Prove everything.</span>
                </>
              )}
            </h1>
            <p className="hero-in mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={{ animationDelay: ".08s" }}>
              {t("hero.subtitle", "EU-built eSignatures with cryptographic evidence: X.509 sealing, RFC 3161 timestamps and an audit trail built for review.")}
            </p>
            <div className="hero-in mt-7 flex flex-wrap justify-center gap-3" style={{ animationDelay: ".16s" }}>
              <Button size="lg" onClick={() => { window.location.assign("/welcome"); }}>
                {t("hero.startFree", "Start free trial")} <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="lg" variant="outline" onClick={() => { window.location.assign("/verify"); }}>
                {t("hero.verifyDoc", "Verify a document")}
              </Button>
            </div>
          </div>
          <figure className="relative mt-8 sm:mt-10 w-full">
            <div aria-hidden className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 rounded-[32px]" style={{ background: "radial-gradient(60% 55% at 50% 30%, rgba(15,122,90,.06), transparent 70%)" }} />
            <div className="relative w-full">
              <HeroDemo />
            </div>
            <figcaption className="mx-auto mt-4 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
              {t("hero.caption", "The StålFe demo workspace replayed end to end: a mill certificate goes to the foundry, is signed, sealed and proven with cryptographic evidence.")}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Trust strip: quiet, under the hero */}
      <section aria-label="Trust summary" className="border-b bg-muted/40">
        <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs leading-relaxed text-muted-foreground sm:px-6">
          {t("trust.summary", "EU data residency. GDPR, eIDAS-aligned and 21 CFR Part 11 workflows. Public status at status.docurama.eu, platform security at security.docurama.eu.")}
        </p>
      </section>

      {/* Product bento: 2 live demos + 3 feature cells, asymmetric */}
      <section id="product" className="reveal border-b">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            A complete evidence pipeline, not just a signature in a corner
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            From the first invitation email to the sealed archive, every step is
            recorded, hashed and reportable.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            {/* Documents table: live demo, large cell, spans two rows */}
            <figure className="md:col-span-2 lg:col-span-4 lg:row-span-2">
              <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
                <div className="min-h-0 flex-1 border-b">
                  <TableDemo />
                </div>
                <figcaption className="px-5 py-4 text-xs leading-relaxed text-muted-foreground">
                  Signer progress, status and the evidence digest for every
                  envelope in the workspace, replayed live.
                </figcaption>
              </div>
            </figure>

            {BENTO_FEATURES.slice(0, 2).map((f) => (
              <div key={f.title} className="rounded-xl border bg-card p-5 lg:col-span-2">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <f.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}

            {/* Timestamps feature cell */}
            <div className="rounded-xl border bg-primary-soft/30 p-5 md:col-span-2 lg:col-span-2">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-card text-primary">
                <Timer className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="text-sm font-semibold">{BENTO_FEATURES[2].title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{BENTO_FEATURES[2].body}</p>
            </div>

            {/* Public verify portal: live demo, wide cell to close the grid */}
            <figure className="md:col-span-2 lg:col-span-4">
              <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
                <div className="min-h-0 flex-1 border-b">
                  <VerifyDemo />
                </div>
                <figcaption className="px-5 py-4 text-xs leading-relaxed text-muted-foreground">
                  Anyone can check a completed document's code on the public
                  portal. Proof without exposing the file.
                </figcaption>
              </div>
            </figure>
          </div>

          {/* Also included: quiet two-column cluster, no card chrome */}
          <div className="mt-12 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {ALSO_INCLUDED.map((f) => (
              <div key={f.title} className="flex gap-3.5">
                <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                  {"href" in f && f.href && (
                    <a
                      href={f.href}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      {("linkText" in f && f.linkText) || "Learn more →"}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live examples: one product flow per document type */}
      <LiveExamples />

      {/* Compliance: three framework rows, tag and title left, points right */}
      <section id="compliance" className="reveal border-b bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Compliance</p>
          <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Evidence you can show an auditor
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Three frameworks, each backed by real mechanisms in the product
            rather than badges on a page.
          </p>

          <div className="mt-14 space-y-16">
            {COMPLIANCE.map((c) => (
              <div key={c.tag} className="grid gap-6 lg:grid-cols-12 lg:gap-12">
                <div className="lg:col-span-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <c.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="mt-4 inline-block rounded-md border bg-card px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-muted-foreground">
                    {c.tag}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold tracking-tight">{c.title}</h3>
                </div>
                <ul className="grid gap-x-10 gap-y-4 self-center sm:grid-cols-2 lg:col-span-8">
                  {c.points.map((p) => (
                    <li key={p} className="text-sm leading-relaxed text-muted-foreground">{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works: asymmetric 1 + 2, verb labels only */}
      <section className="reveal border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Three moves to a sealed contract
          </h2>
          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <div className="space-y-4 rounded-xl border bg-card p-6 sm:p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <PenTool className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="text-lg font-semibold tracking-tight">Prepare and send</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Upload your document, drop in signers, set routing and
                reminders. Invitations go out from notifications@docurama.eu
                or your own verified domain.
              </p>
            </div>
            <div className="grid gap-6">
              <div className="space-y-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <FileSignature className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-lg font-semibold tracking-tight">Sign anywhere</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Signers draw, type or upload a signature on any device.
                  Identity is captured, consent is versioned, and every action
                  lands in the event ledger.
                </p>
              </div>
              <div className="space-y-3 border-t pt-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <BadgeCheck className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-lg font-semibold tracking-tight">Seal and prove</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  On completion the document is sealed with your certificate,
                  timestamped via RFC 3161, and gets a public verification code
                  anyone can check.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="reveal border-b bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Simple, EU-priced plans
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Every plan starts with a {`14-day`} trial on your chosen plan's real limits,
            no credit card required. Prices exclude VAT.
          </p>

          {/* Billing period selector: monthly is the no-engagement default. */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="Billing period" className="inline-flex rounded-lg border bg-card p-1">
              {BILLING_PERIODS.map((bp) => (
                <button
                  key={bp.months}
                  type="button"
                  onClick={() => setBillingMonths(bp.months)}
                  aria-pressed={billingMonths === bp.months}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    billingMonths === bp.months
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {bp.label}
                  {bp.discountPct > 0 && <span aria-hidden> ·−{bp.discountPct}%</span>}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {billingMonths === 1
                ? "No engagement — pay monthly, cancel anytime, unused envelopes roll over."
                : `Prepay ${billingMonths} months and save ${BILLING_PERIODS.find((b) => b.months === billingMonths)?.discountPct}% on every month. Cancel whenever it renews.`}
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PLANS.map((p) => {
              const effective = p.customPricing
                ? null
                : monthlyEffectiveEur(p.monthlyEur, billingMonths);
              return (
                <div key={p.code} className={cn(
                  "relative flex flex-col rounded-xl border bg-card p-5",
                  p.code === "STARTER" && "border-primary/40",
                )}>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{p.name}</h3>
                  <p className="mt-2 flex items-baseline gap-1">
                    {p.customPricing ? (
                      <span className="text-2xl font-semibold tracking-tight">Custom</span>
                    ) : (
                      <>
                        <span className="text-2xl font-semibold tracking-tight">€{effective}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {p.customPricing ? "Negotiated seats, volume and price" : periodDaysLabel(p.periodDays)}
                  </p>
                  <p className="mt-2 text-xs font-medium">{p.blurb}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{p.outcome}</p>
                  <ul className="mt-4 flex-1 space-y-2">
                    {p.features.slice(0, 6).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[11px] leading-relaxed">
                        <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-5 w-full" size="sm" variant={p.selfServe ? "outline" : "default"}
                    onClick={() => {
                      window.location.assign(p.selfServe ? `/welcome?plan=${p.code}&months=${billingMonths}` : "/enterprise");
                    }}>
                    {p.selfServe ? "Start free trial" : "Talk to sales"}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Solo and Starter include the same allowance</span>{" "}
            — 50 envelopes on 35-day months, every core feature. The only difference is
            seats: one for Solo, three for Starter. Need more volume and an API? That is
            what Smart Team and Business are for.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Need on-premises deployment or self-hosting?{" "}
            <a className="font-medium underline underline-offset-2" href="/enterprise">Tell us what you are planning</a>.
          </p>
        </div>
      </section>

      {/* Why Docurama: differentiators grounded in shipped capabilities */}
      <section id="why" className="reveal border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            What you will not get elsewhere
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Not features on a roadmap — capabilities shipping today, and the
            reasons teams keep their signatures here.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="rounded-xl border bg-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BadgeCheck className="h-4 w-4 text-primary" aria-hidden />
                  {d.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honest comparison table */}
      <section id="compare" className="reveal border-b bg-muted/40">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How Docurama compares
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Typical patterns of legacy e-signature platforms versus what we do
            differently. No invented competitor numbers — just our guarantees.
          </p>
          <div className="mt-8 overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Legacy e-signature platforms compared with Docurama</caption>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th scope="col" className="px-4 py-3 font-semibold">Dimension</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Legacy platforms</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-primary">Docurama</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([dim, legacy, ours]) => (
                  <tr key={dim} className="border-b last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">{dim}</th>
                    <td className="px-4 py-3 text-muted-foreground">{legacy}</td>
                    <td className="px-4 py-3 font-medium">{ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="reveal border-b bg-muted/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Frequently asked</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-xl border bg-card px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                  {f.q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA: left-aligned */}
      <section className="reveal border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <div>
            <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Your next contract deserves better than a scanned PDF
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Set up a compliant eSignature workspace in about two minutes.
              Free for 14 days, no credit card required.
            </p>
          </div>
          <div className="shrink-0">
            <Button size="lg" onClick={() => { window.location.assign("/welcome"); }}>
              Start free trial <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <BrandLogo tagline size="sm" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {BRAND_LEGAL_NAME}<br />{BRAND_ADDRESS}<br />EU data residency. Paris, France.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Product</p>
            <ul className="space-y-2.5 text-sm">
              {[["Features", "#product"], ["Live examples", "#examples"], ["Compliance", "#compliance"], ["Pricing", "#pricing"], ["Why Docurama", "#why"], ["Compare", "#compare"], ["Contract templates", "/modeles-de-contrats"], ["Developers", "/developers"], ["Verify a document", "/verify"], ["Documentation", "/docs"], ["Enterprise", "/enterprise"], ["Create account", "/welcome"]].map(([l, h]) => (
                <li key={l}><a className="text-muted-foreground transition-colors hover:text-foreground" href={h}>{l}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Contact">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contact</p>
            <ul className="space-y-2.5 text-sm">
              {[["Support", "support@docurama.eu"], ["Sales and enterprise", "sales@docurama.eu"], ["Billing", "billing@docurama.eu"], ["Privacy and DPO", "privacy@docurama.eu"], ["Legal", "legal@docurama.eu"], ["Security disclosure", "security@docurama.eu"], ["Abuse report", "abuse@docurama.eu"], ["Postmaster", "postmaster@docurama.eu"]].map(([l, m]) => (
                <li key={m}><a className="text-muted-foreground transition-colors hover:text-foreground" href={`mailto:${m}`}>{l}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Legal and trust">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Legal and trust</p>
            <ul className="space-y-2.5 text-sm">
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/docs#legal">Terms of Service</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/docs#legal">Privacy Policy</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/docs#legal">Data Processing Agreement</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/docs#legal">Subprocessor list</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/modeles-de-contrats">French legal templates</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/security">Security policy</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/status">Platform status</a></li>
              <li><a className="text-muted-foreground transition-colors hover:text-foreground" href="/.well-known/security.txt">security.txt</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t">
          <p className="mx-auto max-w-6xl px-4 py-5 text-[11px] leading-relaxed text-muted-foreground sm:px-6">
            © 2026 {BRAND_LEGAL_NAME}, {BRAND_ADDRESS}. All transactional mail
            is sent from notifications@docurama.eu. Docurama implements
            GDPR-, eIDAS- and 21 CFR Part 11-aligned workflows; it is not an
            accredited Qualified Trust Service Provider. For QES, pair
            Docurama with an EU QTSP.
          </p>
        </div>
      </footer>

      <ScrollTop />
      <CookieNotice />
    </div>
  );
}
