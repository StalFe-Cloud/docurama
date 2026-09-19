"use client";

/**
 * Admin: Enterprise leads pipeline (/admin/leads).
 *
 * Leads arrive from the public /enterprise form (status NEW). Admins work the
 * pipeline (status + notes) and convert WON deals into real ENTERPRISE
 * workspaces with negotiated seat/envelope/price overrides on the subscription.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Handshake, Users } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorState, KpiCard, PageHeader, StatusBadge, fmtDate } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { billingPeriod } from "@/lib/billing";

type Lead = {
  id: string; contactName: string; workEmail: string; companyName: string;
  companySize: string | null; country: string | null; monthlyVolume: string | null;
  needs: string | null; preferredDate: string | null; status: string;
  notes: string | null; convertedTenantId: string | null;
  createdAt: string; updatedAt: string;
};

const PIPELINE = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;

export function AdminLeads() {
  const queryClient = useQueryClient();
  const [convertFor, setConvertFor] = useState<Lead | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "leads"],
    queryFn: () => apiGet<{ leads: Lead[] }>("/api/admin/leads"),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/leads", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "leads"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy>
        <PageHeader title="Enterprise leads" description="Pipeline from the public Enterprise form." />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const leads = data.leads;
  const open = leads.filter((l) => !["WON", "LOST"].includes(l.status));
  const won = leads.filter((l) => l.status === "WON");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enterprise leads"
        description="Pipeline fed by the public /enterprise form. Convert a won deal into an ENTERPRISE workspace with negotiated seats, volume and price."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open leads" value={open.length} icon={Handshake} tone={open.length ? "primary" : "success"} sub="Awaiting pipeline action" />
        <KpiCard label="New today" value={leads.filter((l) => Date.now() - new Date(l.createdAt).getTime() < 86400_000).length} sub="Last 24 hours" />
        <KpiCard label="Won" value={won.length} tone="success" sub="Converted to workspaces" />
        <KpiCard label="Lost" value={leads.filter((l) => l.status === "LOST").length} sub="Closed without conversion" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pipeline</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="docurama-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Size / Country</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Arrived</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No leads yet - submissions from /enterprise land here.
                    </TableCell>
                  </TableRow>
                )}
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <p className="font-medium">{l.companyName}</p>
                      {l.needs && <p className="max-w-[220px] truncate text-xs text-muted-foreground" title={l.needs}>{l.needs}</p>}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{l.contactName}</p>
                      <p className="text-xs text-muted-foreground">{l.workEmail}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[l.companySize, l.country].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{l.monthlyVolume ?? "—"}</TableCell>
                    <TableCell>
                      <Select value={l.status} onValueChange={(v) => act.mutate({ op: "status", id: l.id, data: { status: v } })}>
                        <SelectTrigger className="h-9 w-36" aria-label={`Status of ${l.companyName}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PIPELINE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(l.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {l.convertedTenantId ? (
                        <StatusBadge status="WON" />
                      ) : (
                        <Button size="sm" className="h-11" onClick={() => setConvertFor(l)}>
                          <Building2 className="h-4 w-4" aria-hidden /> Convert
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConvertDialog
        lead={convertFor}
        onClose={() => setConvertFor(null)}
        onConvert={(payload) =>
          act.mutateAsync({ op: "convert", id: convertFor!.id, data: payload }).then(() => setConvertFor(null))
        }
        pending={act.isPending}
      />
    </div>
  );
}

function ConvertDialog({
  lead, onClose, onConvert, pending,
}: {
  lead: Lead | null; onClose: () => void;
  onConvert: (payload: { seats: number; envelopes: number; priceEur: number; billingMonths: number }) => void;
  pending: boolean;
}) {
  const [seats, setSeats] = useState(100);
  const [envelopes, setEnvelopes] = useState(5000);
  const [priceEur, setPriceEur] = useState(400);
  const [billingMonths, setBillingMonths] = useState(12);

  if (!lead) return null;
  return (
    <Dialog open={Boolean(lead)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden /> Convert {lead.companyName}
          </DialogTitle>
          <DialogDescription>
            Creates an ENTERPRISE workspace with negotiated limits. {lead.contactName} ({lead.workEmail}) receives an
            owner invitation and completes onboarding through the wizard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cv-seats">Seats</Label>
            <Input id="cv-seats" type="number" min={1} max={5000} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-env">Envelopes / month</Label>
            <Input id="cv-env" type="number" min={10} max={100000} step={10} value={envelopes} onChange={(e) => setEnvelopes(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-price">Price (€ / month, list)</Label>
            <Input id="cv-price" type="number" min={0} max={100000} value={priceEur} onChange={(e) => setPriceEur(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Term</Label>
            <Select value={String(billingMonths)} onValueChange={(v) => setBillingMonths(Number(v))}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Monthly</SelectItem>
                <SelectItem value="3">3 months · −5%</SelectItem>
                <SelectItem value="6">6 months · −10%</SelectItem>
                <SelectItem value="12">12 months · −15%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Overrides apply per deal on the subscription; the public ENTERPRISE plan defaults stay untouched.
          {billingMonths > 1 && ` Effective monthly after the ${billingPeriod(billingMonths).discountPct}% prepay discount: €${Math.round(priceEur * (1 - billingPeriod(billingMonths).discountPct / 100))}.`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => onConvert({ seats, envelopes, priceEur, billingMonths })}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
