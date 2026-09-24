"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Ban, RotateCcw, ChevronRight, HardDrive, Mail, CalendarClock, Users as UsersIcon, Plus, Pencil } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import {
  Column, ConfirmDialog, CopyableCode, DataTable, PageHeader, StatusBadge, fmtDate, fmtMb, fmtRelative,
} from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type TenantRow = {
  id: string; name: string; slug: string; planCode: string; status: string;
  suspendedReason: string | null; storageUsedMb: number; createdAt: string; trialEndsAt: string | null;
  memberCount: number; envelopeCount: number; domainCount: number; templateCount: number;
  subscription: { id: string; status: string; mrrEur: number; renewalAt: string; seats: number } | null;
};

type TenantDetail = {
  tenant: TenantRow & { billingEmail: string | null; enforceTwoFactor?: boolean };
  members: { id: string; userId: string; role: string; status: string; name: string; email: string; totpEnabled: boolean; lastActiveAt: string | null; createdAt: string }[];
  subscriptions: { id: string; planCode: string; status: string; mrrEur: number; seats: number; renewalAt: string; paymentMethod: string; lastInvoiceAt: string | null; failedPayment: boolean }[];
  domains: { id: string; domain: string; method: string; status: string; verifiedAt: string | null }[];
  counts: { envelopes: number; templates: number; apiKeys: number; webhookEndpoints: number };
  recentEnvelopes: { id: string; publicCode: string; title: string; status: string; createdAt: string; sealedAt: string | null }[];
  statusCounts: { status: string; _count: number }[];
};

const PLANS = [
  { code: "SOLO", label: "Solo - €12/mo · 30 envelopes · 1 seat" },
  { code: "STARTER", label: "Starter - €29/mo · 100 envelopes · 3 seats" },
  { code: "BUSINESS", label: "Business - €79/mo · 250 envelopes · 10 seats" },
  { code: "ENTERPRISE", label: "Enterprise - custom (set negotiated limits and price on the subscription)" },
];

export function AdminTenants() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planDialogFor, setPlanDialogFor] = useState<TenantRow | null>(null);
  const [plan, setPlan] = useState("BUSINESS");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "", slug: "", planCode: "BUSINESS", billingEmail: "", status: "ACTIVE", enforceTwoFactor: false,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", slug: "", billingEmail: "", status: "ACTIVE", storageUsedMb: 0, enforceTwoFactor: false,
  });

  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "tenants", page, search],
    queryFn: () => apiGet<{ rows: TenantRow[]; total: number; perPage: number }>(`/api/admin/tenants?page=${page}&perPage=10&q=${encodeURIComponent(search)}`),
  });

  const detail = useQuery({
    queryKey: ["admin", "tenant-detail", selectedId],
    queryFn: () => apiGet<TenantDetail>(`/api/admin/tenant-detail?id=${selectedId}`),
    enabled: !!selectedId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "tenant-detail"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
  };

  const act = useMutation({
    mutationFn: (vars: { op: string; id: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>(`/api/admin/tenants`, vars),
    onSuccess: (res) => { toast.success(res.message); invalidate(); },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const changePlan = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; message: string }>(`/api/admin/tenants`, { op: "change-plan", id: planDialogFor!.id, data: { plan } }),
    onSuccess: (res) => { toast.success(res.message); setPlanDialogFor(null); invalidate(); },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<TenantRow>[] = [
    {
      key: "name", header: "Tenant",
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{t.name}</p>
          <p className="truncate text-xs text-muted-foreground">{t.slug}.docurama.eu</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (t) => <StatusBadge status={t.planCode} /> },
    { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    {
      key: "usage", header: "Seats / Envelopes",
      render: (t) => (
        <span className="tabular-nums text-sm">
          {t.memberCount} <span className="text-muted-foreground">/</span> {t.envelopeCount}
        </span>
      ),
    },
    {
      key: "mrr", header: "MRR",
      render: (t) => <span className="tabular-nums text-sm">{t.subscription ? `€${t.subscription.mrrEur}` : "-"}</span>,
    },
    { key: "created", header: "Since", render: (t) => <span className="text-sm text-muted-foreground">{fmtDate(t.createdAt)}</span> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-24 text-right",
      render: (t) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="h-11 px-3" onClick={() => setSelectedId(t.id)} aria-label={`Open ${t.name} details`}>
            Manage <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  const t = detail.data?.tenant;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description="Every customer workspace with plan, lifecycle state and usage. Select a tenant to manage it."
        actions={
          <Button
            className="h-11 gap-1.5"
            onClick={() => {
              setCreateForm({ name: "", slug: "", planCode: "BUSINESS", billingEmail: "", status: "ACTIVE", enforceTwoFactor: false });
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Create Workspace
          </Button>
        }
      />

      <DataTable<TenantRow>
        ariaLabel="Tenant list"
        columns={columns}
        rows={data?.rows ?? []}
        total={data?.total}
        page={page}
        perPage={data?.perPage ?? 10}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        searchPlaceholder="Search by name, slug or plan…"
        onRetry={() => refetch()}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyTitle="No tenants match your search"
        emptyDescription="Try a different name, slug or plan tier."
      />

      {/* Tenant detail sheet */}
      <Sheet open={!!selectedId} onOpenChange={(v) => !v && setSelectedId(null)}>
        <SheetContent side="right" aria-describedby={undefined} className="docurama-scroll w-full overflow-y-auto sm:max-w-xl">
          <SheetTitle className="sr-only">Tenant details</SheetTitle>
          {detail.isLoading || !detail.data || !t ? (
            <div className="space-y-4 p-6" aria-busy>
              <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
              <div className="h-48 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : (
            <div className="space-y-6 p-6">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight">{t.name}</h2>
                    <p className="text-xs text-muted-foreground">{t.slug}.docurama.eu · since {fmtDate(t.createdAt)}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                {t.suspendedReason && (
                  <p className="mt-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                    Suspended: {t.suspendedReason}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Members", value: detail.data.members.length },
                  { label: "Envelopes", value: detail.data.counts.envelopes },
                  { label: "Templates", value: detail.data.counts.templates },
                  { label: "MRR", value: `€${detail.data.subscriptions[0]?.mrrEur ?? 0}` },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground"><HardDrive className="h-4 w-4" aria-hidden /> Storage</span>
                  <span className="tabular-nums">{fmtMb(t.storageUsedMb)} / 500 GB</span>
                </div>
                <Progress value={Math.min(100, (t.storageUsedMb / 512000) * 100)} aria-label="Storage used" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 gap-1.5"
                  onClick={() => {
                    setEditForm({
                      name: t.name,
                      slug: t.slug,
                      billingEmail: t.billingEmail || "",
                      status: t.status,
                      storageUsedMb: t.storageUsedMb,
                      enforceTwoFactor: Boolean(t.enforceTwoFactor),
                    });
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden /> Edit workspace
                </Button>
                <Button size="sm" className="h-11" onClick={() => { setPlan(t.planCode); setPlanDialogFor(t); }}>
                  Change plan ({t.planCode})
                </Button>
                {t.status === "SUSPENDED" ? (
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="outline" className="h-11"><RotateCcw className="h-4 w-4" aria-hidden /> Restore access</Button>}
                    title={`Restore ${t.name}?`}
                    description="Members will immediately regain access to signing, templates and verification."
                    confirmLabel="Restore tenant"
                    destructive={false}
                    onConfirm={() => act.mutateAsync({ op: "restore", id: t.id })}
                  />
                ) : (
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="outline" className="h-11 text-destructive hover:text-destructive"><Ban className="h-4 w-4" aria-hidden /> Suspend</Button>}
                    title={`Suspend ${t.name}?`}
                    description="All members lose access immediately. The workspace and its documents are preserved. This action is recorded in the audit trail."
                    confirmLabel="Suspend tenant"
                    requireReason
                    onConfirm={(reason) => act.mutateAsync({ op: "suspend", id: t.id, data: { reason } })}
                  />
                )}
              </div>

              <Separator />

              {/* Subscription */}
              <section aria-labelledby="tenant-sub">
                <h3 id="tenant-sub" className="mb-2 text-sm font-semibold">Subscription</h3>
                {detail.data.subscriptions[0] ? (
                  <div className="space-y-1.5 rounded-lg border bg-card p-3 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><StatusBadge status={detail.data.subscriptions[0].planCode} /></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={detail.data.subscriptions[0].status} /></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Seats</span><span className="tabular-nums">{detail.data.subscriptions[0].seats}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Renews</span><span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{fmtDate(detail.data.subscriptions[0].renewalAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Payment method</span><span className="font-mono text-xs">{detail.data.subscriptions[0].paymentMethod}</span></div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No active subscription (trial or manual invoicing).</p>
                )}
              </section>

              {/* Members */}
              <section aria-labelledby="tenant-members">
                <h3 id="tenant-members" className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <UsersIcon className="h-4 w-4 text-muted-foreground" aria-hidden /> Members
                </h3>
                <ul className="space-y-1.5">
                  {detail.data.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.name} <span className="text-xs font-normal text-muted-foreground">· {m.role}</span></p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {m.totpEnabled && <span className="text-xs text-success" title="Two-factor enabled">2FA ✓</span>}
                        <StatusBadge status={m.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Domains */}
              <section aria-labelledby="tenant-domains">
                <h3 id="tenant-domains" className="mb-2 text-sm font-semibold">Verified domains</h3>
                {detail.data.domains.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No domains registered for DNS attestation.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.data.domains.map((dm) => (
                      <li key={dm.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{dm.domain}</p>
                          <p className="text-xs text-muted-foreground">via {dm.method} · {dm.verifiedAt ? `verified ${fmtDate(dm.verifiedAt)}` : "not verified"}</p>
                        </div>
                        <StatusBadge status={dm.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent envelopes */}
              <section aria-labelledby="tenant-env">
                <h3 id="tenant-env" className="mb-2 text-sm font-semibold">Recent envelopes</h3>
                <ul className="divide-y rounded-lg border bg-card">
                  {detail.data.recentEnvelopes.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{e.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">{e.publicCode} · {fmtRelative(e.createdAt)}</p>
                      </div>
                      <StatusBadge status={e.status} />
                    </li>
                  ))}
                </ul>
              </section>

              {t.billingEmail && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" aria-hidden /> Billing contact: {t.billingEmail}
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Plan change dialog */}
      <Dialog open={!!planDialogFor} onOpenChange={(v) => !v && setPlanDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change plan - {planDialogFor?.name}</DialogTitle>
            <DialogDescription>
              The new quota applies immediately and the subscription MRR is adjusted. Tenants are notified by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label asChild><span className="text-sm">Select plan</span></Label>
            <RadioGroup value={plan} onValueChange={setPlan} className="gap-2">
              {PLANS.map((p) => (
                <label
                  key={p.code}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary-soft/50"
                >
                  <RadioGroupItem value={p.code} />
                  <span className="font-medium">{p.label}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogFor(null)}>Cancel</Button>
            <Button onClick={() => changePlan.mutate()} disabled={changePlan.isPending || plan === planDialogFor?.planCode}>
              {changePlan.isPending ? "Applying…" : "Apply plan change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Workspace Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Customer Workspace</DialogTitle>
            <DialogDescription>
              Provision a new isolated tenant workspace. A default subscription will be initialized.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cw-name">Workspace Name</Label>
              <Input
                id="cw-name"
                value={createForm.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setCreateForm({
                    ...createForm,
                    name,
                    slug: createForm.slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
                  });
                }}
                placeholder="Acme Corp"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-slug">Subdomain / Slug</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="cw-slug"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                  placeholder="acme"
                  className="h-10 font-mono text-sm"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">.docurama.eu</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-plan">Plan Tier</Label>
              <select
                id="cw-plan"
                value={createForm.planCode}
                onChange={(e) => setCreateForm({ ...createForm, planCode: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="SOLO">Solo (€12/mo · 1 seat)</option>
                <option value="STARTER">Starter (€29/mo · 3 seats)</option>
                <option value="BUSINESS">Business (€79/mo · 10 seats)</option>
                <option value="ENTERPRISE">Enterprise (custom — negotiated)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-email">Billing Contact Email (optional)</Label>
              <Input
                id="cw-email"
                type="email"
                value={createForm.billingEmail}
                onChange={(e) => setCreateForm({ ...createForm, billingEmail: e.target.value })}
                placeholder="billing@acme.com"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-status">Initial Status</Label>
              <select
                id="cw-status"
                value={createForm.status}
                onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="TRIALING">TRIALING</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Enforce Two-Factor Authentication</span>
              <Switch
                checked={createForm.enforceTwoFactor}
                onCheckedChange={(v) => setCreateForm({ ...createForm, enforceTwoFactor: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "create", id: "", data: createForm });
                setCreateOpen(false);
              }}
              disabled={act.isPending || !createForm.name.trim()}
            >
              Create Workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Workspace Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Workspace Settings</DialogTitle>
            <DialogDescription>
              Modify workspace parameters, slug, billing contact, or storage quota.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ew-name">Workspace Name</Label>
              <Input
                id="ew-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ew-slug">Subdomain / Slug</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="ew-slug"
                  value={editForm.slug}
                  onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                  className="h-10 font-mono text-sm"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">.docurama.eu</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ew-email">Billing Email</Label>
              <Input
                id="ew-email"
                type="email"
                value={editForm.billingEmail}
                onChange={(e) => setEditForm({ ...editForm, billingEmail: e.target.value })}
                placeholder="billing@example.com"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ew-status">Status</Label>
              <select
                id="ew-status"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="TRIALING">TRIALING</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ew-storage">Storage Used (MB)</Label>
              <Input
                id="ew-storage"
                type="number"
                value={editForm.storageUsedMb}
                onChange={(e) => setEditForm({ ...editForm, storageUsedMb: Number(e.target.value) })}
                className="h-10 font-mono text-sm"
              />
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Enforce Two-Factor Authentication</span>
              <Switch
                checked={editForm.enforceTwoFactor}
                onCheckedChange={(v) => setEditForm({ ...editForm, enforceTwoFactor: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (t) {
                  act.mutate({ op: "update", id: t.id, data: editForm });
                }
                setEditOpen(false);
              }}
              disabled={act.isPending || !editForm.name.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
