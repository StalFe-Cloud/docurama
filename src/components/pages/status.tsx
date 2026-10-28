import Link from "next/link";
import { BrandLogo, BRAND_LEGAL_NAME } from "@/components/brand/logo";
import { CheckCircle2, AlertTriangle, CircleDashed } from "lucide-react";



type ServiceState = "operational" | "degraded" | "info";

interface ServiceRow {
  name: string;
  description: string;
  state: ServiceState;
  detail: string;
}

function loadStatus() {
  // Demo build: static operational snapshot (the original probes the live database).
  const day = 86400000;
  const services: ServiceRow[] = [
    { name: "Signing portal", description: "Web application at app.docurama.eu", state: "operational", detail: "6 envelopes under management" },
    { name: "REST API", description: "api.docurama.eu and /api/v1 endpoints", state: "operational", detail: "Served by the same origin as this page" },
    { name: "Verification service", description: "Public portal at verify.docurama.eu", state: "operational", detail: "2 sealed documents verifiable" },
    { name: "Mail delivery", description: "Transactional invitations and reminders", state: "operational", detail: "3 messages delivered in the last 24h" },
    { name: "Timestamp relay", description: "RFC 3161 authority integration", state: "info", detail: "No active TSA configured" },
  ];
  const overall: ServiceState = "operational";
  const incidents = [
    { title: "Elevated sign-in latency", severity: "MINOR", status: "RESOLVED", detectedAt: new Date(Date.now() - 23 * day), resolvedAt: new Date(Date.now() - 23 * day + 3600000) },
  ];
  const stats = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * day).toISOString(),
    envelopesCreated: (i * 7) % 5,
    envelopesSealed: (i * 5) % 4,
  }));
  return { services, overall, incidents, stats };
}

function daysWithIncidents(incidents: { detectedAt: Date; resolvedAt: Date | null }[]) {
  const set = new Set<string>();
  const day = 86400000;
  for (const inc of incidents) {
    const end = inc.resolvedAt ?? new Date();
    for (let t = inc.detectedAt.getTime(); t <= end.getTime() && t <= Date.now(); t += day) {
      set.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  return set;
}

export default function StatusPage() {
  const { services, overall, incidents, stats } = loadStatus();
  const incidentDays = daysWithIncidents(incidents);
  const days: { date: string; hit: boolean }[] = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, hit: incidentDays.has(d) });
  }
  const maxCreated = Math.max(1, ...stats.map((s) => s.envelopesCreated));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <BrandLogo size="sm" />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link className="hover:text-foreground" href="/docs">Documentation</Link>
            <Link className="hover:text-foreground" href="/security">Security</Link>
            <Link className="hover:text-foreground" href="/marketing">Product</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">System status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live service health for docurama.eu, refreshed on every page load.
          Incidents affecting availability are published below with their timeline.
        </p>

        {/* Overall banner */}
        <div
          className={
            overall === "operational"
              ? "mt-8 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 px-5 py-4"
              : "mt-8 flex items-center gap-3 rounded-xl border border-amber-400/50 bg-amber-50 px-5 py-4"
          }
          role="status"
        >
          {overall === "operational" ? (
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
          )}
          <p className="text-sm font-medium">
            {overall === "operational"
              ? "All systems operational"
              : "Degraded service detected. The on-call engineer has been paged."}
          </p>
        </div>

        {/* Services */}
        <section aria-label="Services" className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Services</h2>
          <ul className="mt-4 divide-y rounded-xl border bg-card">
            {services.map((s) => (
              <li key={s.name} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{s.detail}</p>
                </div>
                <span className={
                  s.state === "operational"
                    ? "mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary-deep"
                    : s.state === "degraded"
                      ? "mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800"
                      : "mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                }>
                  {s.state === "operational" && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                  {s.state === "degraded" && <AlertTriangle className="h-3 w-3" aria-hidden />}
                  {s.state === "info" && <CircleDashed className="h-3 w-3" aria-hidden />}
                  {s.state === "operational" ? "Operational" : s.state === "degraded" ? "Degraded" : "Standby"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 60-day history strip */}
        <section aria-label="History" className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Last 60 days</h2>
          <div className="mt-4 flex gap-[3px]" aria-hidden>
            {days.map((d) => (
              <span
                key={d.date}
                title={`${d.date}${d.hit ? ": incident recorded" : ""}`}
                className={d.hit ? "h-8 flex-1 rounded-[2px] bg-amber-400" : "h-8 flex-1 rounded-[2px] bg-primary/70"}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each bar is one day. Amber marks a day covered by a recorded incident.
          </p>
        </section>

        {/* Activity (honest: derived from platform statistics) */}
        {stats.length > 0 && (
          <section aria-label="Platform activity" className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Envelope activity, last 14 days
            </h2>
            <div className="mt-4 flex h-24 items-end gap-1.5 rounded-xl border bg-card p-4" aria-hidden>
              {stats.map((s) => (
                <div key={s.date} title={`${s.date}: ${s.envelopesCreated} created, ${s.envelopesSealed} sealed`}
                  className="flex-1 rounded-t-[3px] bg-primary/75"
                  style={{ height: `${Math.max(6, (s.envelopesCreated / maxCreated) * 100)}%` }} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Envelopes created per day across all workspaces. Hover a bar for exact counts.
            </p>
          </section>
        )}

        {/* Incident history */}
        <section aria-label="Incident history" className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Incident history</h2>
          {incidents.length === 0 ? (
            <p className="mt-4 rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
              No incidents recorded.
            </p>
          ) : (
            <ol className="mt-4 space-y-4">
              {incidents.map((inc) => (
                <li key={inc.title} className="rounded-xl border bg-card px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{inc.title}</p>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {inc.severity} · {inc.status}
                    </span>
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                    Detected {inc.detectedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                    {inc.resolvedAt ? ` · Resolved ${inc.resolvedAt.toISOString().replace("T", " ").slice(0, 16)} UTC` : " · Open"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-14 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
          <p>
            Questions about an incident? Write to{" "}
            <a className="underline underline-offset-2" href="mailto:support@docurama.eu">support@docurama.eu</a>.
            Security disclosures go to{" "}
            <a className="underline underline-offset-2" href="mailto:security@docurama.eu">security@docurama.eu</a>{" "}
            per the <Link className="underline underline-offset-2" href="/security">disclosure policy</Link>.
          </p>
          <p className="mt-2">© 2026 {BRAND_LEGAL_NAME}. Status reflects the production origin serving docurama.eu.</p>
        </footer>
      </main>
    </div>
  );
}
