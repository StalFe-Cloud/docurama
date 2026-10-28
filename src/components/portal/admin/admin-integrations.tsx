"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Webhook, Zap, Pause, Play, Trash2, Send, Copy, Plus } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ConfirmDialog, CopyableCode, ErrorState, PageHeader, StatusBadge, fmtRelative } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type IntegrationsData = {
  apiKeys: { id: string; tenantName: string; name: string; prefix: string; scope: string; status: string; createdBy: string; lastUsedAt: string | null; createdAt: string }[];
  webhooks: { id: string; tenantName: string; url: string; events: string; status: string; secretMasked: string; successRate: number; lastDeliveryAt: string | null; createdAt: string }[];
  deliveries: { id: string; url: string; event: string; statusCode: number; durationMs: number; success: boolean; at: string }[];
  allTenants?: { id: string; name: string; slug: string }[];
};

const EVENT_TYPES = ["envelope.created", "envelope.sent", "recipient.signed", "envelope.completed", "envelope.declined", "envelope.voided", "template.used"];

export function AdminIntegrations() {
  const [tab, setTab] = useState("keys");
  const [keyDialog, setKeyDialog] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScope, setKeyScope] = useState("READONLY");

  const [webhookDialog, setWebhookDialog] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookTenantId, setWebhookTenantId] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("*");

  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "integrations"],
    queryFn: () => apiGet<IntegrationsData>("/api/admin/integrations"),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id?: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/integrations", vars),
    onSuccess: (res) => {
      if (res.message.includes("HTTP 500")) toast.warning(res.message);
      else toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const createKey = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; message: string }>("/api/admin/integrations", { op: "create-key", data: { name: keyName, scope: keyScope } }),
    onSuccess: (res) => {
      toast.success(res.message);
      setKeyDialog(false); setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const createWebhook = useMutation({
    mutationFn: () =>
      apiPost<{ ok: boolean; message: string; rawSecret?: string }>("/api/admin/integrations", {
        op: "create-webhook",
        data: {
          url: webhookUrl,
          tenantId: webhookTenantId || (data?.allTenants?.[0]?.id ?? ""),
          events: webhookEvents,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.message);
      if (res.rawSecret) {
        toast.info(`Signing secret: ${res.rawSecret}`, { duration: 10000 });
      }
      setWebhookDialog(false);
      setWebhookUrl("");
      queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const tenants = data?.allTenants ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="API & Webhooks"
        description="Per-key credential lifecycle and webhook delivery operations. Revocation is per-key - never a destructive bulk rotation."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-11" onClick={() => setWebhookDialog(true)}>
              <Webhook className="h-4 w-4" aria-hidden /> Register endpoint
            </Button>
            <Button size="sm" className="h-11" onClick={() => setKeyDialog(true)}>
              <KeyRound className="h-4 w-4" aria-hidden /> New API key
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11">
          <TabsTrigger value="keys" className="min-h-9">API keys</TabsTrigger>
          <TabsTrigger value="webhooks" className="min-h-9">Webhook endpoints</TabsTrigger>
          <TabsTrigger value="deliveries" className="min-h-9">Delivery log</TabsTrigger>
        </TabsList>

        {/* API keys */}
        <TabsContent value="keys">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
              ) : (
                <ul className="divide-y">
                  {(data?.apiKeys ?? []).map((k) => (
                    <li key={k.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{k.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {k.tenantName} · by {k.createdBy} · created {fmtRelative(k.createdAt)} · last used {fmtRelative(k.lastUsedAt)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <CopyableCode value={k.prefix} max={16} />
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.scope}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={k.status} />
                        {k.status === "ACTIVE" && (
                          <ConfirmDialog
                            trigger={
                              <Button variant="outline" size="sm" className="h-11 text-destructive hover:text-destructive" aria-label={`Revoke key ${k.prefix}`}>
                                Revoke
                              </Button>
                            }
                            title={`Revoke ${k.prefix}?`}
                            description="API requests signed with this key are rejected immediately. Other keys for this workspace are unaffected."
                            confirmLabel="Revoke key"
                            onConfirm={() => act.mutateAsync({ op: "revoke-key", id: k.id })}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Webhooks */}
        <TabsContent value="webhooks">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Configured Webhook Endpoints</CardTitle>
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setWebhookDialog(true)}>
                <Plus className="h-4 w-4" /> Register Endpoint
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>
              ) : (data?.webhooks ?? []).length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No webhook endpoints registered.</p>
              ) : (
                <ul className="divide-y">
                  {data!.webhooks.map((h) => (
                    <li key={h.id} className="space-y-3 p-4">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            <Webhook className="h-4 w-4 text-muted-foreground" aria-hidden />
                            <span className="truncate">{h.url}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {h.tenantName} · {h.successRate}% success · last delivery {fmtRelative(h.lastDeliveryAt)} · secret {h.secretMasked}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {h.events.split("|").map((ev) => (
                              <span key={ev} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{ev}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <StatusBadge status={h.status} />
                          <Button
                            size="sm" variant="outline" className="h-11"
                            onClick={() => act.mutate({ op: "test-webhook", id: h.id })}
                            disabled={act.isPending}
                            aria-label={`Send test event to ${h.url}`}
                          >
                            <Send className="h-4 w-4" aria-hidden /> Test
                          </Button>
                          {h.status === "ACTIVE" ? (
                            <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "pause-webhook", id: h.id })}>
                              <Pause className="h-4 w-4" aria-hidden /> Pause
                            </Button>
                          ) : h.status !== "DELETED" ? (
                            <Button size="sm" variant="outline" className="h-11" onClick={() => act.mutate({ op: "resume-webhook", id: h.id })}>
                              <Play className="h-4 w-4" aria-hidden /> Resume
                            </Button>
                          ) : null}
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive" aria-label={`Delete webhook ${h.url}`} title="Delete endpoint">
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            }
                            title="Delete this endpoint?"
                            description={`${h.url} stops receiving events immediately. Delivery history is retained for audit purposes.`}
                            confirmLabel="Delete endpoint"
                            onConfirm={() => act.mutateAsync({ op: "delete-webhook", id: h.id })}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deliveries */}
        <TabsContent value="deliveries">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-6" aria-busy>{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
              ) : (
                <div className="docurama-scroll overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Webhook delivery log">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th scope="col" className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">When</th>
                        <th scope="col" className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Event</th>
                        <th scope="col" className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Endpoint</th>
                        <th scope="col" className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Result</th>
                        <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.deliveries ?? []).map((dl) => (
                        <tr key={dl.id} className="border-b last:border-0">
                          <td className="px-4 py-3 text-muted-foreground">{fmtRelative(dl.at)}</td>
                          <td className="px-4 py-3 font-mono text-xs">{dl.event}</td>
                          <td className="max-w-[280px] truncate px-4 py-3 text-muted-foreground">{dl.url}</td>
                          <td className="px-4 py-3">
                            <span className={dl.success ? "text-success" : "text-destructive"}>
                              HTTP {dl.statusCode} {dl.success ? "✓" : "✗"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{dl.durationMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create key dialog */}
      <Dialog open={keyDialog} onOpenChange={setKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create platform API key</DialogTitle>
            <DialogDescription>
              Scope the key to the minimum needed. The full secret is shown once at creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key name</Label>
              <Input id="key-name" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Internal ops tooling" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-scope">Scope</Label>
              <Select value={keyScope} onValueChange={setKeyScope}>
                <SelectTrigger id="key-scope" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="READONLY">Read-only - list and verify</SelectItem>
                  <SelectItem value="ENVELOPES">Envelopes - create and manage</SelectItem>
                  <SelectItem value="TEMPLATES">Templates - manage templates</SelectItem>
                  <SelectItem value="FULL">Full access - everything</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialog(false)}>Cancel</Button>
            <Button onClick={() => createKey.mutate()} disabled={!keyName.trim() || createKey.isPending}>
              {createKey.isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register Webhook Dialog */}
      <Dialog open={webhookDialog} onOpenChange={setWebhookDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register Webhook Endpoint</DialogTitle>
            <DialogDescription>
              Receive real-time HTTPS HMAC-signed event notifications for signing activities and workflow events.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-tenant">Target Workspace</Label>
              <select
                id="hook-tenant"
                value={webhookTenantId || (tenants[0]?.id ?? "")}
                onChange={(e) => setWebhookTenantId(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-url">Payload HTTPS URL</Label>
              <Input
                id="hook-url"
                placeholder="https://api.yourcompany.com/webhooks/docurama"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-events">Events to Subscribe</Label>
              <Input
                id="hook-events"
                placeholder="* or envelope.completed|recipient.signed"
                value={webhookEvents}
                onChange={(e) => setWebhookEvents(e.target.value)}
                className="h-11 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Use <code className="text-foreground font-mono">*</code> for all events, or pipe-separate types like <code className="text-foreground font-mono">envelope.completed|recipient.signed</code>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWebhookDialog(false)}>Cancel</Button>
            <Button
              disabled={createWebhook.isPending || !webhookUrl.trim() || !webhookUrl.startsWith("https://")}
              onClick={() => createWebhook.mutate()}
            >
              {createWebhook.isPending ? "Registering…" : "Register Endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
