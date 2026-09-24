"use client";

/**
 * Public signer portal — the recipient-facing signing experience.
 *
 * This is the anonymous face of /sign/{token}: no account, no session, the
 * 32-byte token in the URL is the authentication. The full state machine is
 * resolved server-side (see src/app/sign/[token]/page.tsx) and arrives as a
 * serializable snapshot; this component renders each phase and drives the
 * sign / decline actions against /api/sign/{token}.
 *
 * Design goals (competitive teardown: DocuSign's 11-step Wizard vs Dropbox
 * Sign's one-pager): everything on ONE page — document, adopt-signature,
 * consent, sign — finishable in under a minute on a phone. Every state
 * change lands in the envelope event ledger server-side.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import {
  BadgeCheck, Ban, CheckCircle2, ChevronLeft, Clock, FileSignature, FileText,
  Loader2, Lock, PenLine, ShieldCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BrandLogo } from "@/components/brand/logo";
import { MarketingHomeLink } from "@/components/brand/home-link";
import { PortalProviders } from "@/components/portal/providers";
import { SignDocumentPreview, type SignDocument } from "@/components/marketing/sign-document-preview";
import { SignatureAdopter, SIGNATURE_FONTS, type Adoption, type SavedSignature } from "@/components/marketing/signature-adopter";
import { celebrate } from "@/components/marketing/confetti";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { checkFieldEntry, fieldLabel, fieldOptions, isEnteredField } from "@/lib/field-kinds";
import { cn } from "@/lib/utils";

export type SignPageState =
  | { phase: "invalid" }
  | { phase: "terminal"; status: string; title: string; code: string; voidReason: string | null }
  | { phase: "cc"; title: string; code: string; tenantName: string; recipientName: string }
  | { phase: "signed"; title: string; code: string; tenantName: string; recipientName: string; sealed: boolean; hasDocument?: boolean; document: SignDocument | null }
  | { phase: "completed"; title: string; code: string; tenantName: string }
  | { phase: "wait"; title: string; code: string; tenantName: string; aheadName: string; document: SignDocument | null }
  | {
      phase: "active";
      /** Signed in with the address this document was sent to. */
      signedIn?: boolean;
      savedSignature?: SavedSignature | null;
      title: string; code: string; tenantName: string;
      message: string | null; pages: number; senderName: string;
      senderDomainVerified: string | null;
      recipientName: string; recipientEmail: string;
      signers: { name: string; email: string; status: string; order: number }[];
      bodyMarkdown: string | null;
      document: { filename: string; pages: number; sha256: string } | null;
      fields?: Array<{
        id: string; type: string; pageNumber: number; x: number; y: number; width: number; height: number;
        recipientEmail: string; recipientName: string; label?: string; value?: string;
        options?: string[]; required?: boolean; mustTick?: boolean;
      }>;
    };

/** The sending workspace's Personalization (logo, after-signing message and button, confetti). */
export type SignBrand = {
  logoUrl: string | null; name: string;
  completedMessage: string | null; redirectUrl: string | null; redirectLabel: string | null; confetti: boolean;
};

export function PublicSign({ token, state, brand = null }: { token: string; state: SignPageState; brand?: SignBrand | null }) {
  return (
    <PortalProviders>
      <SignInner token={token} state={state} brand={brand} />
    </PortalProviders>
  );
}

function SignInner({ token, state, brand }: { token: string; state: SignPageState; brand: SignBrand | null }) {
  const [phase, setPhase] = useState(state.phase);
  const [name, setName] = useState(state.phase === "active" ? state.recipientName : "");
  const [font, setFont] = useState<string>("caveat");
  const saved = state.phase === "active" ? state.savedSignature ?? null : null;
  const [adoption, setAdoption] = useState<Adoption>({ method: saved ? "saved" : "type", image: null });
  const [saveSignature, setSaveSignature] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sealed starts from the SERVER truth: a signer revisiting their link after
  // everyone signed must see the sealed state immediately, not a stale
  // "still pending" (the local flag only flips it earlier for in-session signs).
  const [sealed, setSealed] = useState(state.phase === "signed" ? state.sealed : false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const viewed = useRef(false);

  // Fields the sender placed for THIS signer (text, number, dropdown, radio,
  // checkbox): filled here, checked with the rules the server applies again
  // (src/lib/field-kinds.ts), and recorded in the sealed evidence.
  const myFields = state.phase === "active"
    ? (state.fields ?? []).filter((f) => isEnteredField(f) && f.recipientEmail.toLowerCase() === state.recipientEmail.toLowerCase())
    : [];
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => Object.fromEntries(
    myFields.map((f) => [f.id, state.phase === "active" && f.type === "text" && /name|nom/i.test(f.label ?? "") ? state.recipientName : ""]),
  ));
  const setField = (id: string, value: string) => setFieldValues((prev) => ({ ...prev, [id]: value }));

  // First open of an active link records VIEWED + DELIVERED (idempotent
  // server-side: only fires for PENDING recipients).
  useEffect(() => {
    if (viewed.current || state.phase !== "active") return;
    viewed.current = true;
    fetch(`/api/sign/${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "view" }),
    }).catch(() => undefined);
  }, [state.phase, token]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; sealed?: boolean };
    if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
    return body;
  };

  const sign = async () => {
    if (!name.trim() || name.trim().length < 2) { setError("Please type your full name to sign."); return; }
    if (!consent) { setError("Please confirm you have read and agree to sign electronically."); return; }
    for (const f of myFields) {
      const entry = checkFieldEntry(f, fieldValues[f.id]);
      if (!entry.ok) { setError(`${entry.error} It is on page ${f.pageNumber}.`); return; }
    }
    if ((adoption.method === "draw" || adoption.method === "upload") && !adoption.image) {
      setError(adoption.method === "draw" ? "Draw your signature, or choose Type." : "Upload an image of your signature, or choose Type.");
      return;
    }
    setBusy("sign"); setError(null);
    try {
      const r = await post({
        op: "sign", name: name.trim(), font,
        signature: { method: adoption.method, image: adoption.image },
        saveSignature,
        fieldValues: Object.fromEntries(myFields.map((f) => [f.id, f.type === "checkbox" ? fieldValues[f.id] === "Yes" : (fieldValues[f.id] ?? "").trim()])),
      });
      setSealed(!!r.sealed);
      setPhase("signed");
      if (brand?.confetti) celebrate();
    } catch (e) { setError(e instanceof Error ? e.message : "Signing failed"); }
    finally { setBusy(null); }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      await post({ op: "decline", reason: declineReason });
      setDeclineOpen(false);
      setPhase("terminal");
    } catch (e) { setError(e instanceof Error ? e.message : "Declining failed"); }
    finally { setBusy(null); }
  };

  const activeFont = SIGNATURE_FONTS.find((f) => f.key === (adoption.method === "saved" && saved?.font ? saved.font : font)) ?? SIGNATURE_FONTS[0];
  const previewImage = adoption.method === "saved" ? (saved?.method === "image" ? saved.value : null) : adoption.image;

  // Narrowed views for the JSX below: `phase` (local, changes after actions)
  // and `state.phase` (server snapshot) are separate — TS needs the latter
  // narrowed before field access.
  const terminalState = state.phase === "terminal" ? state : null;
  const signedState: Extract<SignPageState, { phase: "signed" }> | Extract<SignPageState, { phase: "active" }> | null =
    state.phase === "signed" || state.phase === "active" ? (state as Extract<SignPageState, { phase: "signed" }> | Extract<SignPageState, { phase: "active" }>) : null;
  const declinedTitle = state.phase === "active" ? state.title : "this document";

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          {brand?.logoUrl
            ? <img src={brand.logoUrl} alt={brand.name} className="max-h-10 max-w-[180px] object-contain" />
            : <MarketingHomeLink newTab><BrandLogo /></MarketingHomeLink>}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Secure signing</span>
            <span className="rounded-md bg-muted px-2 py-1 font-mono">{state.phase !== "invalid" ? state.code : "—"}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* ── invalid link ─────────────────────────────────────────────── */}
        {phase === "invalid" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-destructive" aria-hidden />
              <h1 className="text-xl font-semibold">This signing link is not valid</h1>
              <p className="text-sm text-muted-foreground">
                The link may have been mistyped, or the invitation was voided by the sender.
                Please use the exact link from your invitation email.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── terminal (voided / declined / expired) ────────────────────── */}
        {phase === "terminal" && terminalState && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-semibold">This document is no longer available for signing</h1>
              <p className="text-sm text-muted-foreground">
                Status: <span className="font-medium text-foreground">{terminalState.status.toLowerCase()}</span>
                {" · "}{terminalState.title}
                {terminalState.voidReason ? ` — ${terminalState.voidReason}` : ""}
              </p>
            </CardContent>
          </Card>
        )}
        {phase === "terminal" && !terminalState && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-destructive" aria-hidden />
              <h1 className="text-xl font-semibold">You declined to sign</h1>
              <p className="text-sm text-muted-foreground">
                The sender has been notified that you declined <span className="font-medium text-foreground">{declinedTitle}</span>.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── cc recipient ─────────────────────────────────────────────── */}
        {state.phase === "cc" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Users className="mx-auto h-10 w-10 text-primary" aria-hidden />
              <h1 className="text-xl font-semibold">You receive a copy of this document</h1>
              <p className="text-sm text-muted-foreground">
                {state.recipientName}, you are in copy of <span className="font-medium text-foreground">{state.title}</span>
                {" "}sent by {state.tenantName}. You will get the completed document once every signer has signed.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── already signed ───────────────────────────────────────────── */}
        {phase === "signed" && signedState && (
          <div className="space-y-6">
          <Card className="mx-auto max-w-lg text-center">
            <CardContent className="space-y-4 p-8">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
              </span>
              <h1 className="text-2xl font-semibold">Document signed</h1>
              <p className="text-sm text-muted-foreground">
                {signedState.recipientName} signed
                {" "}<span className="font-medium text-foreground">{signedState.title}</span>.
                {sealed
                  ? " All parties have signed — the envelope is sealed and verifiable."
                  : " Other signers are still pending; you will receive the completed document once everyone has signed."}
              </p>
              {brand?.completedMessage && (
                <p className="whitespace-pre-line rounded-lg bg-muted/60 p-3 text-sm" data-testid="completed-message">{brand.completedMessage}</p>
              )}
              {brand?.redirectUrl && (
                <Button asChild className="h-11">
                  <a href={brand.redirectUrl} rel="noopener noreferrer" data-testid="completed-redirect">{brand.redirectLabel || `Continue to ${brand.name}`}</a>
                </Button>
              )}
              {sealed && (
                <div className="rounded-lg border bg-card p-4 text-left">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Envelope sealed
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verification code <span className="font-mono text-foreground">{signedState.code}</span> — anyone
                    can confirm the seal on the public portal, no account needed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" asChild>
                      {/* Link, not a plain anchor: client-side navigation keeps the
                          transition instant (no full reload) on the success screen. */}
                      <Link href={`/verify?code=${encodeURIComponent(signedState.code)}`}>
                        <BadgeCheck className="h-4 w-4" aria-hidden /> Verify the seal
                      </Link>
                    </Button>
                    {(state.phase === "active" ? !!state.document || !!state.bodyMarkdown : state.phase === "signed" && state.hasDocument === true) && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/api/sign/${encodeURIComponent(token)}/signed-pdf`} data-testid="download-signed-pdf">
                        <FileText className="h-4 w-4" aria-hidden /> Download the signed PDF
                      </a>
                    </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          {state.phase === "signed" && state.document && state.document.pages > 0 && (
            <SignDocumentPreview token={token} document={state.document} />
          )}
          </div>
        )}

        {/* ── completed by everyone (late visitor) ──────────────────────── */}
        {state.phase === "completed" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
              <h1 className="text-xl font-semibold">This document is fully signed</h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{state.title}</span> was completed and sealed.
                Verify it with code <span className="font-mono">{state.code}</span>.
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/verify?code=${encodeURIComponent(state.code)}`}>Open the verification portal</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── waiting for earlier signer ───────────────────────────────── */}
        {state.phase === "wait" && (
          <div className="space-y-6">
            <Card className="mx-auto max-w-md text-center">
              <CardContent className="space-y-3 p-8">
                <Clock className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
                <h1 className="text-xl font-semibold">It is not your turn to sign yet</h1>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{state.aheadName}</span> signs before you on
                  {" "}<span className="font-medium text-foreground">{state.title}</span>.
                  Keep this link — it becomes active as soon as they have signed.
                </p>
              </CardContent>
            </Card>
            {state.document && state.document.pages > 0 && (
              <SignDocumentPreview token={token} document={state.document} />
            )}
          </div>
        )}

        {/* ── active signing experience ────────────────────────────────── */}
        {phase === "active" && state.phase === "active" && (
          <div className="space-y-6">
            {/* Document card */}
            <Card>
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                      <FileText className="h-3.5 w-3.5" aria-hidden /> Document for your signature
                    </p>
                    <h1 className="text-2xl font-semibold tracking-tight">{state.title}</h1>
                    <p className="text-sm text-muted-foreground">
                      Sent by <span className="font-medium text-foreground">{state.tenantName}</span>
                      {" · "}{state.document ? state.document.pages : state.pages} page{(state.document ? state.document.pages : state.pages) > 1 ? "s" : ""}
                    </p>
                    {state.senderDomainVerified && (
                      <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        Sender domain verified via DNS TXT: {state.senderDomainVerified}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 font-mono text-xs">{state.code}</span>
                </div>

                {state.message && (
                  <div className="mt-4 rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs font-medium text-muted-foreground">Message from the sender</p>
                    <p className="mt-1 text-sm">{state.message}</p>
                  </div>
                )}

                {state.document && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{state.document.filename}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">SHA-256 {state.document.sha256.slice(0, 32)}…</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600">
                      <ShieldCheck className="h-3 w-3" aria-hidden /> Integrity verified
                    </span>
                  </div>
                )}

                {/* Signers rail */}
                <div className="mt-5">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden /> Signers
                  </p>
                  <ol className="space-y-1.5">
                    {state.signers.map((s) => (
                      <li key={s.order} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary" aria-hidden>{s.order}</span>
                          <span className="truncate font-medium">{s.name}</span>
                        </span>
                        <span className={cn("shrink-0 text-xs font-medium",
                          s.status === "SIGNED" ? "text-emerald-600" : s.email === state.recipientEmail ? "text-primary" : "text-muted-foreground")}>
                          {s.status === "SIGNED" ? "Signed" : s.email === state.recipientEmail ? "Signing now" : "Pending"}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </CardContent>
            </Card>

            {/* The document itself — page-by-page preview, so the signer
                reviews the actual bytes before consenting. The metadata card
                above stays as the integrity anchor; a rendering failure never
                blocks signing (graceful degradation inside the component). */}
            {state.document && state.document.pages > 0 && (
              <SignDocumentPreview
                token={token}
                document={state.document}
                fields={state.fields}
                currentRecipientEmail={state.recipientEmail}
                onFieldClick={() => {
                  const el = document.getElementById("sign-name-input");
                  el?.focus();
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              />
            )}

            {/* Contract text (template-sent envelopes) */}
            {state.bodyMarkdown && (
              <Card>
                <CardContent className="p-6 sm:p-8">
                  <p className="mb-3 text-xs font-semibold text-muted-foreground">Document text</p>
                  <div className="max-h-96 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-5 text-sm leading-relaxed">
                    <Markdown>{state.bodyMarkdown}</Markdown>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Adopt signature */}
            <Card>
              <CardContent className="space-y-5 p-6 sm:p-8">
                <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                  <PenLine className="h-3.5 w-3.5" aria-hidden /> Adopt your signature
                </p>

                <div className="space-y-2">
                  <Label htmlFor="sign-name-input">Your full name</Label>
                  <Input
                    id="sign-name-input" autoComplete="name" value={name}
                    onChange={(e) => setName(e.target.value)} placeholder="Type your full name"
                  />
                </div>

                {myFields.length > 0 && (
                  <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                    <p className="text-sm font-medium">Complete your details</p>
                    <p className="text-xs text-muted-foreground">
                      The sender placed these fields for you. They are recorded with your signature.
                    </p>
                    {myFields.map((f) => {
                      const where = <span className="text-xs font-normal text-muted-foreground">· page {f.pageNumber}{f.type !== "checkbox" && f.required === false ? " · optional" : ""}</span>;
                      if (f.type === "checkbox") {
                        return (
                          <label key={f.id} htmlFor={`field-${f.id}`} className="flex cursor-pointer items-start gap-3 text-sm">
                            <Checkbox id={`field-${f.id}`} className="mt-0.5" aria-label={fieldLabel(f)} checked={fieldValues[f.id] === "Yes"}
                              onCheckedChange={(v) => setField(f.id, v === true ? "Yes" : "")} />
                            <span>{fieldLabel(f)}{f.mustTick ? <span className="text-destructive"> *</span> : null} {where}</span>
                          </label>
                        );
                      }
                      if (f.type === "radio") {
                        return (
                          <fieldset key={f.id} className="space-y-2">
                            <legend className="text-sm font-medium">{fieldLabel(f)} {where}</legend>
                            <RadioGroup value={fieldValues[f.id] ?? ""} onValueChange={(v) => setField(f.id, v)} aria-label={fieldLabel(f)}>
                              {fieldOptions(f).map((option, i) => (
                                <label key={option} htmlFor={`field-${f.id}-${i}`} className="flex cursor-pointer items-center gap-2 text-sm">
                                  <RadioGroupItem id={`field-${f.id}-${i}`} value={option} /> {option}
                                </label>
                              ))}
                            </RadioGroup>
                          </fieldset>
                        );
                      }
                      return (
                        <div key={f.id} className="space-y-1.5">
                          <Label htmlFor={`field-${f.id}`}>{fieldLabel(f)} {where}</Label>
                          {f.type === "select" ? (
                            <select
                              id={`field-${f.id}`} value={fieldValues[f.id] ?? ""} onChange={(e) => setField(f.id, e.target.value)}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <option value="">Choose…</option>
                              {fieldOptions(f).map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : (
                            <Input
                              id={`field-${f.id}`} value={fieldValues[f.id] ?? ""} onChange={(e) => setField(f.id, e.target.value)}
                              {...(f.type === "number" ? { inputMode: "decimal" as const, maxLength: 24, placeholder: "e.g. 1250" } : { maxLength: 200 })}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <SignatureAdopter
                  name={name} font={font} onFont={setFont}
                  adoption={adoption} onAdoption={setAdoption}
                  saved={saved} signedIn={state.signedIn === true}
                  save={saveSignature} onSave={setSaveSignature}
                />

                {/* Live preview on the signature line */}
                <div className="rounded-xl border-2 border-dashed bg-card p-5">
                  <div className="flex items-end justify-between gap-3">
                    {previewImage
                      ? <img src={previewImage} alt="Your signature" className="h-14 max-w-[70%] object-contain object-left" />
                      : (adoption.method === "draw" || adoption.method === "upload")
                        ? <span className="text-sm text-muted-foreground">{adoption.method === "draw" ? "Draw above to preview" : "Upload above to preview"}</span>
                        : <span className={cn("min-w-0 break-all text-4xl leading-tight", activeFont.cls)}>{name.trim() || "Your signature"}</span>}
                    <span className="shrink-0 pb-1 text-xs text-muted-foreground">
                      Signed on the date shown in the audit record
                    </span>
                  </div>
                  <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                    {state.recipientEmail} · eIDAS simple electronic signature · sealed in a PAdES-signed PDF
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                  <Checkbox
                    id="consent" data-testid="consent" checked={consent}
                    onCheckedChange={(v) => setConsent(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="consent" className="cursor-pointer text-sm font-normal leading-relaxed text-muted-foreground">
                    I agree to sign electronically. I understand my electronic signature is the legal equivalent of my
                    handwritten signature, is uniquely linked to me, and that the signature and audit records are retained
                    by Docurama SAS in compliance with eIDAS.
                  </Label>
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    data-testid="sign-submit" size="lg"
                    onClick={sign} disabled={busy !== null || !consent || name.trim().length < 2}
                  >
                    {busy === "sign"
                      ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing…</>
                      : <><FileSignature className="h-4 w-4" aria-hidden /> Sign document</>}
                  </Button>
                  <Button
                    data-testid="decline-button" variant="ghost" size="sm" className="text-destructive"
                    onClick={() => setDeclineOpen(true)} disabled={busy !== null}
                  >
                    Decline to sign
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Decline dialog */}
            <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Decline to sign this document?</DialogTitle>
                  <DialogDescription>
                    The sender will be notified that you declined. You can add an optional reason.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="decline-reason">Reason (optional)</Label>
                  <Input
                    id="decline-reason" value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="e.g. wrong-terms-need-revision"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                  <Button variant="destructive" data-testid="confirm-decline" onClick={decline} disabled={busy === "decline"}>
                    {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Confirm decline
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>Docurama SAS · Paris, France · EU data residency</span>
          <Link href="/verify" className="inline-flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="h-3 w-3" aria-hidden /> Verify another document
          </Link>
        </div>
      </footer>
    </div>
  );
}
