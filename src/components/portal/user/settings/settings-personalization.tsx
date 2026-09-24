"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp, Mail, PartyPopper, RotateCcw, Save, Trash2 } from "lucide-react";
import { apiGet } from "@/lib/client";
import { ErrorState } from "@/components/portal/shared";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EDITABLE_EMAILS, EMAIL_LABELS, EMAIL_VARIABLES, MAX_BODY, MAX_SUBJECT, renderEmail,
  type EditableEmail, type EmailOverrides,
} from "@/lib/email-templates";
import { useSettingsAct, ToggleRow } from "./settings-shared";

type Data = {
  workspaceName: string;
  logoUrl: string | null;
  emailTemplates: EmailOverrides;
  emailDefaults: Record<EditableEmail, { subject: string; body: string }>;
  completedMessage: string; redirectUrl: string; redirectLabel: string; confetti: boolean;
};

/**
 * Settings > Personalization: the workspace logo, the wording of the emails
 * signers and senders receive, and what a signer sees after signing.
 */
export function PersonalizationTab() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workspace", "settings-personalization"],
    queryFn: () => apiGet<Data>("/api/workspace/settings-personalization"),
  });
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <LogoCard data={data} />
      <WordingCards data={data} />
    </div>
  );
}

function LogoCard({ data }: { data: Data }) {
  const act = useSettingsAct(["settings-personalization"]);
  const input = useRef<HTMLInputElement>(null);

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("Use a PNG, JPEG or WebP image"); return; }
    if (file.size > 256 * 1024) { toast.error("The logo must be under 256 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => act.mutate({ op: "personalization.logo", data: { image: String(reader.result) } });
    reader.readAsDataURL(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageUp className="h-4 w-4 text-muted-foreground" aria-hidden /> Company logo
        </CardTitle>
        <CardDescription>
          Shown on your signing pages and at the top of every email your recipients get. PNG, JPEG or WebP, under 256 KB;
          a wide logo about 400 × 100 pixels looks best.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-56 items-center justify-center rounded-lg border bg-background p-3">
          {data.logoUrl
            ? <img src={data.logoUrl} alt={`${data.workspaceName} logo`} className="max-h-14 max-w-full object-contain" />
            : <span className="text-sm text-muted-foreground">No logo yet</span>}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Logo file"
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="flex gap-2">
          <Button className="h-11" disabled={act.isPending} onClick={() => input.current?.click()}>
            <ImageUp className="h-4 w-4" aria-hidden /> {data.logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {data.logoUrl && (
            <Button variant="outline" className="h-11" disabled={act.isPending} onClick={() => act.mutate({ op: "personalization.logo", data: { image: null } })}>
              <Trash2 className="h-4 w-4" aria-hidden /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const SAMPLE = {
  "recipient.name": "Camille Laurent", "recipient.email": "camille.laurent@example.com",
  "sender.name": "Alexandra Fischer", "sender.email": "alexandra@stalfe.example",
  "document.title": "Supply agreement 2026", "document.code": "DOC-7F3A92C1",
  "message": "Hello Camille, here is the agreement we discussed.",
  "verify.link": "https://verify.docurama.eu/?code=DOC-7F3A92C1",
};

function WordingCards({ data }: { data: Data }) {
  const act = useSettingsAct(["settings-personalization"]);
  const [templates, setTemplates] = useState<Record<EditableEmail, { subject: string; body: string }>>(() =>
    Object.fromEntries(EDITABLE_EMAILS.map((k) => [k, {
      subject: data.emailTemplates[k]?.subject ?? data.emailDefaults[k].subject,
      body: data.emailTemplates[k]?.body ?? data.emailDefaults[k].body,
    }])) as Record<EditableEmail, { subject: string; body: string }>);
  const [after, setAfter] = useState({
    completedMessage: data.completedMessage, redirectUrl: data.redirectUrl, redirectLabel: data.redirectLabel, confetti: data.confetti,
  });

  const save = () => act.mutate({ op: "personalization.save", data: { emailTemplates: templates, ...after } });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden /> Email templates
          </CardTitle>
          <CardDescription>
            Plain text with placeholders in double braces. The signing or download link is always included, as a button,
            even if you leave {"{{link}}"} out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Accordion type="single" collapsible className="rounded-lg border px-3">
            {EDITABLE_EMAILS.map((kind) => (
              <AccordionItem key={kind} value={kind}>
                <AccordionTrigger className="text-sm">
                  <span className="text-left">
                    {EMAIL_LABELS[kind].title}
                    {(templates[kind].subject !== data.emailDefaults[kind].subject || templates[kind].body !== data.emailDefaults[kind].body) && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Customised</span>
                    )}
                    <span className="block text-xs font-normal text-muted-foreground">{EMAIL_LABELS[kind].desc}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <TemplateEditor
                    kind={kind} value={templates[kind]} defaults={data.emailDefaults[kind]}
                    workspaceName={data.workspaceName} logoUrl={data.logoUrl}
                    onChange={(v) => setTemplates({ ...templates, [kind]: v })}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Available placeholders</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {EMAIL_VARIABLES.map((v) => (
                <li key={v.key}><code className="rounded bg-muted px-1 font-mono">{`{{${v.key}}}`}</code> {v.desc}</li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PartyPopper className="h-4 w-4 text-muted-foreground" aria-hidden /> After signing
          </CardTitle>
          <CardDescription>What a signer sees once they have signed. Everything here is optional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-message">Message</Label>
            <Textarea id="p-message" rows={3} maxLength={1000} value={after.completedMessage}
              onChange={(e) => setAfter({ ...after, completedMessage: e.target.value })}
              placeholder="Thank you! Our team will countersign within one business day." />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <Label htmlFor="p-label">Button label</Label>
              <Input id="p-label" className="h-11" maxLength={40} value={after.redirectLabel}
                onChange={(e) => setAfter({ ...after, redirectLabel: e.target.value })} placeholder="Back to our website" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-url">Button link</Label>
              <Input id="p-url" className="h-11" inputMode="url" value={after.redirectUrl}
                onChange={(e) => setAfter({ ...after, redirectUrl: e.target.value })} placeholder="https://yourcompany.com/thanks" />
            </div>
          </div>
          <ToggleRow checked={after.confetti} onCheckedChange={(v) => setAfter({ ...after, confetti: v })}
            label="Confetti" desc="A short celebration when someone signs (skipped for people who turned animations off)" />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="h-11" disabled={act.isPending} onClick={save}>
          <Save className="h-4 w-4" aria-hidden /> Save personalization
        </Button>
      </div>
    </>
  );
}

function TemplateEditor({ kind, value, defaults, workspaceName, logoUrl, onChange }: {
  kind: EditableEmail; value: { subject: string; body: string }; defaults: { subject: string; body: string };
  workspaceName: string; logoUrl: string | null; onChange: (v: { subject: string; body: string }) => void;
}) {
  const preview = useMemo(() => renderEmail(kind, {
    ...SAMPLE, "workspace.name": workspaceName,
    link: kind === "copy" ? "https://app.docurama.eu/api/sign/…/signed-pdf" : kind === "completed" ? "https://app.docurama.eu/documents" : "https://app.docurama.eu/sign/…",
  }, { overrides: { [kind]: value }, logoUrl, brandName: workspaceName }), [kind, value, workspaceName, logoUrl]);
  const changed = value.subject !== defaults.subject || value.body !== defaults.body;

  return (
    <div className="grid gap-4 pb-2 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={`${kind}-subject`}>Subject</Label>
          <Input id={`${kind}-subject`} className="h-11" maxLength={MAX_SUBJECT} value={value.subject}
            onChange={(e) => onChange({ ...value, subject: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${kind}-body`}>Body</Label>
          <Textarea id={`${kind}-body`} rows={10} maxLength={MAX_BODY} className="font-mono text-xs" value={value.body}
            onChange={(e) => onChange({ ...value, body: e.target.value })} />
        </div>
        {changed && (
          <Button variant="ghost" size="sm" onClick={() => onChange(defaults)}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset to default
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Preview (sample data)</p>
        <p className="truncate rounded-md border bg-muted/40 px-3 py-2 text-sm"><span className="text-muted-foreground">Subject: </span>{preview.subject}</p>
        <iframe title={`${EMAIL_LABELS[kind].title} preview`} srcDoc={preview.html} sandbox="" className="h-80 w-full rounded-md border bg-white" />
      </div>
    </div>
  );
}
