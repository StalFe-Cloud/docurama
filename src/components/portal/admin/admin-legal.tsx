"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, Gavel, Play, X, Scale, FileDown, Plus } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { EmptyState, ErrorState, PageHeader, StatusBadge, fmtDate, daysUntil } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Dmca = {
  id: string; complainant: string; targetUrl: string; works: string; status: string;
  severity: string; receivedAt: string; slaDueAt: string; resolvedAt: string | null; resolutionNote: string | null;
};
type Dsar = {
  id: string; tenantName: string; type: string; subjectEmail: string; status: string;
  notes: string | null; requestedAt: string; dueAt: string; completedAt: string | null;
};
type Hold = {
  id: string; tenantName: string; reason: string; scope: string; status: string;
  issuedBy: string; issuedAt: string; releasedAt: string | null;
};
type TenantOption = { id: string; name: string; slug: string };

export function AdminLegal() {
  const queryClient = useQueryClient();
  const [resolveFor, setResolveFor] = useState<Dmca | null>(null);
  const [note, setNote] = useState("");

  // Dialog states for creation
  const [holdDialog, setHoldDialog] = useState(false);
  const [holdForm, setHoldForm] = useState({ tenantId: "", reason: "", scope: "" });

  const [dsarDialog, setDsarDialog] = useState(false);
  const [dsarForm, setDsarForm] = useState({ subjectEmail: "", type: "ACCESS", tenantId: "", notes: "", dueDays: 30 });

  const [dmcaDialog, setDmcaDialog] = useState(false);
  const [dmcaForm, setDmcaForm] = useState({ complainant: "", targetUrl: "https://docurama.eu/", works: "", severity: "NORMAL", slaDays: 14 });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "legal"],
    queryFn: () => apiGet<{ dmca: Dmca[]; dsar: Dsar[]; holds: Hold[]; allTenants?: TenantOption[] }>("/api/admin/legal"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "legal"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
  };

  const act = useMutation({
    mutationFn: (vars: { op: string; id?: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/legal", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      invalidate();
      setHoldDialog(false);
      setDsarDialog(false);
      setDmcaDialog(false);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const dmcaOpen = (data?.dmca ?? []).filter((n) => n.status === "OPEN");
  const tenants = data?.allTenants ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Legal & DSAR"
        description="DMCA intake with SLA tracking, data-subject rights workflows, and court-order legal holds. Everything is recorded verbatim in the immutable audit chain."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => setDmcaDialog(true)}>
              <Gavel className="h-3.5 w-3.5" /> File DMCA
            </Button>
            <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => setDsarDialog(true)}>
              <Scale className="h-3.5 w-3.5" /> Record DSAR
            </Button>
            <Button size="sm" className="h-10 gap-1.5" onClick={() => setHoldDialog(true)}>
              <Ban className="h-3.5 w-3.5" /> Issue Legal Hold
            </Button>
          </div>
        }
      />

      {/* DMCA queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4 text-muted-foreground" aria-hidden /> DMCA notices - {dmcaOpen.length} open
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setDmcaDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> New notice
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : (data?.dmca ?? []).length === 0 ? (
            <EmptyState icon={Gavel} title="No DMCA notices" description="Takedown notices submitted through the public intake form or recorded here will appear." />
          ) : (
            <ul className="divide-y">
              {(data?.dmca ?? []).map((n) => {
                const due = daysUntil(n.slaDueAt);
                const slaBreached = n.status === "OPEN" && due < 0;
                const slaSoon = n.status === "OPEN" && due >= 0 && due <= 2;
                return (
                  <li key={n.id} className="space-y-3 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{n.complainant}</p>
                        <p className="break-all text-xs text-muted-foreground">{n.targetUrl}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{n.works}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={n.severity} />
                        <StatusBadge status={n.status} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        Received {fmtDate(n.receivedAt)}
                        <span aria-hidden>·</span>
                        <span className={cn(slaBreached && "font-semibold text-destructive", slaSoon && "font-semibold text-warning")}>
                          {n.status === "OPEN"
                            ? slaBreached ? `SLA breached by ${Math.abs(due)} day(s)` : `SLA due in ${due} day(s)`
                            : `Resolved ${fmtDate(n.resolvedAt)}`}
                        </span>
                      </p>
                      {n.status === "OPEN" && (
                        <Button
                          size="sm" className="h-11"
                          onClick={() => { setResolveFor(n); setNote(""); }}
                        >
                          <Check className="h-4 w-4" aria-hidden /> Resolve
                        </Button>
                      )}
                    </div>
                    {n.resolutionNote && (
                      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Resolution note: </span>{n.resolutionNote}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* DSAR */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4 text-muted-foreground" aria-hidden /> Data subject requests - GDPR Art. 15-20
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setDsarDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> Record request
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : (data?.dsar ?? []).length === 0 ? (
            <EmptyState icon={Scale} title="No DSAR requests" description="Requests submitted through privacy channels or recorded by admin will appear here." />
          ) : (
            <ul className="divide-y">
              {(data?.dsar ?? []).map((r) => {
                const due = daysUntil(r.dueAt);
                return (
                  <li key={r.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {r.subjectEmail}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.type}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.tenantName} · requested {fmtDate(r.requestedAt)}
                        {r.status === "COMPLETED" ? ` · completed ${fmtDate(r.completedAt)}` : r.status === "CANCELED" ? " · cancelled" : ` · due in ${due} day(s)`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === "OPEN" && (
                        <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "run-dsar", id: r.id })}>
                          <Play className="h-4 w-4" aria-hidden /> Run collection
                        </Button>
                      )}
                      {r.status === "RUNNING" && (
                        <>
                          <Button
                            size="sm" variant="outline" className="h-11"
                            onClick={() => {
                              window.open(`/api/admin/dsar-export?id=${r.id}`, "_blank");
                              refetch();
                            }}
                          >
                            <FileDown className="h-4 w-4" aria-hidden /> Download archive
                          </Button>
                          <Button size="sm" variant="outline" className="h-11 text-destructive hover:text-destructive" onClick={() => act.mutate({ op: "cancel-dsar", id: r.id })}>
                            <X className="h-4 w-4" aria-hidden /> Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Legal holds */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ban className="h-4 w-4 text-muted-foreground" aria-hidden /> Legal holds
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setHoldDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> Issue hold
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : (data?.holds ?? []).length === 0 ? (
            <EmptyState title="No active legal holds" description="Retention is suspended for workspaces under court or regulatory hold." />
          ) : (
            <ul className="divide-y">
              {(data?.holds ?? []).map((h) => (
                <li key={h.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{h.reason}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{h.scope}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {h.tenantName} · issued by {h.issuedBy} · {fmtDate(h.issuedAt)}
                      {h.releasedAt ? ` · released ${fmtDate(h.releasedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={h.status} />
                    {h.status === "ACTIVE" && (
                      <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "release-hold", id: h.id })}>
                        Release hold
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Issue Legal Hold Dialog */}
      <Dialog open={holdDialog} onOpenChange={setHoldDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Legal Hold</DialogTitle>
            <DialogDescription>
              Suspend automated retention policies and deletions for a specific workspace under legal or regulatory inquiry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="hold-tenant">Target Workspace</Label>
              <select
                id="hold-tenant"
                value={holdForm.tenantId || (tenants[0]?.id ?? "")}
                onChange={(e) => setHoldForm({ ...holdForm, tenantId: e.target.value })}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-reason">Legal Matter / Reason</Label>
              <Input
                id="hold-reason"
                placeholder="e.g. Subpoena 2026-CV-8192 or Internal Audit Investigation"
                value={holdForm.reason}
                onChange={(e) => setHoldForm({ ...holdForm, reason: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-scope">Preservation Scope</Label>
              <Textarea
                id="hold-scope"
                rows={3}
                placeholder="e.g. All executed contracts, audit trails, and recipient logs from Q1 2026 onwards."
                value={holdForm.scope}
                onChange={(e) => setHoldForm({ ...holdForm, scope: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldDialog(false)}>Cancel</Button>
            <Button
              disabled={act.isPending || !holdForm.reason.trim() || !holdForm.scope.trim()}
              onClick={() => act.mutate({
                op: "hold.create",
                data: {
                  tenantId: holdForm.tenantId || (tenants[0]?.id ?? ""),
                  reason: holdForm.reason.trim(),
                  scope: holdForm.scope.trim(),
                },
              })}
            >
              {act.isPending ? "Issuing…" : "Issue Hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record DSAR Dialog */}
      <Dialog open={dsarDialog} onOpenChange={setDsarDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Data Subject Request (DSAR)</DialogTitle>
            <DialogDescription>
              Log a GDPR/CCPA privacy request (Articles 15-20) received via support or legal email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dsar-email">Subject Email Address</Label>
              <Input
                id="dsar-email"
                type="email"
                placeholder="user@example.com"
                value={dsarForm.subjectEmail}
                onChange={(e) => setDsarForm({ ...dsarForm, subjectEmail: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dsar-type">Request Type</Label>
                <select
                  id="dsar-type"
                  value={dsarForm.type}
                  onChange={(e) => setDsarForm({ ...dsarForm, type: e.target.value })}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="ACCESS">ACCESS (Art. 15)</option>
                  <option value="ERASURE">ERASURE (Art. 17)</option>
                  <option value="RECTIFICATION">RECTIFICATION (Art. 16)</option>
                  <option value="PORTABILITY">PORTABILITY (Art. 20)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsar-days">SLA Due Days</Label>
                <Input
                  id="dsar-days"
                  type="number"
                  min={1}
                  max={60}
                  value={dsarForm.dueDays}
                  onChange={(e) => setDsarForm({ ...dsarForm, dueDays: Number(e.target.value) })}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsar-notes">Intake Notes / Verification Details</Label>
              <Textarea
                id="dsar-notes"
                rows={3}
                placeholder="ID verification completed via signed request email."
                value={dsarForm.notes}
                onChange={(e) => setDsarForm({ ...dsarForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDsarDialog(false)}>Cancel</Button>
            <Button
              disabled={act.isPending || !dsarForm.subjectEmail.trim()}
              onClick={() => act.mutate({
                op: "dsar.create",
                data: {
                  subjectEmail: dsarForm.subjectEmail.trim(),
                  type: dsarForm.type,
                  dueDays: dsarForm.dueDays,
                  notes: dsarForm.notes.trim() || undefined,
                },
              })}
            >
              {act.isPending ? "Recording…" : "Record Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File DMCA Dialog */}
      <Dialog open={dmcaDialog} onOpenChange={setDmcaDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>File DMCA Takedown Notice</DialogTitle>
            <DialogDescription>
              Record an incoming intellectual property infringement notice with SLA tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dmca-complainant">Complainant / Rights Holder</Label>
              <Input
                id="dmca-complainant"
                placeholder="e.g. Legal Dept, Example Corp Ltd"
                value={dmcaForm.complainant}
                onChange={(e) => setDmcaForm({ ...dmcaForm, complainant: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dmca-url">Target URL</Label>
              <Input
                id="dmca-url"
                placeholder="https://docurama.eu/verify/..."
                value={dmcaForm.targetUrl}
                onChange={(e) => setDmcaForm({ ...dmcaForm, targetUrl: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dmca-works">Description of Infringing Works</Label>
              <Textarea
                id="dmca-works"
                rows={2}
                placeholder="Copyrighted document template or proprietary content."
                value={dmcaForm.works}
                onChange={(e) => setDmcaForm({ ...dmcaForm, works: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dmca-sev">Severity</Label>
                <select
                  id="dmca-sev"
                  value={dmcaForm.severity}
                  onChange={(e) => setDmcaForm({ ...dmcaForm, severity: e.target.value })}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="NORMAL">NORMAL (14 days)</option>
                  <option value="HIGH">HIGH (48 hours)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dmca-sla">SLA Days</Label>
                <Input
                  id="dmca-sla"
                  type="number"
                  min={1}
                  max={30}
                  value={dmcaForm.slaDays}
                  onChange={(e) => setDmcaForm({ ...dmcaForm, slaDays: Number(e.target.value) })}
                  className="h-11"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDmcaDialog(false)}>Cancel</Button>
            <Button
              disabled={act.isPending || !dmcaForm.complainant.trim() || !dmcaForm.targetUrl.trim() || !dmcaForm.works.trim()}
              onClick={() => act.mutate({
                op: "dmca.create",
                data: {
                  complainant: dmcaForm.complainant.trim(),
                  targetUrl: dmcaForm.targetUrl.trim(),
                  works: dmcaForm.works.trim(),
                  severity: dmcaForm.severity,
                  slaDays: dmcaForm.slaDays,
                },
              })}
            >
              {act.isPending ? "Recording…" : "File Notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve DMCA dialog */}
      <Dialog open={!!resolveFor} onOpenChange={(v) => !v && setResolveFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve DMCA notice</DialogTitle>
            <DialogDescription>
              {resolveFor?.complainant} - the resolution note is stored verbatim and appears in the audit chain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="resolution-note">Resolution note <span className="text-destructive" aria-hidden>*</span></Label>
            <Textarea
              id="resolution-note" rows={4} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Document disabled, signer and tenant notified, repeat-infringer flag applied to workspace."
              aria-required="true"
            />
            <p className="text-xs text-muted-foreground">{note.length}/500 characters</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveFor(null)}>Cancel</Button>
            <Button
              disabled={!note.trim() || note.length > 500 || act.isPending}
              onClick={() => act.mutateAsync({ op: "resolve-dmca", id: resolveFor!.id, data: { note: note.trim() } }).then(() => setResolveFor(null))}
            >
              {act.isPending ? "Resolving…" : "Resolve notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
