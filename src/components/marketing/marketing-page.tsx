"use client";

/**
 * docurama.eu — public marketing landing page.
 *
 * Served at `/` for unauthenticated visitors on the marketing domain (and at
 * `/marketing` for an always-available preview). The application itself lives
 * at app.docurama.eu — the Sign in CTA points to /login, Get started → /welcome.
 *
 * Honesty rules for the copy: the platform implements eIDAS-aligned SES/AdES
 * workflows, 21 CFR Part 11 controls (signature manifestation, consent
 * records, re-authentication), RFC 3161 timestamping and GDPR tooling — the
 * copy says "aligned / built for", never "certified".
 */

import { useState } from "react";
import {
  ArrowRight, BadgeCheck, BellRing, Check, FileCheck2, FileSignature, Fingerprint,
  Gauge, KeyRound, Lock, MailCheck, MessageSquare, PenTool, ScrollText, ShieldCheck,
  Sparkles, Terminal, Timer, Users, Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo, BRAND_LEGAL_NAME, BRAND_ADDRESS } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "#product", label: "Product" },
  { href: "#compliance", label: "Compliance" },
  { href: "#pricing", label: "Pricing" },
  { href: "#developers", label: "Developers" },
  { href: "#faq", label: "FAQ" },
];

const FEATURES = [
  {
    icon: FileSignature,
    title: "Send & eSign",
    body: "Prepare envelopes with multiple signers, carbon copies and routing order. Signers work from any device — no account needed on their side.",
  },
  {
    icon: ScrollText,
    title: "Evidence & audit trail",
    body: "Every view, signature, seal and reminder is captured in a per-envelope event ledger with hash digests you can copy into your own records.",
  },
  {
    icon: Fingerprint,
    title: "X.509 certificates & sealing",
    body: "Provision RSA-2048 signing certificates in one click, seal completed documents cryptographically, and download PKCS#12 keystores for archiving.",
  },
  {
    icon: Timer,
    title: "RFC 3161 timestamps",
    body: "Anchor every signature to an independent Timestamp Authority — DigiCert, Sectigo, GlobalSign or your own TSA — with live reachability testing.",
  },
  {
    icon: BellRing,
    title: "Smart reminders",
    body: "Manual nudges, per-envelope jobs or platform-wide schedules with quiet hours, weekend skipping and SMS escalation after repeated silence.",
  },
  {
    icon: MessageSquare,
    title: "SMS & WhatsApp alerts",
    body: "Fourteen researched providers — from WhatsApp Cloud API's free tier to EU-hosted gateways — with a low-cost mode for high-volume sending.",
  },
  {
    icon: Workflow,
    title: "Templates",
    body: "Turn any repeatedly-signed document into a template with usage tracking, categories and folders, ready to launch as a new envelope.",
  },
  {
    icon: BadgeCheck,
    title: "Public verification",
    body: "Anyone can verify a completed document's code and hash on the public portal — proof of signature without exposing the file itself.",
  },
];

const COMPLIANCE = [
  {
    icon: ShieldCheck,
    tag: "GDPR",
    title: "European by design",
    points: [
      "EU data residency — processed and stored in the European Union",
      "DSAR intake with access, erasure, rectification and portability workflows",
      "Versioned consent records captured at signup (Art. 7 proof)",
      "DPO contact: privacy@docurama.eu — responses within statutory deadlines",
    ],
  },
  {
    icon: FileCheck2,
    tag: "eIDAS",
    title: "Signature levels that mean something",
    points: [
      "Simple, Advanced and Qualified-aligned signing workflows",
      "Cryptographic sealing with PAdES conformance levels (B-B → B-LTA)",
      "Per-tenant signing certificates with revocation and thumbprints",
      "Honest conformance reporting — the level shown is the level applied",
    ],
  },
  {
    icon: Lock,
    tag: "21 CFR Part 11",
    title: "Regulated-industry controls",
    points: [
      "§11.50 signature manifestation — printed name, date and meaning on every signature",
      "§11.100 identity & consent records, versioned and audit-logged",
      "Optional re-authentication before each signing action",
      "Organization-wide Part 11 mode toggle with policy enforcement",
    ],
  },
];

const PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    price: "€19",
    per: "/mo",
    blurb: "For small teams sending their first envelopes.",
    cta: "Start 14-day trial",
    features: ["3 seats", "25 envelopes / month", "PAdES B-B sealing", "Email signing & public verify portal", "2 templates", "99.5% uptime SLA"],
    highlight: false,
  },
  {
    code: "BUSINESS",
    name: "Business",
    price: "€79",
    per: "/mo",
    blurb: "For growing operations that live in documents.",
    cta: "Start 14-day trial",
    features: ["10 seats", "250 envelopes / month", "PAdES B-LT sealing", "SMS + WhatsApp delivery", "API access & webhooks", "DNS domain attestation", "Unlimited templates", "99.9% uptime SLA"],
    highlight: true,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    price: "€349",
    per: "/mo",
    blurb: "For regulated teams with audit obligations.",
    cta: "Talk to sales",
    href: "mailto:sales@docurama.eu",
    features: ["100 seats", "5,000 envelopes / month", "PAdES B-LTA sealing", "BYO certificates & SSO/SAML", "21 CFR Part 11 mode", "Audit chain exports", "Custom retention & legal hold", "99.99% uptime SLA"],
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Is Docurama an EU company, and where is my data?",
    a: "Docurama SAS is registered at 1 Rue Marguerin, 75014 Paris, France. Customer data is processed and stored in the European Union — no transatlantic transfers of your documents.",
  },
  {
    q: "Are the signatures legally valid?",
    a: "Docurama implements eIDAS-aligned electronic signature workflows (Simple, Advanced, Qualified-aligned) with cryptographic sealing and RFC 3161 timestamps. For most B2B contracts across the EU, Simple and Advanced eSignatures are sufficient and fully enforceable; the signing level applied to each document is reported honestly in its evidence record.",
  },
  {
    q: "We're a regulated company — can you support 21 CFR Part 11?",
    a: "Yes — organizations can enable Part 11 mode, which enforces signature manifestation under §11.50 (printed name, date/time and meaning of signature), versioned signer-consent records under §11.100, optional re-authentication before signing, and audit events on every mutation.",
  },
  {
    q: "Can we send from our own domain?",
    a: "Yes. Add your domain in Settings → Account and Docurama verifies it over live DNS (TXT) before any mail is sent from it, protecting both deliverability and your brand.",
  },
  {
    q: "Is there an API?",
    a: "Business and Enterprise plans include a REST API with X-API-Key authentication, envelope and template endpoints, a public verification endpoint and signed webhooks. An MCP server is also available for AI-agent integrations.",
  },
  {
    q: "How do we exercise GDPR rights?",
    a: "Write to privacy@docurama.eu or use the DSAR tooling available to workspace administrators. Access, erasure, rectification and portability requests are tracked with statutory due dates and completion records.",
  },
];

export function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Announcement bar ── */}
      <div className="bg-nautical px-4 py-2 text-center text-xs text-white/80">
        <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-primary" aria-hidden />
        EU data residency · GDPR, eIDAS-aligned &amp; 21 CFR Part 11 workflows · {BRAND_LEGAL_NAME}, Paris
      </div>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label="Main">
          <a href="#top" className="flex items-center gap-2" aria-label="Docurama home">
            <BrandLogo tagline size="sm" />
          </a>
          <div className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {n.label}
              </a>
            ))}
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="sm" onClick={() => { window.location.assign("/login"); }}>Sign in</Button>
            <Button size="sm" onClick={() => { window.location.assign("/welcome"); }}>
              Start free <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <button
            type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border md:hidden"
            aria-expanded={menuOpen} aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
            </svg>
          </button>
        </nav>
        {menuOpen && (
          <div className="space-y-1 border-t bg-background p-4 md:hidden">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted">
                {n.label}
              </a>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { window.location.assign("/login"); }}>Sign in</Button>
              <Button className="flex-1" onClick={() => { window.location.assign("/welcome"); }}>Start free</Button>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section id="top" className="relative overflow-hidden">
        <div className="absolute -left-40 top-10 h-96 w-96 rounded-full bg-primary-soft/70 blur-3xl" aria-hidden />
        <div className="absolute -right-32 -top-24 h-96 w-96 rounded-full bg-primary-soft/50 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft/60 px-3 py-1 text-xs font-medium text-primary-deep">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              eSignature built in the EU, for the EU — and beyond
            </p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Sign documents.<br />
              <span className="text-primary">Prove everything.</span>
            </h1>
            <p className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              Docurama sends, signs and seals your contracts with cryptographic evidence —
              X.509 certificates, RFC 3161 timestamps and an audit trail your lawyers will
              actually enjoy reading.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => { window.location.assign("/welcome"); }}>
                Start free — 14-day trial <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="lg" variant="outline" onClick={() => { window.location.assign("/verify"); }}>
                Verify a document
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No credit card required · Your own organization workspace in about two minutes
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              {["GDPR-aligned", "eIDAS SES / AdES / QES-aligned", "21 CFR Part 11 mode", "RFC 3161 TSA"].map((b) => (
                <li key={b} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden /> {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Product mock — pure CSS, no screenshots needed */}
          <div className="relative" aria-hidden>
            <div className="rounded-2xl border bg-card p-5 shadow-xl shadow-primary/5">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary"><FileSignature className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-semibold">Master Services Agreement</p>
                    <p className="text-xs text-muted-foreground">DOC-7K2M9XQA · 2 signers</p>
                  </div>
                </div>
                <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary-deep">COMPLETED</span>
              </div>
              <div className="space-y-3 py-4">
                {[
                  { n: "Alexandra Fischer", r: "Signer 1", t: "Signed · sealed 14:02", done: true },
                  { n: "Marc Dupont", r: "Signer 2", t: "Signed · sealed 16:47", done: true },
                ].map((row) => (
                  <div key={row.n} className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{row.n} <span className="text-xs font-normal text-muted-foreground">· {row.r}</span></p>
                      <p className="text-xs text-muted-foreground">{row.t}</p>
                    </div>
                    <span className="font-signature text-2xl text-primary-deep" style={{ fontFamily: "Caveat, cursive" }}>{row.n.split(" ").map((w) => w[0]).join("")}{row.n.split(" ")[1]?.slice(0, 4).toLowerCase()}…</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2 rounded-lg bg-nautical p-4 text-xs text-white/85">
                <p className="flex items-center gap-2 font-medium text-white"><Fingerprint className="h-3.5 w-3.5 text-primary" aria-hidden /> Cryptographic evidence</p>
                <p className="font-mono text-[11px] leading-relaxed text-white/60">
                  SHA-256 9f1c…4a02 · RSA-2048 / SHA-256<br />
                  TSA timestamp.digicert.com · 2026-09-15T14:02:11Z<br />
                  PAdES conformance B-LT · chain height 1842
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="product" className="border-t bg-muted/50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Everything signing should be</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Not just a signature in a corner — a complete evidence pipeline from the first
              email to the sealed archive, with the compliance knobs your industry expects.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="group rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Compliance ── */}
      <section id="compliance" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compliance you can show an auditor</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              The platform is built around three frameworks — with real mechanisms behind each
              claim, not badges on a landing page.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {COMPLIANCE.map((c) => (
              <div key={c.tag} className="rounded-xl border bg-card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <c.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-muted-foreground">{c.tag}</span>
                </div>
                <h3 className="text-base font-semibold">{c.title}</h3>
                <ul className="mt-3 space-y-2.5">
                  {c.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-t bg-nautical text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Three steps to a sealed contract</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              { icon: PenTool, t: "Prepare & send", d: "Upload your document, drop in signers, set routing and reminders. Invitations go out from notifications@docurama.eu — or your own verified domain." },
              { icon: FileSignature, t: "Sign anywhere", d: "Signers draw, type or upload their signature on any device. Identity is captured, consent is versioned, and every action hits the event ledger." },
              { icon: BadgeCheck, t: "Seal & prove", d: "On completion the document is sealed with your certificate, timestamped via RFC 3161, and gets a public verification code anyone can check." },
            ].map((s, i) => (
              <div key={s.t} className="relative space-y-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Step {i + 1}</p>
                <h3 className="text-lg font-semibold">{s.t}</h3>
                <p className="text-sm leading-relaxed text-white/65">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simple, EU-priced plans</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Every plan starts with a 14-day trial — no credit card. Prices exclude VAT.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.code} className={cn(
                "relative rounded-xl border p-6",
                p.highlight ? "border-primary bg-primary-soft/30 shadow-lg shadow-primary/10" : "bg-card",
              )}>
                {p.highlight && (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    Most popular
                  </span>
                )}
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{p.name}</h3>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">{p.price}</span>
                  <span className="text-sm text-muted-foreground">{p.per}</span>
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">{p.blurb}</p>
                <Button className="mt-5 w-full" variant={p.highlight ? "default" : "outline"}
                  onClick={() => { window.location.assign(p.href ?? "/welcome"); }}>
                  {p.cta}
                </Button>
                <ul className="mt-5 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs leading-relaxed">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Need more envelopes, self-hosting or on-premises deployment?{" "}
            <a className="font-medium underline underline-offset-2" href="mailto:sales@docurama.eu">sales@docurama.eu</a>
          </p>
        </div>
      </section>

      {/* ── Developers ── */}
      <section id="developers" className="border-t bg-muted/50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="space-y-5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Built API-first</h2>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Envelopes, templates and verification are all REST endpoints behind X-API-Key
              authentication — keys are hashed at rest, scoped, revocable and shown exactly
              once. Business and Enterprise plans also get signed webhooks and an MCP server
              for AI-agent workflows.
            </p>
            <ul className="space-y-2.5 text-sm">
              {[
                { icon: Terminal, t: "REST API — /api/v1 envelopes, templates, verify" },
                { icon: KeyRound, t: "Scoped API keys (read-only → full) with revocation" },
                { icon: MailCheck, t: "Signed webhooks for every envelope event" },
                { icon: Gauge, t: "MCP server (JSON-RPC 2.0) for AI agents" },
              ].map((i) => (
                <li key={i.t} className="flex items-center gap-2.5 text-muted-foreground">
                  <i.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /> {i.t}
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-xl border bg-nautical shadow-lg">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-3 text-[11px] font-mono text-white/50">send-envelope.sh</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-relaxed text-white/80"><code>{`# Create and send an envelope
curl -X POST https://app.docurama.eu/api/v1/envelopes \\
  -H "X-API-Key: dk_live_••••••••••" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Master Services Agreement",
    "recipients": [
      { "name": "Marc Dupont",
        "email": "marc@acme.fr",
        "role": "SIGNER" }
    ]
  }'

# → 201 Created
# { "publicCode": "DOC-7K2M9XQA", ... }`}</code></pre>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="border-t">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Frequently asked</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-xl border bg-card px-5 py-4 open:shadow-sm">
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

      {/* ── Final CTA ── */}
      <section className="border-t bg-primary-soft/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6">
          <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Your next contract deserves better than a scanned PDF
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Set up a compliant eSignature workspace in about two minutes — free for 14 days.
          </p>
          <Button size="lg" onClick={() => { window.location.assign("/welcome"); }}>
            Create your workspace <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t bg-nautical text-white/70">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <BrandLogo invert tagline size="sm" />
            <p className="text-xs leading-relaxed">
              {BRAND_LEGAL_NAME}<br />{BRAND_ADDRESS}<br />EU data residency · Paris, France
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-white/40">
              <Users className="h-3.5 w-3.5" aria-hidden /> Signing teams across the EU
            </p>
          </div>
          <nav aria-label="Product">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">Product</p>
            <ul className="space-y-2.5 text-sm">
              {[["Features", "#product"], ["Compliance", "#compliance"], ["Pricing", "#pricing"], ["Developers", "#developers"], ["Verify a document", "/verify"], ["Create account", "/welcome"]].map(([l, h]) => (
                <li key={l}><a className="transition-colors hover:text-white" href={h}>{l}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Contact">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">Contact</p>
            <ul className="space-y-2.5 text-sm">
              {[["Support", "support@docurama.eu"], ["Sales & enterprise", "sales@docurama.eu"], ["Billing", "billing@docurama.eu"], ["Privacy & DPO", "privacy@docurama.eu"], ["Legal", "legal@docurama.eu"], ["Security disclosure", "security@docurama.eu"], ["Abuse / phishing report", "abuse@docurama.eu"], ["Postmaster", "postmaster@docurama.eu"]].map(([l, m]) => (
                <li key={m}><a className="transition-colors hover:text-white" href={`mailto:${m}`}>{l}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Legal">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">Legal</p>
            <ul className="space-y-2.5 text-sm">
              <li>Terms of Service</li>
              <li>Privacy Policy</li>
              <li>Data Processing Agreement</li>
              <li>Subprocessor list</li>
              <li><a className="transition-colors hover:text-white" href="https://docurama.eu/.well-known/security.txt">security.txt</a></li>
              <li><a className="transition-colors hover:text-white" href="mailto:postmaster@docurama.eu">DMARC reports</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-5 text-[11px] leading-relaxed text-white/35 sm:px-6">
            © 2026 {BRAND_LEGAL_NAME} — {BRAND_ADDRESS} · All transactional mail is sent from
            notifications@docurama.eu · RFC 5321/2142 compliant contact addresses (postmaster@, abuse@) ·
            Docurama implements GDPR-, eIDAS- and 21 CFR Part 11-aligned workflows; it is not a
            accredited Qualified Trust Service Provider. For QES, pair Docurama with an EU QTSP.
          </p>
        </div>
      </footer>
    </div>
  );
}
