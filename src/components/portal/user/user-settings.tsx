"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  User as UserIcon, Building2, Bell, PenTool, KeyRound, Users, Trash2, Plus, Save, HardDrive,
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ConfirmDialog, CopyableCode, ErrorState, PageHeader, StatusBadge, fmtDate, fmtMb, cn } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SettingsData = {
  profile: { firstName: string; lastName: string; email: string; totpEnabled: boolean; signatureName: string; signatureStyle: string };
  org: { name: string; slug: string; planCode: string; billingEmail: string | null; createdAt: string; storageUsedMb: number };
  plan: { name: string; envelopeLimit: number; seatLimit: number; storageGb: number; monthlyEur: number } | null;
  subscription: { id: string; status: string; mrrEur: number; seats: number; renewalAt: string; paymentMethod: string } | null;
  notifications: {
    emailOnSend: boolean; emailOnSign: boolean; emailOnComplete: boolean; emailOnDecline: boolean;
    smsEnabled: boolean; smsProvider: string; smsAccountSid: string; smsAuthToken: string; smsSenderName: string;
    maxReminders: number; reminderSubject: string; digestWeekly: boolean;
  };
  apiKeys: { id: string; name: string; prefix: string; scope: string; status: string; lastUsedAt: string | null; createdAt: string }[];
  members: { id: string; role: string; name: string; email: string; status: string; totpEnabled: boolean }[];
};

type Act = ReturnType<typeof useAct>;

function useAct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { op: string; id?: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/workspace/settings", vars),
    onSuccess: (res) => {
      // Success feedback only on success — the original UI showed a green
      // "saved" banner even when the request had failed.
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["workspace", "settings"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

const SIGNATURE_FONTS = [
  { key: "signature-font-caveat", label: "Caveat" },
  { key: "signature-font-dancing", label: "Dancing Script" },
  { key: "signature-font-greatvibes", label: "Great Vibes" },
];

// ── Tab bodies: each initialises its form state from the server snapshot ──

function ProfileTab({ data, act }: { data: SettingsData; act: Act }) {
  const [profile, setProfile] = useState({ firstName: data.profile.firstName, lastName: data.profile.lastName });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserIcon className="h-4 w-4 text-muted-foreground" aria-hidden /> Your profile
        </CardTitle>
        <CardDescription>Both name fields are persisted — and shown again on your next visit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-first">First name</Label>
            <Input id="p-first" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-last">Last name</Label>
            <Input id="p-last" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" value={data.profile.email} disabled className="h-11" />
            <p className="text-xs text-muted-foreground">Contact Docurama support to change your sign-in email.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Two-factor authentication</Label>
            <div className="flex h-11 items-center">
              {data.profile.totpEnabled
                ? <span className="flex items-center gap-1.5 text-sm text-success">Enabled — authenticator app</span>
                : <span className="text-sm text-muted-foreground">Not enabled</span>}
            </div>
          </div>
        </div>
        <Button
          className="h-11"
          disabled={!profile.firstName.trim() || !profile.lastName.trim() || act.isPending}
          onClick={() => act.mutate({ op: "save-profile", data: profile })}
        >
          <Save className="h-4 w-4" aria-hidden /> Save profile
        </Button>
      </CardContent>
    </Card>
  );
}

function SignatureTab({ data, act }: { data: SettingsData; act: Act }) {
  const [signature, setSignature] = useState({
    signatureName: data.profile.signatureName,
    signatureStyle: data.profile.signatureStyle || "signature-font-caveat",
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PenTool className="h-4 w-4 text-muted-foreground" aria-hidden /> Signature &amp; stamps
        </CardTitle>
        <CardDescription>
          This is the exact stamp that will be affixed to documents you sign — rendered with the same bundled font used at seal time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="sig-name">Signature name</Label>
          <Input id="sig-name" value={signature.signatureName} onChange={(e) => setSignature({ ...signature, signatureName: e.target.value })} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label>Style</Label>
          <div className="grid gap-3 sm:grid-cols-3">
            {SIGNATURE_FONTS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSignature({ ...signature, signatureStyle: f.key })}
                aria-pressed={signature.signatureStyle === f.key}
                className={cn(
                  "flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  signature.signatureStyle === f.key ? "border-primary bg-primary-soft/40" : "hover:bg-muted/60",
                )}
              >
                <span className={cn("text-2xl text-foreground", f.key)}>{signature.signatureName || "Your name"}</span>
                <span className="text-xs text-muted-foreground">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
        {/* True preview — the saved stamp itself, not a decorative squiggle */}
        <div className="rounded-xl border bg-card p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview — exactly what gets affixed</p>
          <div className="flex items-end justify-between border-b border-dashed pb-4">
            <span className={cn("text-4xl leading-none text-foreground", signature.signatureStyle)}>
              {signature.signatureName || "Your name"}
            </span>
            <span className="text-xs text-muted-foreground">Drawn with {SIGNATURE_FONTS.find((f) => f.key === signature.signatureStyle)?.label}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Fonts are bundled with the app (no CDN) — the signature on the legal document always matches this preview.
          </p>
        </div>
        <Button
          className="h-11"
          disabled={!signature.signatureName.trim() || act.isPending}
          onClick={() => act.mutate({ op: "save-signature", data: signature })}
        >
          <Save className="h-4 w-4" aria-hidden /> Save signature
        </Button>
      </CardContent>
    </Card>
  );
}

function OrgTab({ data, act }: { data: SettingsData; act: Act }) {
  const [org, setOrg] = useState({ name: data.org.name, billingEmail: data.org.billingEmail ?? "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden /> Organisation
        </CardTitle>
        <CardDescription>Workspace identity used on signing pages, certificates and invoices.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="o-name">Organisation name</Label>
            <Input id="o-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-billing">Billing email</Label>
            <Input id="o-billing" type="email" value={org.billingEmail} onChange={(e) => setOrg({ ...org, billingEmail: e.target.value })} className="h-11" placeholder="finance@company.com" />
          </div>
        </div>
        <Button className="h-11" disabled={!org.name.trim() || act.isPending} onClick={() => act.mutate({ op: "save-org", data: org })}>
          <Save className="h-4 w-4" aria-hidden /> Save organisation
        </Button>
        <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Plan</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium"><StatusBadge status={data.org.planCode} /> {data.plan?.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Storage</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden /> {fmtMb(data.org.storageUsedMb)} of {data.plan?.storageGb ?? 50} GB</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Renews</p>
            <p className="mt-1 text-sm font-medium">{data.subscription ? fmtDate(data.subscription.renewalAt) : "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationsTab({ initial, act }: { initial: SettingsData["notifications"]; act: Act }) {
  const [notif, setNotif] = useState(initial);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-muted-foreground" aria-hidden /> Email notifications
          </CardTitle>
          <CardDescription>Every preference below is persisted and applied to future envelopes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {([
            ["emailOnSend", "When a document is sent", "Confirmation after dispatching each envelope"],
            ["emailOnSign", "When someone signs", "Progress notification as each party signs"],
            ["emailOnComplete", "When a document completes", "Final sealed document and certificate"],
            ["emailOnDecline", "When someone declines", "Immediate notice with the decline reason"],
            ["digestWeekly", "Weekly digest", "Monday summary of pending and completed documents"],
          ] as const).map(([key, label, desc]) => (
            <label key={key} className="flex min-h-14 items-center justify-between gap-4 rounded-lg border p-3">
              <span className="text-sm">
                {label}
                <span className="block text-xs font-normal text-muted-foreground">{desc}</span>
              </span>
              <Switch checked={notif[key] as boolean} onCheckedChange={(v) => setNotif({ ...notif, [key]: v })} aria-label={label} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">SMS delivery (signer verification)</CardTitle>
          <CardDescription>
            All fields — including the auth token — are sent to the server and reloaded on your next visit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex min-h-14 items-center justify-between gap-4 rounded-lg border p-3">
            <span className="text-sm">
              Enable SMS verification
              <span className="block text-xs font-normal text-muted-foreground">Send one-time codes to signers on their phone</span>
            </span>
            <Switch checked={notif.smsEnabled} onCheckedChange={(v) => setNotif({ ...notif, smsEnabled: v })} aria-label="Enable SMS verification" />
          </label>

          {notif.smsEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sms-sid">Account SID</Label>
                <Input id="sms-sid" value={notif.smsAccountSid} onChange={(e) => setNotif({ ...notif, smsAccountSid: e.target.value })} className="h-11 font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-token">Auth token <span className="text-destructive" aria-hidden>*</span></Label>
                <Input
                  id="sms-token" type="password" value={notif.smsAuthToken}
                  onChange={(e) => setNotif({ ...notif, smsAuthToken: e.target.value })}
                  className="h-11 font-mono text-sm" autoComplete="off" aria-required="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-sender">Sender name</Label>
                <Input id="sms-sender" value={notif.smsSenderName} onChange={(e) => setNotif({ ...notif, smsSenderName: e.target.value })} className="h-11" maxLength={11} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-reminders">Maximum reminders per envelope</Label>
                <Input id="sms-reminders" type="number" min={0} max={10} value={notif.maxReminders} onChange={(e) => setNotif({ ...notif, maxReminders: Number(e.target.value) })} className="h-11" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sms-subject">Reminder email subject</Label>
                <Input id="sms-subject" value={notif.reminderSubject} onChange={(e) => setNotif({ ...notif, reminderSubject: e.target.value })} className="h-11" />
                <p className="text-xs text-muted-foreground">Supports the {"{{document}}"} placeholder.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <Button
          className="h-11"
          disabled={act.isPending}
          onClick={() => act.mutate({ op: "save-notifications", data: notif as unknown as Record<string, unknown> })}
        >
          <Save className="h-4 w-4" aria-hidden /> Save notification settings
        </Button>
      </div>
    </>
  );
}

function KeysTab({ data, act }: { data: SettingsData; act: Act }) {
  const [keyDialog, setKeyDialog] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: "", scope: "READONLY" });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden /> API keys
          </CardTitle>
          <CardDescription>Scoped credentials for server-to-server integrations. Revocation is per-key.</CardDescription>
        </div>
        <Button size="sm" className="h-11" onClick={() => setKeyDialog(true)}>
          <Plus className="h-4 w-4" aria-hidden /> New key
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {data.apiKeys.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No API keys — create one to use the Docurama REST API.</p>
        ) : (
          <ul className="divide-y">
            {data.apiKeys.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">created {fmtDate(k.createdAt)} · last used {k.lastUsedAt ? fmtDate(k.lastUsedAt) : "never"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CopyableCode value={k.prefix} max={14} />
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.scope}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={k.status} />
                  {k.status === "ACTIVE" && (
                    <ConfirmDialog
                      trigger={<Button variant="outline" size="sm" className="h-11 text-destructive hover:text-destructive">Revoke</Button>}
                      title={`Revoke ${k.prefix}?`}
                      description="Requests using this key are rejected immediately. Your other keys keep working."
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

      <Dialog open={keyDialog} onOpenChange={setKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>The full secret is displayed once — store it securely.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wkey-name">Key name</Label>
              <Input id="wkey-name" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="e.g. CRM integration" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wkey-scope">Scope</Label>
              <Select value={keyForm.scope} onValueChange={(v) => setKeyForm({ ...keyForm, scope: v })}>
                <SelectTrigger id="wkey-scope" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="READONLY">Read-only</SelectItem>
                  <SelectItem value="ENVELOPES">Envelopes</SelectItem>
                  <SelectItem value="TEMPLATES">Templates</SelectItem>
                  <SelectItem value="FULL">Full access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialog(false)}>Cancel</Button>
            <Button onClick={() => { act.mutate({ op: "create-key", data: keyForm }); setKeyDialog(false); }} disabled={!keyForm.name.trim() || act.isPending}>
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TeamTab({ data, act }: { data: SettingsData; act: Act }) {
  const [invite, setInvite] = useState({ email: "", role: "MEMBER" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden /> Team members
        </CardTitle>
        <CardDescription>{data.members.length} of {data.plan?.seatLimit ?? 10} seats used.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Invite by email</Label>
            <Input id="invite-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="colleague@company.com" className="h-11" />
          </div>
          <div className="w-full space-y-1.5 sm:w-44">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={invite.role} onValueChange={(v) => setInvite({ ...invite, role: v })}>
              <SelectTrigger id="invite-role" className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="ADMIN">Workspace admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="h-11" disabled={!invite.email.includes("@") || act.isPending} onClick={() => act.mutate({ op: "invite-member", data: invite })}>
            <Plus className="h-4 w-4" aria-hidden /> Invite
          </Button>
        </div>
        <ul className="divide-y rounded-lg border">
          {data.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.name} <span className="ml-1.5 text-xs font-normal capitalize text-muted-foreground">{m.role.toLowerCase()}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.totpEnabled && <span className="text-xs text-success">2FA ✓</span>}
                <StatusBadge status={m.status} />
                {m.role !== "OWNER" && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive" aria-label={`Remove ${m.name}`} title="Remove member">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    }
                    title={`Remove ${m.name}?`}
                    description="They immediately lose access to this workspace. Their past documents remain in the audit trail."
                    confirmLabel="Remove member"
                    onConfirm={() => act.mutateAsync({ op: "remove-member", id: m.id })}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function UserSettings() {
  const [tab, setTab] = useState("profile");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workspace", "settings"],
    queryFn: () => apiGet<SettingsData>("/api/workspace/settings"),
  });
  const act = useAct();

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return <div className="space-y-6" aria-busy><PageHeader title="Settings" /><div className="h-72 animate-pulse rounded-xl bg-muted" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Profile, workspace, notifications, signature and integrations. Every field you edit here is persisted — and reloaded exactly as saved."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11 flex-wrap">
          <TabsTrigger value="profile" className="min-h-9">Profile</TabsTrigger>
          <TabsTrigger value="signature" className="min-h-9">Signature</TabsTrigger>
          <TabsTrigger value="org" className="min-h-9">Organisation</TabsTrigger>
          <TabsTrigger value="notifications" className="min-h-9">Notifications</TabsTrigger>
          <TabsTrigger value="keys" className="min-h-9">API keys</TabsTrigger>
          <TabsTrigger value="team" className="min-h-9">Team</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><ProfileTab data={data} act={act} /></TabsContent>
        <TabsContent value="signature"><SignatureTab data={data} act={act} /></TabsContent>
        <TabsContent value="org"><OrgTab data={data} act={act} /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab initial={data.notifications} act={act} /></TabsContent>
        <TabsContent value="keys"><KeysTab data={data} act={act} /></TabsContent>
        <TabsContent value="team"><TeamTab data={data} act={act} /></TabsContent>
      </Tabs>
    </div>
  );
}
