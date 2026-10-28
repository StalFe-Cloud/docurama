"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake, Search, Sparkles, Plus } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorState, KpiCard, PageHeader, StatusBadge, fmtDate } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Lead = {
  id: string; company: string; contactName: string; email: string; phone: string | null;
  seats: number; monthlyEnvelopes: number; requirements: string;
  status: string; notes: string; createdAt: string; updatedAt: string;
};

type LeadsData = {
  total: number;
  leads: Lead[];
  kpis: { newCount: number; wonCount: number };
};

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"];

/**
 * Enterprise pipeline console (cycle 10): leads submitted from the public
 * /enterprise onboarding page or recorded directly by platform admin.
 * Triage statuses + notes; every change is audited server-side.
 */
export function AdminLeads() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    company: "",
    contactName: "",
    email: "",
    phone: "",
    seats: 10,
    monthlyEnvelopes: 500,
    requirements: "",
    status: "NEW",
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "leads", search, statusFilter],
    queryFn: () =>
      apiGet<LeadsData>(`/api/admin/leads?q=${encodeURIComponent(search)}&status=${statusFilter}&perPage=50`),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id?: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/leads", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      setAddOpen(false);
      setForm({ company: "", contactName: "", email: "", phone: "", seats: 10, monthlyEnvelopes: 500, requirements: "", status: "NEW" });
      queryClient.invalidateQueries({ queryKey: ["admin", "leads"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-6" aria-busy>
        <PageHeader title="Enterprise leads" description="Enterprise pipeline from the /enterprise page." />
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enterprise leads"
        description="Prospects from the /enterprise onboarding page or inbound sales. Triage them through the guided-onboarding pipeline: contact → pilot → security review → rollout."
        actions={
          <Button size="sm" className="h-11 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Lead
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="New, waiting for first reply" value={data.kpis.newCount} icon={Sparkles} sub="Reply within one business day (the page promises it)" />
        <KpiCard label="In the pipeline" value={data.total} icon={Handshake} sub="All statuses except LOST" />
        <KpiCard label="Won rollouts" value={data.kpis.wonCount} icon={Handshake} sub="Enterprise customers onboarded" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact or email"
                className="pl-9"
                aria-label="Search leads"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {data.leads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No leads yet. The public /enterprise page feeds this pipeline, or you can record inbound leads above.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.leads.map((l) => (
                <li key={l.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{l.company}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.contactName} · <a className="underline underline-offset-2" href={`mailto:${l.email}`}>{l.email}</a>
                        {l.phone && <> · {l.phone}</>} · {fmtDate(l.createdAt)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l.seats > 0 ? `${l.seats} seats` : "seats not specified"}
                        {" · "}
                        {l.monthlyEnvelopes > 0 ? `${l.monthlyEnvelopes.toLocaleString("en-GB")} envelopes/month` : "volume not specified"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={l.status}
                        onValueChange={(v) => act.mutate({ op: "lead.status", id: l.id, data: { status: v } })}
                      >
                        <SelectTrigger className="h-9 w-36 text-xs" aria-label={`Status for ${l.company}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline" size="sm" className="h-9"
                        onClick={() => { setOpenId(openId === l.id ? null : l.id); setNoteDraft({ ...noteDraft, [l.id]: l.notes }); }}
                        aria-expanded={openId === l.id}
                      >
                        {openId === l.id ? "Hide notes" : "Notes"}
                      </Button>
                    </div>
                  </div>

                  {l.requirements && (
                    <p className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                      {l.requirements}
                    </p>
                  )}

                  {openId === l.id && (
                    <div className="mt-3 space-y-2 rounded-lg border p-3">
                      <Label htmlFor={`note-${l.id}`}>Triage notes (next step, pilot status, who replied…)</Label>
                      <Textarea
                        id={`note-${l.id}`} rows={3} maxLength={2000}
                        value={noteDraft[l.id] ?? l.notes}
                        onChange={(e) => setNoteDraft({ ...noteDraft, [l.id]: e.target.value })}
                      />
                      <Button
                        size="sm" disabled={act.isPending}
                        onClick={() => act.mutate({ op: "lead.note", id: l.id, data: { notes: noteDraft[l.id] ?? l.notes } })}
                      >
                        Save note
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Lead Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Enterprise Lead</DialogTitle>
            <DialogDescription>
              Record an inbound enterprise or partner prospect into the sales triage pipeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead-co">Company Name</Label>
              <Input
                id="lead-co"
                placeholder="e.g. TotalEnergies Renewables SAS"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lead-contact">Contact Name</Label>
                <Input
                  id="lead-contact"
                  placeholder="Claire Dupont"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-email">Work Email</Label>
                <Input
                  id="lead-email"
                  type="email"
                  placeholder="claire@totalenergies.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lead-phone">Phone</Label>
                <Input
                  id="lead-phone"
                  placeholder="+33 1 47 44 45 46"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-seats">Seats</Label>
                <Input
                  id="lead-seats"
                  type="number"
                  min={1}
                  value={form.seats}
                  onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-vol">Monthly Volume</Label>
                <Input
                  id="lead-vol"
                  type="number"
                  min={10}
                  value={form.monthlyEnvelopes}
                  onChange={(e) => setForm({ ...form, monthlyEnvelopes: Number(e.target.value) })}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-req">Requirements / Notes</Label>
              <Textarea
                id="lead-req"
                rows={2}
                placeholder="e.g. Dedicated Azure France tenant, Entra ID SSO, eIDAS Qualified signatures."
                value={form.requirements}
                onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={act.isPending || !form.company.trim() || !form.contactName.trim() || !form.email.trim()}
              onClick={() => act.mutate({ op: "lead.create", data: form })}
            >
              {act.isPending ? "Adding…" : "Add Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
