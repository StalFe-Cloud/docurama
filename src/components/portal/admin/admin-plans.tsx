"use client";

/**
 * Admin: plan editor (/admin/plans).
 *
 * Edits the live Plan rows the quota engine enforces. Prices and limits take
 * effect immediately for every tenant on that plan (existing windows keep
 * their anchor; the next renewal picks up the new values). The canonical
 * definitions live in src/lib/billing.ts — this editor covers negotiated
 * adjustments without a code change.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorState, PageHeader, StatusBadge } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PlanRow = {
  id: string; code: string; name: string; monthlyEur: number; seatLimit: number;
  envelopeLimit: number; storageGb: number; apiAccess: boolean; periodDays: number;
  customPricing: boolean; slaUptime: string; support: string; features: string;
};

export function AdminPlans() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => apiGet<{ plans: PlanRow[] }>("/api/admin/plans"),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/plans", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "plans"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy>
        <PageHeader title="Plan editor" description="Live plan values enforced by the quota engine." />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan editor"
        description="Live values the quota engine enforces. Changes apply on the next billing window for existing tenants and immediately for new signups. Canonical definitions live in src/lib/billing.ts."
      />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((p) => (
          <PlanCard
            key={`${p.id}:${p.name}:${p.monthlyEur}:${p.seatLimit}:${p.envelopeLimit}:${p.storageGb}:${p.periodDays}:${p.apiAccess}:${p.customPricing}`}
            plan={p}
            onSave={(data2) => act.mutate({ op: "update", id: p.id, data: data2 })}
            pending={act.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, onSave, pending }: { plan: PlanRow; onSave: (data: Record<string, unknown>) => void; pending: boolean }) {
  const [form, setForm] = useState({
    name: plan.name, monthlyEur: plan.monthlyEur, seatLimit: plan.seatLimit,
    envelopeLimit: plan.envelopeLimit, storageGb: plan.storageGb,
    periodDays: plan.periodDays, apiAccess: plan.apiAccess, customPricing: plan.customPricing,
  });
  // NOTE: the parent keys this card on the server-side plan values, so a
  // save/refetch remounts it with fresh state — no setState-in-effect.

  const dirty =
    form.name !== plan.name || form.monthlyEur !== plan.monthlyEur ||
    form.seatLimit !== plan.seatLimit || form.envelopeLimit !== plan.envelopeLimit ||
    form.storageGb !== plan.storageGb || form.periodDays !== plan.periodDays ||
    form.apiAccess !== plan.apiAccess || form.customPricing !== plan.customPricing;

  return (
    <Card className={cn(dirty && "border-primary/50")}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <StatusBadge status={plan.code} />
          <span className="text-xs text-muted-foreground">{plan.slaUptime} SLA</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-name`}>Display name</Label>
            <Input id={`p-${plan.code}-name`} value={form.name} maxLength={40}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-price`}>Price (€/mo)</Label>
            <Input id={`p-${plan.code}-price`} type="number" min={0} disabled={form.customPricing}
              value={form.customPricing ? 0 : form.monthlyEur}
              onChange={(e) => setForm({ ...form, monthlyEur: Number(e.target.value) })} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-seats`}>Seats</Label>
            <Input id={`p-${plan.code}-seats`} type="number" min={1} max={5000} value={form.seatLimit}
              onChange={(e) => setForm({ ...form, seatLimit: Number(e.target.value) })} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-env`}>Envelopes</Label>
            <Input id={`p-${plan.code}-env`} type="number" min={10} max={100000} value={form.envelopeLimit}
              onChange={(e) => setForm({ ...form, envelopeLimit: Number(e.target.value) })} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-storage`}>Storage (GB)</Label>
            <Input id={`p-${plan.code}-storage`} type="number" min={1} max={5000} value={form.storageGb}
              onChange={(e) => setForm({ ...form, storageGb: Number(e.target.value) })} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${plan.code}-period`}>Month length</Label>
            <select id={`p-${plan.code}-period`} value={form.periodDays}
              onChange={(e) => setForm({ ...form, periodDays: Number(e.target.value) })}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value={30}>30 days (standard)</option>
              <option value={35}>35 days (weekends on us)</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.apiAccess} onChange={(e) => setForm({ ...form, apiAccess: e.target.checked })}
              className="h-4 w-4" />
            API + webhooks
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.customPricing} onChange={(e) => setForm({ ...form, customPricing: e.target.checked })}
              className="h-4 w-4" />
            Custom pricing (price hidden, sales-negotiated)
          </label>
        </div>
        <Button size="sm" className="w-full" disabled={!dirty || pending}
          onClick={() => onSave({ ...form, monthlyEur: form.customPricing ? 0 : form.monthlyEur })}>
          <Save className="h-4 w-4" aria-hidden /> {dirty ? "Save plan" : "No changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
