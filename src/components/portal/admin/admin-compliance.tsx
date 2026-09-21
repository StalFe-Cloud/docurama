"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShieldCheck, Paperclip, Trash2, RotateCcw, Play, Pause, ShieldAlert,
  Check, X, FileCheck, UserCheck, Wrench, Server, Database, ClipboardList,
  FileDown, Globe, Lock, BookOpen, Plus, Pencil, Save,
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorState, KpiCard, PageHeader, StatusBadge, fmtDate, fmtRelative } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ComplianceDocumentItem = {
  id: string;
  key: string;
  title: string;
  category: string;
  owner: string;
  status: string;
  version: string;
  locale: string;
  summary: string | null;
  isPublic: boolean;
  controlRefs: string;
  bodyMarkdown: string;
  approvedBy: string | null;
  approvedAt: string | null;
  versions: { id: string; version: string; changedBy: string; changeNote: string | null; createdAt: string }[];
};

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
  documents?: ComplianceDocumentItem[];
};

export function AdminCompliance() {
  const [tab, setTab] = useState("documents");
  const [selectedDoc, setSelectedDoc] = useState<ComplianceDocumentItem | null>(null);
  const [editDocMode, setEditDocMode] = useState(false);
  const [docForm, setDocForm] = useState({
    title: "", version: "", category: "", owner: "", controlRefs: "", changeNote: "", bodyMarkdown: "",
  });

  const [controlDialog, setControlDialog] = useState<{
    open: boolean; id?: string; form: { ref: string; title: string; framework: string; category: string; status: string; owner: string };
  }>({
    open: false, form: { ref: "", title: "", framework: "SOC 2", category: "Security", status: "IMPLEMENTED", owner: "Security" },
  });

  const [policyDialog, setPolicyDialog] = useState<{
    open: boolean; id?: string; form: { name: string; scope: string; retentionDays: number; disposition: string; status: string };
  }>({
    open: false, form: { name: "", scope: "DOCUMENTS", retentionDays: 365, disposition: "PURGE", status: "ACTIVE" },
  });

  const [riskDialog, setRiskDialog] = useState<{
    open: boolean; id?: string; form: { title: string; category: string; likelihood: string; impact: string; status: string; owner: string; mitigation: string };
  }>({
    open: false, form: { title: "", category: "Security", likelihood: "MEDIUM", impact: "MEDIUM", status: "OPEN", owner: "Security", mitigation: "" },
  });

  const [incidentDialog, setIncidentDialog] = useState<{
    open: boolean; id?: string; form: { title: string; severity: string; status: string; assignee: string; description: string };
  }>({
    open: false, form: { title: "", severity: "MEDIUM", status: "OPEN", assignee: "Security Lead", description: "" },
  });
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => window.open("/api/admin/auditor-bundle", "_blank")}
            >
              <FileDown className="h-4 w-4" aria-hidden /> Export Auditor Bundle
            </Button>
            <Button size="sm" className="h-11" onClick={() => act.mutate({ op: "sweep-retention" })} disabled={act.isPending}>
              <Trash2 className="h-4 w-4" aria-hidden /> Run retention sweep
            </Button>
          </div>
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
            ["documents", "Compliance Library"], ["controls", "Controls"], ["retention", "Retention"], ["consents", "Consents"],
            ["incidents", "Incidents"], ["reviews", "Access reviews"], ["risks", "Risk register"],
            ["changes", "Change control"], ["vendors", "Vendors"], ["drills", "Restore drills"], ["subprocessors", "Subprocessors"],
          ].map(([k, label]) => (
            <TabsTrigger key={k} value={k} className="min-h-9">{label}</TabsTrigger>
          ))}
        </TabsList>

        {/* Compliance Library Documents */}
        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">ISMS & Compliance Document Catalogue</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  12 internal governance policies, procedures, and registers. Documents flagged public appear on /docs/legal.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(!data.documents || data.documents.length === 0) ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No compliance documents found in database.</div>
              ) : (
                <ul className="divide-y">
                  {data.documents.map((doc) => (
                    <li key={doc.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm text-foreground">{doc.title}</span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-mono font-medium text-primary">v{doc.version}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{doc.category}</span>
                          {doc.isPublic ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                              <Globe className="h-3 w-3" /> Public (/docs/legal)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Lock className="h-3 w-3" /> Internal only
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{doc.summary || doc.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Owner: {doc.owner} · Controls: {doc.controlRefs || "General"} · Status: {doc.status}
                          {doc.approvedAt && ` · Approved ${fmtDate(doc.approvedAt)} by ${doc.approvedBy}`}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => setSelectedDoc(doc)}
                        >
                          <BookOpen className="h-3.5 w-3.5" aria-hidden /> View Policy
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 text-xs"
                          onClick={() => act.mutate({ op: "doc-toggle-public", id: doc.id })}
                        >
                          {doc.isPublic ? "Unpublish" : "Publish"}
                        </Button>
                        {doc.status !== "APPROVED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs text-primary"
                            onClick={() => act.mutate({ op: "doc-approve", id: doc.id })}
                          >
                            Approve
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Controls */}
        <TabsContent value="controls">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Security &amp; Privacy Controls</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Framework controls mapped across SOC 2, ISO 27001, and GDPR.</p>
              </div>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setControlDialog({
                    open: true,
                    form: { ref: "", title: "", framework: "SOC 2", category: "Security", status: "IMPLEMENTED", owner: "Security" },
                  });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Add Control
              </Button>
            </CardHeader>
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
                        variant="ghost"
                        size="sm"
                        className="h-10 text-muted-foreground hover:text-foreground gap-1"
                        onClick={() => {
                          setControlDialog({
                            open: true,
                            id: c.id,
                            form: {
                              ref: c.ref,
                              title: c.title,
                              framework: c.framework,
                              category: c.category,
                              status: c.status,
                              owner: c.owner,
                            },
                          });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                      </Button>
                      <Button
                        variant="outline" size="sm" className="h-10"
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Data Retention &amp; Disposal Policies</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Automated document lifecycle rules and purge schedules.</p>
              </div>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setPolicyDialog({
                    open: true,
                    form: { name: "", scope: "DOCUMENTS", retentionDays: 365, disposition: "PURGE", status: "ACTIVE" },
                  });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Add Policy
              </Button>
            </CardHeader>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 text-muted-foreground hover:text-foreground gap-1"
                        onClick={() => {
                          setPolicyDialog({
                            open: true,
                            id: p.id,
                            form: {
                              name: p.name,
                              scope: p.scope,
                              retentionDays: p.retentionDays,
                              disposition: p.disposition,
                              status: p.status,
                            },
                          });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                      </Button>
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Security &amp; Operational Incidents</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Triage, severity classification, and resolution logs.</p>
              </div>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setIncidentDialog({
                    open: true,
                    form: { title: "", severity: "MEDIUM", status: "OPEN", assignee: "Security Lead", description: "" },
                  });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Log Incident
              </Button>
            </CardHeader>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => {
                            setIncidentDialog({
                              open: true,
                              id: i.id,
                              form: {
                                title: i.title,
                                severity: i.severity,
                                status: i.status,
                                assignee: i.assignee,
                                description: i.description,
                              },
                            });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                        </Button>
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
                      <p className="text-sm font-medium">{r.quarter} - {r.reviewer}</p>
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Risk Register &amp; Mitigations</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Threat assessments, residual risk scoring, and treatment plans.</p>
              </div>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setRiskDialog({
                    open: true,
                    form: { title: "", category: "Security", likelihood: "MEDIUM", impact: "MEDIUM", status: "OPEN", owner: "Security", mitigation: "" },
                  });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Add Risk
              </Button>
            </CardHeader>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => {
                            setRiskDialog({
                              open: true,
                              id: r.id,
                              form: {
                                title: r.title,
                                category: r.category,
                                likelihood: r.likelihood,
                                impact: r.impact,
                                status: r.status,
                                owner: r.owner,
                                mitigation: r.mitigation || "",
                              },
                            });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                        </Button>
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

      {/* Document Viewer & Editor Modal */}
      <Dialog open={!!selectedDoc} onOpenChange={(v) => { if (!v) { setSelectedDoc(null); setEditDocMode(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedDoc && (
            <div className="space-y-4">
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-mono font-semibold text-primary">v{selectedDoc.version}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{selectedDoc.category}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => {
                      if (!editDocMode) {
                        setDocForm({
                          title: selectedDoc.title,
                          version: selectedDoc.version,
                          category: selectedDoc.category,
                          owner: selectedDoc.owner,
                          controlRefs: selectedDoc.controlRefs,
                          changeNote: "",
                          bodyMarkdown: selectedDoc.bodyMarkdown,
                        });
                      }
                      setEditDocMode(!editDocMode);
                    }}
                  >
                    {editDocMode ? <BookOpen className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                    {editDocMode ? "View Mode" : "Edit Document"}
                  </Button>
                </div>
                <DialogTitle className="text-xl mt-1">{selectedDoc.title}</DialogTitle>
                <DialogDescription>
                  Owner: {selectedDoc.owner} · Controls: {selectedDoc.controlRefs || "General"}
                  {selectedDoc.approvedAt && ` · Approved by ${selectedDoc.approvedBy} on ${fmtDate(selectedDoc.approvedAt)}`}
                </DialogDescription>
              </DialogHeader>

              {editDocMode ? (
                <div className="space-y-3.5 py-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-title">Document Title</Label>
                      <Input
                        id="ed-title"
                        value={docForm.title}
                        onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-ver">Version</Label>
                      <Input
                        id="ed-ver"
                        value={docForm.version}
                        onChange={(e) => setDocForm({ ...docForm, version: e.target.value })}
                        className="h-10 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-owner">Owner</Label>
                      <Input
                        id="ed-owner"
                        value={docForm.owner}
                        onChange={(e) => setDocForm({ ...docForm, owner: e.target.value })}
                        className="h-10 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-cat">Category</Label>
                      <Input
                        id="ed-cat"
                        value={docForm.category}
                        onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}
                        className="h-10 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-ctrl">Control Refs</Label>
                      <Input
                        id="ed-ctrl"
                        value={docForm.controlRefs}
                        onChange={(e) => setDocForm({ ...docForm, controlRefs: e.target.value })}
                        className="h-10 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ed-note">Change Note / Revision Summary</Label>
                    <Input
                      id="ed-note"
                      value={docForm.changeNote}
                      onChange={(e) => setDocForm({ ...docForm, changeNote: e.target.value })}
                      placeholder="e.g. Annual policy review and ISO 27001 control updates"
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ed-body">Document Markdown Content</Label>
                    <textarea
                      id="ed-body"
                      value={docForm.bodyMarkdown}
                      onChange={(e) => setDocForm({ ...docForm, bodyMarkdown: e.target.value })}
                      rows={14}
                      className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" onClick={() => setEditDocMode(false)}>Cancel</Button>
                    <Button
                      onClick={() => {
                        act.mutate({ op: "doc-save", id: selectedDoc.id, data: docForm });
                        setEditDocMode(false);
                        setSelectedDoc(null);
                      }}
                      disabled={act.isPending || !docForm.title.trim() || !docForm.bodyMarkdown.trim()}
                    >
                      <Save className="h-4 w-4 mr-1.5" /> Save Document
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/20 p-4 prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-sans text-xs sm:text-sm">
                    {selectedDoc.bodyMarkdown}
                  </div>

                  {selectedDoc.versions && selectedDoc.versions.length > 0 && (
                    <div className="space-y-1.5 border-t pt-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version History</h4>
                      <ul className="text-xs space-y-1 text-muted-foreground">
                        {selectedDoc.versions.map((v) => (
                          <li key={v.id} className="flex items-center justify-between">
                            <span>v{v.version} — {v.changeNote || "Revision"}</span>
                            <span>{v.changedBy} · {fmtDate(v.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Control Dialog */}
      <Dialog open={controlDialog.open} onOpenChange={(v) => !v && setControlDialog({ ...controlDialog, open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{controlDialog.id ? "Edit Control" : "Add Security Control"}</DialogTitle>
            <DialogDescription>Configure compliance control framework reference and implementation status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ctl-ref">Control Reference ID</Label>
              <Input
                id="ctl-ref"
                value={controlDialog.form.ref}
                onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, ref: e.target.value } })}
                placeholder="SOC2-CC6.1 or ISO27001-A.9.2"
                className="h-10 font-mono text-xs"
                disabled={!!controlDialog.id}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctl-title">Title</Label>
              <Input
                id="ctl-title"
                value={controlDialog.form.title}
                onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, title: e.target.value } })}
                placeholder="User Registration and Access Management"
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ctl-fw">Framework</Label>
                <select
                  id="ctl-fw"
                  value={controlDialog.form.framework}
                  onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, framework: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="SOC 2">SOC 2</option>
                  <option value="ISO 27001">ISO 27001</option>
                  <option value="GDPR">GDPR</option>
                  <option value="eIDAS">eIDAS</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctl-cat">Category</Label>
                <Input
                  id="ctl-cat"
                  value={controlDialog.form.category}
                  onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, category: e.target.value } })}
                  className="h-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ctl-st">Status</Label>
                <select
                  id="ctl-st"
                  value={controlDialog.form.status}
                  onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, status: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="IMPLEMENTED">IMPLEMENTED</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="PLANNED">PLANNED</option>
                  <option value="EXEMPT">EXEMPT</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctl-owner">Owner</Label>
                <Input
                  id="ctl-owner"
                  value={controlDialog.form.owner}
                  onChange={(e) => setControlDialog({ ...controlDialog, form: { ...controlDialog.form, owner: e.target.value } })}
                  className="h-10"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setControlDialog({ ...controlDialog, open: false })}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "control-save", id: controlDialog.id, data: controlDialog.form });
                setControlDialog({ ...controlDialog, open: false });
              }}
              disabled={act.isPending || !controlDialog.form.title.trim()}
            >
              Save Control
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Dialog */}
      <Dialog open={policyDialog.open} onOpenChange={(v) => !v && setPolicyDialog({ ...policyDialog, open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{policyDialog.id ? "Edit Retention Policy" : "Add Retention Policy"}</DialogTitle>
            <DialogDescription>Define automated lifecycle and data destruction rules.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pol-name">Policy Name</Label>
              <Input
                id="pol-name"
                value={policyDialog.form.name}
                onChange={(e) => setPolicyDialog({ ...policyDialog, form: { ...policyDialog.form, name: e.target.value } })}
                placeholder="Signed Envelope Retention"
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pol-scope">Scope</Label>
                <Input
                  id="pol-scope"
                  value={policyDialog.form.scope}
                  onChange={(e) => setPolicyDialog({ ...policyDialog, form: { ...policyDialog.form, scope: e.target.value } })}
                  placeholder="ENVELOPES"
                  className="h-10 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pol-days">Retention Days</Label>
                <Input
                  id="pol-days"
                  type="number"
                  value={policyDialog.form.retentionDays}
                  onChange={(e) => setPolicyDialog({ ...policyDialog, form: { ...policyDialog.form, retentionDays: Number(e.target.value) } })}
                  className="h-10 font-mono text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pol-disp">Disposition</Label>
                <select
                  id="pol-disp"
                  value={policyDialog.form.disposition}
                  onChange={(e) => setPolicyDialog({ ...policyDialog, form: { ...policyDialog.form, disposition: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="PURGE">PURGE</option>
                  <option value="ARCHIVE_COLD">ARCHIVE_COLD</option>
                  <option value="ANONYMIZE">ANONYMIZE</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pol-st">Status</Label>
                <select
                  id="pol-st"
                  value={policyDialog.form.status}
                  onChange={(e) => setPolicyDialog({ ...policyDialog, form: { ...policyDialog.form, status: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAUSED">PAUSED</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyDialog({ ...policyDialog, open: false })}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "policy-save", id: policyDialog.id, data: policyDialog.form });
                setPolicyDialog({ ...policyDialog, open: false });
              }}
              disabled={act.isPending || !policyDialog.form.name.trim()}
            >
              Save Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incident Dialog */}
      <Dialog open={incidentDialog.open} onOpenChange={(v) => !v && setIncidentDialog({ ...incidentDialog, open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{incidentDialog.id ? "Edit Incident" : "Log Security Incident"}</DialogTitle>
            <DialogDescription>Record and update incident classification and response state.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-title">Title</Label>
              <Input
                id="inc-title"
                value={incidentDialog.form.title}
                onChange={(e) => setIncidentDialog({ ...incidentDialog, form: { ...incidentDialog.form, title: e.target.value } })}
                placeholder="Failed webhook replay threshold exceeded"
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inc-sev">Severity</Label>
                <select
                  id="inc-sev"
                  value={incidentDialog.form.severity}
                  onChange={(e) => setIncidentDialog({ ...incidentDialog, form: { ...incidentDialog.form, severity: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inc-st">Status</Label>
                <select
                  id="inc-st"
                  value={incidentDialog.form.status}
                  onChange={(e) => setIncidentDialog({ ...incidentDialog, form: { ...incidentDialog.form, status: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CONTAINED">CONTAINED</option>
                  <option value="RESOLVED">RESOLVED</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-assignee">Assignee</Label>
              <Input
                id="inc-assignee"
                value={incidentDialog.form.assignee}
                onChange={(e) => setIncidentDialog({ ...incidentDialog, form: { ...incidentDialog.form, assignee: e.target.value } })}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-desc">Description</Label>
              <textarea
                id="inc-desc"
                value={incidentDialog.form.description}
                onChange={(e) => setIncidentDialog({ ...incidentDialog, form: { ...incidentDialog.form, description: e.target.value } })}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background p-2.5 text-xs ring-offset-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentDialog({ ...incidentDialog, open: false })}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "incident-save", id: incidentDialog.id, data: incidentDialog.form });
                setIncidentDialog({ ...incidentDialog, open: false });
              }}
              disabled={act.isPending || !incidentDialog.form.title.trim()}
            >
              Save Incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Risk Dialog */}
      <Dialog open={riskDialog.open} onOpenChange={(v) => !v && setRiskDialog({ ...riskDialog, open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{riskDialog.id ? "Edit Risk Assessment" : "Add Risk Assessment"}</DialogTitle>
            <DialogDescription>Track likelihood, impact, and mitigation controls in the risk register.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rk-title">Risk Title</Label>
              <Input
                id="rk-title"
                value={riskDialog.form.title}
                onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, title: e.target.value } })}
                placeholder="Third-party timestamp authority downtime"
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rk-cat">Category</Label>
                <Input
                  id="rk-cat"
                  value={riskDialog.form.category}
                  onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, category: e.target.value } })}
                  className="h-10 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rk-lh">Likelihood</Label>
                <select
                  id="rk-lh"
                  value={riskDialog.form.likelihood}
                  onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, likelihood: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rk-imp">Impact</Label>
                <select
                  id="rk-imp"
                  value={riskDialog.form.impact}
                  onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, impact: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rk-st">Status</Label>
                <select
                  id="rk-st"
                  value={riskDialog.form.status}
                  onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, status: e.target.value } })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="MITIGATED">MITIGATED</option>
                  <option value="ACCEPTED">ACCEPTED</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rk-owner">Owner</Label>
                <Input
                  id="rk-owner"
                  value={riskDialog.form.owner}
                  onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, owner: e.target.value } })}
                  className="h-10 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rk-mit">Mitigation Plan</Label>
              <textarea
                id="rk-mit"
                value={riskDialog.form.mitigation}
                onChange={(e) => setRiskDialog({ ...riskDialog, form: { ...riskDialog.form, mitigation: e.target.value } })}
                rows={2}
                placeholder="Automated fallback to local timestamping and B-B signature level"
                className="flex w-full rounded-md border border-input bg-background p-2.5 text-xs ring-offset-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRiskDialog({ ...riskDialog, open: false })}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "risk-save", id: riskDialog.id, data: riskDialog.form });
                setRiskDialog({ ...riskDialog, open: false });
              }}
              disabled={act.isPending || !riskDialog.form.title.trim()}
            >
              Save Risk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
