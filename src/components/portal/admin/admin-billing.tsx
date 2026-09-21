"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Ban, CreditCard, Loader2, RotateCcw, TrendingUp, Plus, Pencil } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ConfirmDialog, ErrorState, KpiCard, PageHeader, StatusBadge, fmtDate } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PlanItem = {
  id: string; code: string; name: string; monthlyEur: number; seatLimit: number;
  envelopeLimit: number; storageGb: number; apiAccess: boolean; slaUptime: string;
  support: string; features: string; outcomes?: string | null; active?: boolean;
};

type BillingData = {
  plans: PlanItem[];
  subscriptions: { id: string; tenantName: string; tenantSlug: string; tenantStatus: string; planCode: string; status: string; mrrEur: number; seats: number; renewalAt: string; paymentMethod: string; lastInvoiceAt: string | null; failedPayment: boolean }[];
  mrrTrend: { date: string; mrrEur: number }[];
  payments: {
    id: string; tenantName: string; tenantSlug: string; provider: string; kind: string; planCode: string;
    termMonths: number; amountCents: number; currency: string; status: string; reference: string | null;
    description: string; createdAt: string; paidAt: string | null; approverNote: string | null;
  }[];
  pendingPayments: number;
};

export function AdminBilling() {
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [createPlanForm, setCreatePlanForm] = useState({
    code: "", name: "", monthlyEur: 49, seatLimit: 5, envelopeLimit: 150, storageGb: 15,
    apiAccess: false, slaUptime: "99.5%", support: "Email", features: "Core signing|Audit trail",
    outcomes: "Accelerate standard contract workflows", active: true,
  });

  const [editPlan, setEditPlan] = useState<PlanItem | null>(null);
  const [editPlanForm, setEditPlanForm] = useState({
    name: "", monthlyEur: 0, seatLimit: 1, envelopeLimit: 10, storageGb: 5,
    apiAccess: false, slaUptime: "99.5%", support: "Community", features: "",
    outcomes: "", active: true,
  });

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "billing"],
    queryFn: () => apiGet<BillingData>("/api/admin/billing"),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/billing", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy>
        <PageHeader title="Billing" description="Plans, subscriptions and revenue." />
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
      </div>
    );
  }

  const activeMrr = data.subscriptions.filter((s) => s.status === "ACTIVE").reduce((a, s) => a + s.mrrEur, 0);
  const failed = data.subscriptions.filter((s) => s.failedPayment);
  const chartData = data.mrrTrend.map((m) => ({
    ...m,
    day: new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    mrr: m.mrrEur,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Plan catalogue, subscription lifecycle and revenue trends. Plan changes flow through the tenant console."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active MRR" value={`€${activeMrr.toLocaleString()}`} icon={TrendingUp} tone="primary" sub="Monthly recurring revenue" />
        <KpiCard label="ARR (run-rate)" value={`€${(activeMrr * 12).toLocaleString()}`} sub="Projected annual" />
        <KpiCard label="Subscriptions" value={data.subscriptions.length} icon={CreditCard} sub={`${data.subscriptions.filter((s) => s.status === "ACTIVE").length} active`} />
        <KpiCard label="Pending transfers" value={data.pendingPayments} tone={data.pendingPayments ? "warning" : "success"} sub={data.pendingPayments ? "Bank transfers awaiting approval" : "Nothing awaiting approval"} />
      </div>

      {/* Manual payments awaiting approval (bank-transfer mode) */}
      {data.payments.some((p) => p.status === "PENDING") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bank transfers awaiting approval</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="docurama-scroll overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Plan / term</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.filter((p) => p.status === "PENDING").map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.reference}</code></TableCell>
                      <TableCell className="max-w-[180px]"><p className="truncate font-medium">{p.tenantName}</p></TableCell>
                      <TableCell>{p.description}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">€{(p.amountCents / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <ConfirmDialog
                            trigger={
                              <Button variant="outline" size="sm" className="h-11" aria-label={`Approve payment ${p.reference} for ${p.tenantName}`}>
                                <BadgeCheck className="h-4 w-4" aria-hidden /> Approve
                              </Button>
                            }
                            title={`Approve ${p.reference}?`}
                            description={`Confirm the bank transfer of €${(p.amountCents / 100).toFixed(2)} for ${p.tenantName} has been received. The plan activates immediately for ${p.termMonths} month(s).`}
                            confirmLabel="Approve & activate"
                            requireReason
                            reasonLabel="Bank reference / receipt"
                            onConfirm={(note) => act.mutateAsync({ op: "payment.approve", id: p.id, data: { note } })}
                          />
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm" className="h-11 text-destructive hover:text-destructive" aria-label={`Cancel payment ${p.reference}`}>
                                Decline
                              </Button>
                            }
                            title={`Decline ${p.reference}?`}
                            description="The payment request is marked canceled. The tenant keeps its current plan and sees the cancellation in billing history."
                            confirmLabel="Decline request"
                            requireReason
                            onConfirm={(reason) => act.mutateAsync({ op: "payment.cancel", id: p.id, data: { note: reason } })}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">MRR trend - last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56" role="img" aria-label="Area chart of monthly recurring revenue over the last 30 days">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f7a5a" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0f7a5a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
                <ChartTooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                  formatter={(value: number) => [`€${value.toLocaleString()}`, "MRR"]}
                />
                <Area type="monotone" dataKey="mrr" stroke="#0f7a5a" strokeWidth={2} fill="url(#mrrFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Subscriptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="docurama-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead>Renews</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-[200px]">
                      <p className="truncate font-medium">{s.tenantName}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.paymentMethod}</p>
                    </TableCell>
                    <TableCell><StatusBadge status={s.planCode} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={s.status} />
                        {s.failedPayment && <span className="text-xs text-destructive">payment failed</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.seats}</TableCell>
                    <TableCell className="text-right tabular-nums">€{s.mrrEur}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(s.renewalAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {s.failedPayment && (
                          <Button
                            variant="outline" size="sm" className="h-11"
                            onClick={() => act.mutate({ op: "retry-payment", id: s.id })}
                            aria-label={`Retry payment for ${s.tenantName}`}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden /> Retry
                          </Button>
                        )}
                        {s.status === "ACTIVE" && (
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm" className="h-11 text-destructive hover:text-destructive" aria-label={`Cancel subscription of ${s.tenantName}`}>
                                Cancel
                              </Button>
                            }
                            title={`Cancel ${s.tenantName}?`}
                            description="The subscription ends at the current period. The workspace drops to read-only when the period lapses."
                            confirmLabel="Cancel at period end"
                            requireReason
                            onConfirm={(reason) => act.mutateAsync({ op: "cancel-subscription", id: s.id, data: { reason } })}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Plan catalogue</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Pricing tiers, envelope quotas, and feature allocations.</p>
          </div>
          <Button
            size="sm"
            className="h-10 gap-1.5"
            onClick={() => {
              setCreatePlanForm({
                code: "", name: "", monthlyEur: 49, seatLimit: 5, envelopeLimit: 150, storageGb: 15,
                apiAccess: false, slaUptime: "99.5%", support: "Email", features: "Core signing|Audit trail",
                outcomes: "Accelerate standard contract workflows", active: true,
              });
              setCreatePlanOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> New Plan
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {data.plans.map((p) => (
              <div key={p.id} className="flex flex-col justify-between space-y-3 rounded-xl border bg-card p-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={p.code} />
                    <p className="text-lg font-semibold">€{p.monthlyEur}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{p.name}</h4>
                    {p.outcomes && <p className="text-xs text-muted-foreground mt-0.5">{p.outcomes}</p>}
                  </div>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li>{p.envelopeLimit.toLocaleString()} envelopes / month</li>
                    <li>{p.seatLimit} seats · {p.storageGb} GB storage</li>
                    <li>{p.apiAccess ? "API + webhooks" : "No API access"}</li>
                    <li>{p.slaUptime} SLA · {p.support}</li>
                  </ul>
                  {p.features && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {p.features.split("|").map((f) => (
                        <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1 text-xs"
                    onClick={() => {
                      setEditPlan(p);
                      setEditPlanForm({
                        name: p.name,
                        monthlyEur: p.monthlyEur,
                        seatLimit: p.seatLimit,
                        envelopeLimit: p.envelopeLimit,
                        storageGb: p.storageGb,
                        apiAccess: p.apiAccess,
                        slaUptime: p.slaUptime,
                        support: p.support,
                        features: p.features,
                        outcomes: p.outcomes || "",
                        active: p.active ?? true,
                      });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit Plan
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create Plan Dialog */}
      <Dialog open={createPlanOpen} onOpenChange={setCreatePlanOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Subscription Plan</DialogTitle>
            <DialogDescription>
              Define a new commercial or custom tier with specific quotas and feature flags.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-code">Plan Code</Label>
                <Input
                  id="cp-code"
                  value={createPlanForm.code}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, code: e.target.value.toUpperCase() })}
                  placeholder="GROWTH"
                  className="h-10 font-mono text-xs uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-name">Plan Name</Label>
                <Input
                  id="cp-name"
                  value={createPlanForm.name}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, name: e.target.value })}
                  placeholder="Growth Tier"
                  className="h-10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-eur">Monthly Price (€)</Label>
                <Input
                  id="cp-eur"
                  type="number"
                  value={createPlanForm.monthlyEur}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, monthlyEur: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-seats">Seat Limit</Label>
                <Input
                  id="cp-seats"
                  type="number"
                  value={createPlanForm.seatLimit}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, seatLimit: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-env">Envelopes / Month</Label>
                <Input
                  id="cp-env"
                  type="number"
                  value={createPlanForm.envelopeLimit}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, envelopeLimit: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-storage">Storage (GB)</Label>
                <Input
                  id="cp-storage"
                  type="number"
                  value={createPlanForm.storageGb}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, storageGb: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-sla">SLA Uptime</Label>
                <Input
                  id="cp-sla"
                  value={createPlanForm.slaUptime}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, slaUptime: e.target.value })}
                  placeholder="99.9%"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-support">Support Tier</Label>
                <Input
                  id="cp-support"
                  value={createPlanForm.support}
                  onChange={(e) => setCreatePlanForm({ ...createPlanForm, support: e.target.value })}
                  placeholder="Priority Email"
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-features">Features (pipe-separated)</Label>
              <Input
                id="cp-features"
                value={createPlanForm.features}
                onChange={(e) => setCreatePlanForm({ ...createPlanForm, features: e.target.value })}
                placeholder="Core signing|Audit trail|API access|Dedicated IP"
                className="h-10 font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-outcomes">Outcome Summary</Label>
              <Input
                id="cp-outcomes"
                value={createPlanForm.outcomes}
                onChange={(e) => setCreatePlanForm({ ...createPlanForm, outcomes: e.target.value })}
                placeholder="Accelerate high-volume contract execution"
                className="h-10 text-xs"
              />
            </div>

            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">REST API &amp; Webhooks Access</span>
              <Switch
                checked={createPlanForm.apiAccess}
                onCheckedChange={(v) => setCreatePlanForm({ ...createPlanForm, apiAccess: v })}
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Active (Visible in Portal)</span>
              <Switch
                checked={createPlanForm.active}
                onCheckedChange={(v) => setCreatePlanForm({ ...createPlanForm, active: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePlanOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "create-plan", id: "", data: createPlanForm });
                setCreatePlanOpen(false);
              }}
              disabled={act.isPending || !createPlanForm.code.trim() || !createPlanForm.name.trim()}
            >
              Create Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Plan Dialog */}
      <Dialog open={!!editPlan} onOpenChange={(v) => !v && setEditPlan(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Plan - {editPlan?.name} ({editPlan?.code})</DialogTitle>
            <DialogDescription>
              Update pricing, capacity limits, and capabilities for this tier.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Plan Name</Label>
              <Input
                id="ep-name"
                value={editPlanForm.name}
                onChange={(e) => setEditPlanForm({ ...editPlanForm, name: e.target.value })}
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-eur">Monthly Price (€)</Label>
                <Input
                  id="ep-eur"
                  type="number"
                  value={editPlanForm.monthlyEur}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, monthlyEur: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-seats">Seat Limit</Label>
                <Input
                  id="ep-seats"
                  type="number"
                  value={editPlanForm.seatLimit}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, seatLimit: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-env">Envelopes / Month</Label>
                <Input
                  id="ep-env"
                  type="number"
                  value={editPlanForm.envelopeLimit}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, envelopeLimit: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-storage">Storage (GB)</Label>
                <Input
                  id="ep-storage"
                  type="number"
                  value={editPlanForm.storageGb}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, storageGb: Number(e.target.value) })}
                  className="h-10 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-sla">SLA Uptime</Label>
                <Input
                  id="ep-sla"
                  value={editPlanForm.slaUptime}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, slaUptime: e.target.value })}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-support">Support Tier</Label>
                <Input
                  id="ep-support"
                  value={editPlanForm.support}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, support: e.target.value })}
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ep-features">Features (pipe-separated)</Label>
              <Input
                id="ep-features"
                value={editPlanForm.features}
                onChange={(e) => setEditPlanForm({ ...editPlanForm, features: e.target.value })}
                className="h-10 font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ep-outcomes">Outcome Summary</Label>
              <Input
                id="ep-outcomes"
                value={editPlanForm.outcomes}
                onChange={(e) => setEditPlanForm({ ...editPlanForm, outcomes: e.target.value })}
                className="h-10 text-xs"
              />
            </div>

            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">REST API &amp; Webhooks Access</span>
              <Switch
                checked={editPlanForm.apiAccess}
                onCheckedChange={(v) => setEditPlanForm({ ...editPlanForm, apiAccess: v })}
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Active (Visible in Portal)</span>
              <Switch
                checked={editPlanForm.active}
                onCheckedChange={(v) => setEditPlanForm({ ...editPlanForm, active: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editPlan) {
                  act.mutate({ op: "save-plan", id: editPlan.id, data: editPlanForm });
                }
                setEditPlan(null);
              }}
              disabled={act.isPending || !editPlanForm.name.trim()}
            >
              Save Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
