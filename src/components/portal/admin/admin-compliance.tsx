"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShieldCheck, Paperclip, Trash2, RotateCcw, Play, Pause, ShieldAlert,
  Check, X, FileCheck, UserCheck, Wrench, Server, Database, ClipboardList,
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorState, KpiCard, PageHeader, StatusBadge, fmtDate, fmtRelative } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

type ComplianceData = {
  controls: { id: string; ref: string; title: string; framework: string; category: string; status: string; owner: string; evidenceCount: number; lastReviewedAt: string | null }[];
  policies: { id: string; name: string; scope: string; retentionDays: number; disposition: string; status: string; lastSweepAt: string | null }[];
  consents: { id: string; subjectEmail: string; purpose: string; source: string; grantedAt: string; status: string; withdrawnAt: string | null }[];
  incidents: { id: string; title: string; severity: string; status: string; description: string; assignee: string; detectedAt: string; resolvedAt: string | null }[];
  reviews: { id: string; quarter: string; reviewer: string; scope: string; status: string; findings: number; completedAt: string | null }[];
  risks: { id: string; title: string; category: string; likelihood: string; impact: string; score: number; mitigation: string | null; status: string; owner: string }[];
  changes: { id: string; title: string; type: string; description: string; requestedBy: string; status: string; decidedBy: string | null; decisionAt: string | null }[];
  vendors: { id: string; name: string; service: string; riskLevel: string; dpdSigned: boolean; lastAuditAt: string | null; status: string }[];
  drills: { id: string; scope: string; rtoTarget: string; rtoActual: string | null; result: string; executedAt: string; notes: string | null }[];
  subprocessors: { id: string; name: string; purpose: string; location: string; dpaSigned: boolean; transferMechanism: string }[];
};

export function AdminCompliance() {
  const [tab, setTab] = useState("controls");
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "compliance"],
    queryFn: () => apiGet<ComplianceData>("/api/admin/compliance"),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id?: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/compliance", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "compliance"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy>
        <PageHeader title="Compliance" description="Trust operations centre." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
        </div>
      </div>
    );
  }

  const implemented = data.controls.filter((c) => c.status === "IMPLEMENTED").length;
  const controlCoverage = Math.round((implemented / data.controls.length) * 100);
  const openIncidents = data.incidents.filter((i) => i.status !== "RESOLVED").length;
  const openRisks = data.risks.filter((r) => r.status === "OPEN").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance"
        description="SOC 2 / ISO 27001 / GDPR control plane: evidence, retention, legal holds, incidents, risks and recovery drills."
        actions={
          <Button size="sm" className="h-11" onClick={() => act.mutate({ op: "sweep-retention" })} disabled={act.isPending}>
            <Trash2 className="h-4 w-4" aria-hidden /> Run retention sweep
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Control coverage" value={`${controlCoverage}%`} icon={ShieldCheck} tone={controlCoverage >= 80 ? "success" : "warning"} sub={`${implemented}/${data.controls.length} controls implemented`} />
        <KpiCard label="Open incidents" value={openIncidents} icon={ShieldAlert} tone={openIncidents > 0 ? "warning" : "success"} sub="Across all severity levels" />
        <KpiCard label="Open risks" value={openRisks} icon={ClipboardList} sub={`${data.risks.length} in register`} />
        <KpiCard label="Consent records" value={data.consents.length} icon={UserCheck} sub={`${data.consents.filter((c) => c.status === "GRANTED").length} active consents`} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11 flex-wrap">
          {[
            ["controls", "Controls"], ["retention", "Retention"], ["consents", "Consents"],
            ["incidents", "Incidents"], ["reviews", "Access reviews"], ["risks", "Risk register"],
            ["changes", "Change control"], ["vendors", "Vendors"], ["drills", "Restore drills"], ["subprocessors", "Subprocessors"],
          ].map(([k, label]) => (
            <TabsTrigger key={k} value={k} className="min-h-9">{label}</TabsTrigger>
          ))}
        </TabsList>

        {/* Controls */}
        <TabsContent value="controls">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.controls.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="font-mono text-xs text-primary">{c.ref}</span> {c.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.framework} · {c.category} · owner {c.owner} · reviewed {fmtDate(c.lastReviewedAt)} · {c.evidenceCount} evidence item(s)
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={c.status} />
                      <Button
                        variant="outline" size="sm" className="h-11"
                        onClick={() => act.mutate({ op: "control-evidence", id: c.id })}
                        aria-label={`Attach evidence to ${c.ref}`}
                      >
                        <Paperclip className="h-4 w-4" aria-hidden /> Evidence
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Retention */}
        <TabsContent value="retention">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.policies.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.scope} · {p.retentionDays} days · {p.disposition.toLowerCase()} on expiry
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={p.status} />
                      <span className="text-xs text-muted-foreground">last sweep {fmtRelative(p.lastSweepAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Consents */}
        <TabsContent value="consents">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.consents.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.subjectEmail}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.purpose} · via {c.source} · granted {fmtDate(c.grantedAt)}
                        {c.withdrawnAt ? ` · withdrawn ${fmtDate(c.withdrawnAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={c.status} />
                      {c.status === "GRANTED" && (
                        <Button variant="outline" size="sm" className="h-11" onClick={() => act.mutate({ op: "revoke-consent", id: c.id })}>
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Incidents */}
        <TabsContent value="incidents">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.incidents.map((i) => (
                  <li key={i.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{i.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Detected {fmtDate(i.detectedAt, true)} · assignee {i.assignee}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={i.severity} />
                        <StatusBadge status={i.status} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{i.description}</p>
                    {i.status === "OPEN" && (
                      <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "incident-contain", id: i.id })}>
                        <ShieldAlert className="h-4 w-4" aria-hidden /> Contain
                      </Button>
                    )}
                    {i.status === "CONTAINED" && (
                      <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "incident-resolve", id: i.id })}>
                        <Check className="h-4 w-4" aria-hidden /> Resolve
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Access reviews */}
        <TabsContent value="reviews">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.reviews.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.quarter} — {r.reviewer}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.scope} · {r.findings} finding(s)
                        {r.completedAt ? ` · completed ${fmtDate(r.completedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === "PENDING" && (
                        <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "complete-review", id: r.id })}>
                          <FileCheck className="h-4 w-4" aria-hidden /> Complete
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Risk register */}
        <TabsContent value="risks">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.risks.map((r) => (
                  <li key={r.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.category} · likelihood {r.likelihood.toLowerCase()} · impact {r.impact.toLowerCase()} · owner {r.owner}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="sr-only">Risk score {r.score} out of 25</span>
                          <span className={r.score >= 12 ? "text-destructive" : r.score >= 6 ? "text-warning" : "text-success"}>
                            <Progress value={(r.score / 25) * 100} className="h-1.5 w-20 [&>div]:bg-current" aria-hidden />
                          </span>
                          <span className="text-xs font-semibold tabular-nums">{r.score}</span>
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                    {r.mitigation && <p className="text-xs text-muted-foreground">{r.mitigation}</p>}
                    {r.status === "OPEN" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "mitigate-risk", id: r.id })}>
                          <Wrench className="h-4 w-4" aria-hidden /> Mark mitigated
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11" onClick={() => act.mutate({ op: "accept-risk", id: r.id })}>
                          Accept residual risk
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Change control */}
        <TabsContent value="changes">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.changes.map((c) => (
                  <li key={c.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {c.title}
                          {c.type === "EMERGENCY" && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">EMERGENCY</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {c.description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requested by {c.requestedBy}
                          {c.decidedBy ? ` · decided by ${c.decidedBy} ${fmtDate(c.decisionAt)}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                    {c.status === "PENDING" && (
                      <div className="flex gap-2">
                        <Button size="sm" className="h-11" onClick={() => act.mutate({ op: "decision-change", id: c.id, data: { approve: true } })}>
                          <Check className="h-4 w-4" aria-hidden /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-11 text-destructive hover:text-destructive" onClick={() => act.mutate({ op: "decision-change", id: c.id, data: { approve: false, note: "Rejected from admin console" } })}>
                          <X className="h-4 w-4" aria-hidden /> Reject
                        </Button>
                      </div>
                    )}
                    {c.status === "APPROVED" && (
                      <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "implement-change", id: c.id })}>
                        <Play className="h-4 w-4" aria-hidden /> Mark implemented
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vendors */}
        <TabsContent value="vendors">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.vendors.map((v) => (
                  <li key={v.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{v.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.service} · risk {v.riskLevel.toLowerCase()} · last audit {fmtDate(v.lastAuditAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={v.dpdSigned ? "text-xs text-success" : "text-xs text-destructive"}>
                        {v.dpdSigned ? "DPA signed" : "DPA missing"}
                      </span>
                      <StatusBadge status={v.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Restore drills */}
        <TabsContent value="drills">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.drills.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Database className="h-4 w-4 text-muted-foreground" aria-hidden /> {d.scope}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Executed {fmtDate(d.executedAt)} · RTO target {d.rtoTarget}
                        {d.rtoActual ? ` · actual ${d.rtoActual}` : ""}
                      </p>
                      {d.notes && <p className="mt-0.5 text-xs text-muted-foreground">{d.notes}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={d.result} />
                      <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "run-drill", id: d.id })}>
                        <RotateCcw className="h-4 w-4" aria-hidden /> Re-run
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Subprocessors */}
        <TabsContent value="subprocessors">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.subprocessors.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Server className="h-4 w-4 text-muted-foreground" aria-hidden /> {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.purpose} · {s.location} · transfer: {s.transferMechanism}</p>
                    </div>
                    <span className={s.dpaSigned ? "text-xs text-success" : "text-xs text-destructive"}>
                      {s.dpaSigned ? "DPA signed" : "DPA pending"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
