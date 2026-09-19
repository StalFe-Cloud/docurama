"use client";

/**
 * Public /enterprise lead form. Submissions POST to /api/enterprise which
 * stores an EnterpriseLead for the admin pipeline. Includes a honeypot field
 * (invisible to humans) and client-side validation mirroring the server rules.
 */

import { useState } from "react";
import { ArrowRight, BadgeCheck, Building2, CheckCircle2, Lock, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo, BRAND_LEGAL_NAME, BRAND_ADDRESS } from "@/components/brand/logo";

const CAPABILITIES: { icon: typeof ShieldCheck; title: string; body: string }[] = [
  {
    icon: Server,
    title: "Custom seats and volume",
    body: "Seats, monthly envelope volume and price are negotiated per deal — from 50 to thousands of seats, with rollover on unused envelopes included.",
  },
  {
    icon: ShieldCheck,
    title: "SSO/SAML and BYO certificates",
    body: "Sign in through your identity provider and seal with your own qualified certificates. PAdES B-LTA conformance for long-term archival evidence.",
  },
  {
    icon: Lock,
    title: "Retention and legal hold",
    body: "Custom retention policies, legal hold workflows and audit chain exports your regulators can verify — plus 21 CFR Part 11 mode for pharma teams.",
  },
  {
    icon: Building2,
    title: "EU data residency, Paris-based",
    body: `A French company (${BRAND_LEGAL_NAME}) processing and storing documents in the European Union, with no transatlantic document transfers.`,
  },
];

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

export function EnterpriseLeadForm() {
  const [form, setForm] = useState({
    contactName: "", workEmail: "", companyName: "",
    companySize: "", country: "", monthlyVolume: "", needs: "", preferredDate: "",
  });
  const [consent, setConsent] = useState(false);
  const [honey, setHoney] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.contactName.trim() || !form.workEmail.trim() || !form.companyName.trim()) {
      setError("Your name, work email and company name are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.workEmail.trim())) {
      setError("Enter a valid work email address.");
      return;
    }
    if (!consent) {
      setError("Please accept the Terms of Service and Privacy Policy so we can store your request.");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/enterprise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, honey }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Submission failed");
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Submission failed - please retry.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <a href="/" aria-label="Docurama home"><BrandLogo tagline size="sm" /></a>
          <a href="/#pricing" className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground">
            See all plans
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: what Enterprise includes */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Enterprise</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Custom seats, custom volume, custom price
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
              Enterprise pricing is negotiated per deal — there is no fixed
              public number because no two regulated teams sign the same way.
              Tell us your volume and requirements and you get a concrete
              proposal, not a sales maze.
            </p>
            <div className="mt-8 space-y-4">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="flex gap-3 rounded-xl border bg-card p-4">
                  <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <h2 className="text-sm font-semibold">{c.title}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              eIDAS-aligned workflows, honest conformance reporting on every
              document. We state exactly what each signature is — never more.
            </p>
          </div>

          {/* Right: the form */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            {status === "sent" ? (
              <div className="rounded-xl border bg-card p-8 text-center" role="status">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
                <h2 className="mt-4 text-lg font-semibold">Request received</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Thank you, {form.contactName.split(" ")[0]}. Your request is in
                  the pipeline — a human replies within one business day with
                  next steps and, if useful, a live walkthrough.
                </p>
                <Button className="mt-6" variant="outline" onClick={() => { window.location.assign("/"); }}>
                  Back to the homepage <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="rounded-xl border bg-card p-6 sm:p-8" noValidate>
                <h2 className="text-lg font-semibold">Tell us what you need</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  One business day for a first reply. No obligation, no spam.
                </p>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Field label="Your name" required>
                    <input required maxLength={80} value={form.contactName} onChange={set("contactName")}
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="name" />
                  </Field>
                  <Field label="Work email" required>
                    <input required type="email" maxLength={120} value={form.workEmail} onChange={set("workEmail")}
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="email" />
                  </Field>
                  <Field label="Company" required>
                    <input required maxLength={120} value={form.companyName} onChange={set("companyName")}
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="organization" />
                  </Field>
                  <Field label="Company size">
                    <select value={form.companySize} onChange={set("companySize")}
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                      <option value="">Select…</option>
                      {SIZES.map((s) => <option key={s} value={s}>{s} people</option>)}
                    </select>
                  </Field>
                  <Field label="Country">
                    <input maxLength={60} value={form.country} onChange={set("country")}
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="country-name" />
                  </Field>
                  <Field label="Envelopes per month">
                    <input maxLength={30} value={form.monthlyVolume} onChange={set("monthlyVolume")} placeholder="e.g. 800"
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" inputMode="text" />
                  </Field>
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor="ent-needs">What matters to you?</FieldLabel>
                    <textarea id="ent-needs" rows={3} maxLength={1000} value={form.needs} onChange={set("needs")}
                      placeholder="SSO, bring-your-own certificates, audit exports, retention policies…"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor="ent-date">Preferred kickoff date</FieldLabel>
                    <input id="ent-date" maxLength={30} value={form.preferredDate} onChange={set("preferredDate")} placeholder="e.g. first week of November"
                      className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
                  </div>
                </div>

                {/* Honeypot: invisible to humans, bots fill it and get dropped. */}
                <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
                  value={honey} onChange={(e) => setHoney(e.target.value)}
                  className="pointer-events-none absolute h-0 w-0 opacity-0" />

                <label className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border" />
                  I accept the Terms of Service and Privacy Policy and agree
                  that Docurama stores this request to answer it.
                </label>

                {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}

                <Button type="submit" className="mt-5 w-full" disabled={status === "sending"}>
                  {status === "sending" ? "Sending…" : "Request a proposal"} <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-muted-foreground sm:px-6">
          {BRAND_LEGAL_NAME} · {BRAND_ADDRESS} · EU data residency
        </div>
      </footer>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  );
}

function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium">
      {children}
      {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
    </label>
  );
}
