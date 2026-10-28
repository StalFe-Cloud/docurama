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
 *
 * Language: the portal speaks the recipient's locale (recipient.locale, the
 * same field the invitation email used), resolved server-side and passed in
 * as `locale`. A header toggle lets the signer switch — the choice is
 * persisted via op "set-locale" so later reminder emails match — while all
 * e2e fixtures default to English.
 *
 * Signature adoption: typed (three handwriting-style fonts) or hand-drawn on
 * a canvas (PNG data URL). Both record the typed full name as the identity
 * attestation; the drawn image is stored verbatim as adoption evidence and
 * rendered into the completed PDF and its completion record.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import {
  BadgeCheck, Ban, CheckCircle2, ChevronLeft, Clock, Eraser, FileSignature, FileText,
  Loader2, Lock, PenLine, ShieldCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BrandLogo } from "@/components/brand/logo";
import { PortalProviders } from "@/components/portal/providers";
import { SignDocumentPreview, type SignDocument } from "@/components/marketing/sign-document-preview";
import { cn } from "@/lib/utils";
import type { ConsentTerms } from "@/lib/consent";
import { SIGNER_STRINGS, type SignerLocale, type SignerStrings } from "@/lib/signer-strings";

export type SignPageState =
  | { phase: "invalid" }
  | { phase: "unavailable"; reason: string }
  | { phase: "terminal"; status: string; title: string; code: string; voidReason: string | null }
  | { phase: "cc"; completed?: boolean; title: string; code: string; tenantName: string; recipientName: string }
  | { phase: "signed"; title: string; code: string; tenantName: string; recipientName: string; sealed: boolean; document: SignDocument | null }
  | { phase: "completed"; title: string; code: string; tenantName: string }
  | { phase: "verify"; title: string; code: string; tenantName: string; recipientName: string;
      maskedEmail: string; channels: Array<"EMAIL" | "SMS">; accountName: string | null }
  | { phase: "wait"; title: string; code: string; tenantName: string; aheadName: string; document: SignDocument | null; expiresAt: string | null }
  | {
      phase: "active";
      consent: ConsentTerms;
      title: string; code: string; tenantName: string;
      message: string | null; pages: number; senderName: string;
      senderDomainVerified: string | null;
      recipientName: string; recipientEmail: string;
      signers: { name: string; email: string; status: string; order: number }[];
      bodyMarkdown: string | null;
      document: { filename: string; pages: number; sha256: string } | null;
      fields?: Array<{ id: string; type: string; pageNumber: number; x: number; y: number; width: number; height: number; recipientEmail: string; recipientName: string; label?: string; required?: boolean }>;
      expiresAt?: string | null;
    };

const FONTS = [
  { key: "caveat", label: "Caveat", cls: "signature-font-caveat" },
  { key: "dancing-script", label: "Dancing Script", cls: "signature-font-dancing" },
  { key: "great-vibes", label: "Great Vibes", cls: "signature-font-greatvibes" },
] as const;

export function PublicSign({ token, locale, state }: { token: string; locale: SignerLocale; state: SignPageState }) {
  return (
    <PortalProviders>
      <SignInner token={token} locale={locale} state={state} />
    </PortalProviders>
  );
}

function SignInner({ token, locale, state }: { token: string; locale: SignerLocale; state: SignPageState }) {
  const [uiLocale, setUiLocale] = useState<SignerLocale>(locale);
  const t = SIGNER_STRINGS[uiLocale];
  const [phase, setPhase] = useState(state.phase);
  const [name, setName] = useState(state.phase === "active" ? state.recipientName : "");
  const [font, setFont] = useState<string>("caveat");
  const [sigMode, setSigMode] = useState<"type" | "draw">("type");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sealed starts from the SERVER truth: a signer revisiting their link after
  // everyone signed must see the sealed state immediately, not a stale
  // "still pending" (the local flag only flips it earlier for in-session signs).
  const [sealed, setSealed] = useState(state.phase === "signed" ? state.sealed : false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const viewed = useRef(false);

  // First open of an active link records VIEWED + DELIVERED (idempotent
  // server-side: only fires for PENDING recipients).
  useEffect(() => {
    if (viewed.current || (state.phase !== "active" && state.phase !== "verify")) return;
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

  // Language switch: instant client-side (both dictionaries are bundled),
  // persisted server-side so reminder emails match. Fire-and-forget — the
  // rendering never waits on it.
  const switchLocale = (next: SignerLocale) => {
    if (next === uiLocale) return;
    setUiLocale(next);
    if (token) {
      fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "set-locale", locale: next }),
      }).catch(() => undefined);
    }
  };

  const sign = async () => {
    if (state.phase !== "active") return;
    if (!name.trim() || name.trim().length < 2) { setError(t.errorNameRequired); return; }
    if (sigMode === "draw" && !drawn) { setError(t.errorDrawEmpty); return; }
    if (!consent) { setError(t.errorConsentRequired); return; }
    setBusy("sign"); setError(null);
    try {
      const r = await post({
        op: "sign", name: name.trim(), font, consent, values,
        consentDigest: state.consent.digest, consentVersion: state.consent.version,
        ...(sigMode === "draw" && drawn ? { drawn } : {}),
      });
      setSealed(!!r.sealed);
      setPhase("signed");
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

  const activeFont = FONTS.find((f) => f.key === font) ?? FONTS[0];

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
          <BrandLogo />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{t.secureSigning}</span>
            <span className="rounded-md bg-muted px-2 py-1 font-mono">{state.phase !== "invalid" && state.phase !== "unavailable" ? state.code : "—"}</span>
            {/* Language selection — Yousign-style explicit choice, persisted
                per recipient. EN default keeps every existing fixture stable. */}
            <div className="flex overflow-hidden rounded-md border" role="group" aria-label={t.language}>
              {(["en", "fr"] as const).map((code) => (
                <button
                  key={code} type="button"
                  onClick={() => switchLocale(code)}
                  aria-pressed={uiLocale === code}
                  data-testid={`locale-${code}`}
                  className={cn(
                    "px-2 py-1 text-[11px] font-semibold uppercase transition-colors",
                    uiLocale === code ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {((phase === "signed" && sealed) || state.phase === "completed" || (state.phase === "signed" && state.sealed) || (state.phase === "cc" && state.completed)) && (
          <div className="mb-5 flex flex-wrap gap-3 rounded-lg border p-4">
            <a className="text-sm font-medium underline" href={`/api/sign/${encodeURIComponent(token)}/completed`}>{t.downloadCompleted}</a>
            <a className="text-sm font-medium underline" href={`/api/sign/${encodeURIComponent(token)}/completed?format=record-pdf`}>{t.downloadRecord}</a>
          </div>
        )}
        {/* ── invalid link ─────────────────────────────────────────────── */}
        {state.phase === "unavailable" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-destructive" aria-hidden />
              <h1 className="text-xl font-semibold">{t.unavailableTitle}</h1>
              <p className="text-sm text-muted-foreground">{state.reason}</p>
            </CardContent>
          </Card>
        )}

        {phase === "invalid" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-destructive" aria-hidden />
              <h1 className="text-xl font-semibold">{t.invalidTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {t.invalidBody}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── terminal (voided / declined / expired) ────────────────────── */}
        {phase === "terminal" && terminalState && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-semibold">{t.terminalTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {t.terminalStatus}: <span className="font-medium text-foreground">{terminalState.status.toLowerCase()}</span>
                {" · "}{terminalState.title}
                {terminalState.voidReason ? ` — ${terminalState.voidReason}` : ""}
              </p>
              {terminalState.status === "EXPIRED" && (
                <p className="text-sm text-muted-foreground">{t.expiredBody}</p>
              )}
            </CardContent>
          </Card>
        )}
        {phase === "terminal" && !terminalState && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Ban className="mx-auto h-10 w-10 text-destructive" aria-hidden />
              <h1 className="text-xl font-semibold">{t.declinedTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {t.declinedBody} <span className="font-medium text-foreground">{declinedTitle}</span>.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── cc recipient ─────────────────────────────────────────────── */}
        {state.phase === "cc" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <Users className="mx-auto h-10 w-10 text-primary" aria-hidden />
              <h1 className="text-xl font-semibold">{t.ccTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {state.recipientName}, {t.ccBody} <span className="font-medium text-foreground">{state.title}</span>
                {" "}{t.ccBodySuffix} {state.tenantName}. {t.ccBodySuffix2}
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
              <h1 className="text-2xl font-semibold">{t.signedTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {signedState.recipientName} {" "}
                <span className="font-medium text-foreground">{signedState.title}</span>.
                {" "}{sealed ? t.signedBodySealed : t.signedBodyPending}
              </p>
              {sealed && (
                <div className="rounded-lg border bg-card p-4 text-left">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> {t.sealedCardTitle}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.sealedCardBody} <span className="font-mono text-foreground">{signedState.code}</span> {t.sealedCardBody2}
                  </p>
                  <Button size="sm" className="mt-3" asChild>
                    {/* Link, not a plain anchor: client-side navigation keeps the
                        transition instant (no full reload) on the success screen. */}
                    <Link href={`/verify?code=${encodeURIComponent(signedState.code)}`}>
                      <BadgeCheck className="h-4 w-4" aria-hidden /> {t.verifySeal}
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {state.phase === "signed" && state.document && state.document.pages > 0 && (
            <SignDocumentPreview token={token} document={state.document} strings={t} />
          )}
          </div>
        )}

        {/* ── completed by everyone (late visitor) ──────────────────────── */}
        {state.phase === "completed" && (
          <Card className="mx-auto max-w-md text-center">
            <CardContent className="space-y-3 p-8">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
              <h1 className="text-xl font-semibold">{t.completedTitle}</h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{state.title}</span> {t.completedBody}
                {" "}<span className="font-mono">{state.code}</span>.
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/verify?code=${encodeURIComponent(state.code)}`}>{t.openVerify}</Link>
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
                <h1 className="text-xl font-semibold">{t.waitTitle}</h1>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{state.aheadName}</span> {t.waitBody}
                  {" "}<span className="font-medium text-foreground">{state.title}</span>.
                  {" "}{t.waitBodySuffix}
                </p>
                {state.expiresAt && (
                  <p className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700" data-testid="deadline-notice">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> {t.deadlineNotice} {state.expiresAt}
                  </p>
                )}
              </CardContent>
            </Card>
            {state.document && state.document.pages > 0 && (
              <SignDocumentPreview token={token} document={state.document} strings={t} />
            )}
          </div>
        )}

        {/* ── identity verification (OTP / account match) ──────────────── */}
        {state.phase === "verify" && <VerifyGate state={state} post={post} t={t} />}

        {/* ── active signing experience ────────────────────────────────── */}
        {phase === "active" && state.phase === "active" && (
          <div className="space-y-6">
            {/* Document card */}
            <Card>
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                      <FileText className="h-3.5 w-3.5" aria-hidden /> {t.forSignature}
                    </p>
                    <h1 className="text-2xl font-semibold tracking-tight">{state.title}</h1>
                    {state.expiresAt && (
                      <p className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700" data-testid="deadline-notice">
                        <Clock className="h-3.5 w-3.5" aria-hidden /> {t.deadlineNotice} {state.expiresAt}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {t.sentBy} <span className="font-medium text-foreground">{state.tenantName}</span>
                      {" · "}{state.document ? state.document.pages : state.pages} {(state.document ? state.document.pages : state.pages) > 1 ? t.pageMany : t.pageOne}
                    </p>
                    {state.senderDomainVerified && (
                      <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        {t.senderDomainVerified} {state.senderDomainVerified}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 font-mono text-xs">{state.code}</span>
                </div>

                {state.message && (
                  <div className="mt-4 rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs font-medium text-muted-foreground">{t.messageLabel}</p>
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
                      <ShieldCheck className="h-3 w-3" aria-hidden /> {t.integrityVerified}
                    </span>
                  </div>
                )}

                {/* Signers rail */}
                <div className="mt-5">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden /> {t.signersLabel}
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
                          {s.status === "SIGNED" ? t.statusSigned : s.email === state.recipientEmail ? t.statusSigningNow : t.statusPending}
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
                strings={t}
                onFieldClick={(field) => {
                  const el = document.getElementById(["signature", "initials"].includes(field.type) ? "sign-name-input" : `value-${field.id}`);
                  el?.focus();
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              />
            )}

            {/* Contract text (template-sent envelopes) */}
            {state.bodyMarkdown && (
              <Card>
                <CardContent className="p-6 sm:p-8">
                  <p className="mb-3 text-xs font-semibold text-muted-foreground">{t.documentText}</p>
                  <div className="max-h-96 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-5 text-sm leading-relaxed">
                    <Markdown>{state.bodyMarkdown}</Markdown>
                  </div>
                </CardContent>
              </Card>
            )}

            {state.fields?.filter(field => field.recipientEmail.toLowerCase() === state.recipientEmail.toLowerCase() && !["signature", "initials"].includes(field.type)).map(field => (
              <Card key={field.id}><CardContent className="space-y-2 p-5">
                <Label htmlFor={`value-${field.id}`}>{field.label ?? field.type}{field.required !== false ? " *" : ""} ({t.fieldOnPage} {field.pageNumber})</Label>
                {field.type === "checkbox"
                  ? <input type="checkbox" className="size-4 accent-primary" id={`value-${field.id}`} checked={values[field.id] === true} aria-checked={values[field.id] === true} onChange={event => { const checked = event.target.checked; setValues(current => ({...current,[field.id]:checked})); }} />
                  : <Input id={`value-${field.id}`} type={field.type === "date" ? "date" : "text"} maxLength={2000}
                      value={typeof values[field.id] === "string" ? values[field.id] as string : ""}
                      onChange={event => setValues(current => ({...current,[field.id]:event.target.value}))} />}
              </CardContent></Card>
            ))}
            <p className="text-xs text-muted-foreground">{t.finePrint}</p>
            {/* Adopt signature */}
            <Card>
              <CardContent className="space-y-5 p-6 sm:p-8">
                <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                  <PenLine className="h-3.5 w-3.5" aria-hidden /> {t.adoptTitle}
                </p>

                <div className="space-y-2">
                  <Label htmlFor="sign-name-input">{t.fullName}</Label>
                  <Input
                    id="sign-name-input" autoComplete="name" value={name}
                    onChange={(e) => setName(e.target.value)} placeholder={t.fullNamePlaceholder}
                  />
                </div>

                {/* Type or draw — two ways to adopt the same evidence-backed signature. */}
                <div className="flex w-fit overflow-hidden rounded-lg border" role="radiogroup" aria-label={t.adoptTitle}>
                  <button type="button" role="radio" aria-checked={sigMode === "type"} data-testid="sig-mode-type"
                    onClick={() => setSigMode("type")}
                    className={cn("px-4 py-2 text-sm font-medium transition-colors", sigMode === "type" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {t.modeType}
                  </button>
                  <button type="button" role="radio" aria-checked={sigMode === "draw"} data-testid="sig-mode-draw"
                    onClick={() => setSigMode("draw")}
                    className={cn("px-4 py-2 text-sm font-medium transition-colors", sigMode === "draw" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {t.modeDraw}
                  </button>
                </div>

                {sigMode === "type" ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t.signatureStyle}</p>
                    <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t.signatureStyle}>
                      {FONTS.map((f) => (
                        <button
                          key={f.key} type="button" role="radio" aria-checked={font === f.key}
                          data-testid={`font-${f.key}`}
                          onClick={() => setFont(f.key)}
                          className={cn(
                            "flex h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 bg-card p-2 transition-colors",
                            font === f.key ? "border-primary" : "border-transparent hover:border-muted",
                          )}
                        >
                          <span className={cn("truncate text-2xl leading-none", f.cls)}>
                            {name.trim() || t.yourNamePreview}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <DrawSignatureCanvas onChange={setDrawn} strings={t} />
                )}

                {/* Live preview on the signature line */}
                <div className="rounded-xl border-2 border-dashed bg-card p-5">
                  <div className="flex items-end justify-between gap-3">
                    {sigMode === "draw"
                      ? (drawn
                          ? <img src={drawn} alt={t.yourSignaturePreview} className="max-h-20 w-auto max-w-full object-contain" />
                          : <span className="text-sm text-muted-foreground">{t.yourSignaturePreview}</span>)
                      : <span className={cn("min-w-0 break-all text-4xl leading-tight", activeFont.cls)}>
                          {name.trim() || t.yourSignaturePreview}
                        </span>}
                    <span className="shrink-0 pb-1 text-xs text-muted-foreground">
                      {t.signedOnNote}
                    </span>
                  </div>
                  <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                    {state.recipientEmail} · {sigMode === "draw" ? t.drawnBadge : t.typedBadge}
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                  <input type="checkbox"
                    id="consent" data-testid="consent" checked={consent} aria-checked={consent}
                    onChange={event => setConsent(event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <Label htmlFor="consent" className="cursor-pointer text-sm font-normal leading-relaxed text-muted-foreground">
                    <span className="whitespace-pre-wrap" data-testid="consent-text">{state.consent.text}</span>
                    <span className="mt-1 block text-xs" data-testid="consent-version">{t.consentVersion} {state.consent.version}</span>
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
                    onClick={sign} disabled={busy !== null || !consent || name.trim().length < 2 || (sigMode === "draw" && !drawn)}
                  >
                    {busy === "sign"
                      ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t.signing}</>
                      : <><FileSignature className="h-4 w-4" aria-hidden /> {t.signDocument}</>}
                  </Button>
                  <Button
                    data-testid="decline-button" variant="ghost" size="sm" className="text-destructive"
                    onClick={() => setDeclineOpen(true)} disabled={busy !== null}
                  >
                    {t.declineToSign}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Decline dialog */}
            <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.declineDialogTitle}</DialogTitle>
                  <DialogDescription>
                    {t.declineDialogBody}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="decline-reason">{t.declineReasonLabel}</Label>
                  <Input
                    id="decline-reason" value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder={t.declineReasonPlaceholder}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeclineOpen(false)}>{t.cancel}</Button>
                  <Button variant="destructive" data-testid="confirm-decline" onClick={decline} disabled={busy === "decline"}>
                    {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {t.confirmDecline}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>{t.residency}</span>
          <Link href="/verify" className="inline-flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="h-3 w-3" aria-hidden /> {t.verifyAnother}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * Hand-drawn signature canvas. Fixed internal resolution (1000x400, inside
 * the server's 1200x600 cap) so the exported PNG is deterministic and small;
 * pointer events cover mouse, touch and pen; `touch-action: none` keeps the
 * page from scrolling mid-stroke. The export is a plain PNG data URL — the
 * server re-validates structure and the signing transaction's preflight
 * proves it embeddable before anything commits.
 */
function DrawSignatureCanvas({ onChange, strings }: {
  onChange: (dataUrl: string | null) => void;
  strings: SignerStrings;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const CANVAS_W = 1000, CANVAS_H = 400;

  const context = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width !== CANVAS_W || canvas.height !== CANVAS_H) {
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 3.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#172033";
    }
    return ctx;
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (event.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = point(event);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    setHasInk(true);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = context();
    const last = lastRef.current;
    if (!ctx || !last) return;
    const next = point(event);
    // Quadratic midpoint smoothing: joins stroke segments through their
    // midpoints so fast strokes render as curves, not polylines.
    const mid = { x: (last.x + next.x) / 2, y: (last.y + next.y) / 2 };
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    lastRef.current = next;
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const ctx = context();
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        data-testid="signature-canvas"
        role="img"
        aria-label={strings.drawHint}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className="aspect-[5/2] w-full touch-none rounded-lg border-2 border-dashed bg-white shadow-inner"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{strings.drawHint}</p>
        <Button type="button" variant="outline" size="sm" data-testid="clear-drawing" onClick={clear} disabled={!hasInk}>
          <Eraser className="h-3.5 w-3.5" aria-hidden /> {strings.clearDrawing}
        </Button>
      </div>
    </div>
  );
}

/** Second-factor gate before the signing form. The private link proves the
 * recipient got the email; this proves it is really them: a one-time code
 * (email and/or SMS, per the sender's selection) or — for existing account
 * holders whose email matches — a one-click verified account session.
 * Recipients never need to create an account. */
function VerifyGate({ state, post, t }: {
  state: Extract<SignPageState, { phase: "verify" }>;
  post: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  t: SignerStrings;
}) {
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(state.channels[0] ?? "EMAIL");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [masked, setMasked] = useState(state.maskedEmail);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<"send" | "verify" | "account" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    setBusy("send"); setError(null);
    try {
      const result = await post({ op: "otp-request", channel, phone: channel === "SMS" ? phone.trim() : undefined });
      setSent(true); setCode("");
      if (typeof result.maskedDestination === "string") setMasked(result.maskedDestination);
      setCooldown(60);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the code"); }
    finally { setBusy(null); }
  };

  const verify = async () => {
    setBusy("verify"); setError(null);
    try {
      await post({ op: "otp-verify", code });
      // The signing session lands in an HttpOnly cookie server-side; a reload
      // re-resolves the RSC state with the full signing form.
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); setBusy(null); }
  };

  const verifyAccount = async () => {
    setBusy("account"); setError(null);
    try {
      await post({ op: "verify-as-account" });
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); setBusy(null); }
  };

  const hasBoth = state.channels.length > 1;
  return (
    <Card className="mx-auto max-w-lg text-center">
      <CardContent className="space-y-5 p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
          <ShieldCheck className="h-7 w-7 text-primary" aria-hidden />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t.verifyTitle}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{state.recipientName}</span>, {t.verifyBody}
            {" "}<span className="font-medium text-foreground">{state.title}</span>. {t.verifyBodySuffix}
          </p>
        </div>

        {state.accountName && (
          <>
            <Button data-testid="account-verify" className="w-full" onClick={verifyAccount} disabled={busy !== null}>
              {busy === "account" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
              {t.continueAs} {state.accountName}
            </Button>
            <p className="text-xs text-muted-foreground">{t.orCode}</p>
          </>
        )}

        {hasBoth && (
          <div className="flex justify-center gap-2" role="radiogroup" aria-label={t.verifyTitle}>
            <Button type="button" size="sm" variant={channel === "EMAIL" ? "default" : "outline"}
              onClick={() => { setChannel("EMAIL"); setSent(false); setError(null); }}>{t.emailChannel}</Button>
            <Button type="button" size="sm" variant={channel === "SMS" ? "default" : "outline"}
              onClick={() => { setChannel("SMS"); setSent(false); setError(null); }}>{t.smsChannel}</Button>
          </div>
        )}

        {channel === "SMS" && (
          <div className="space-y-2 text-left">
            <Label htmlFor="otp-phone">{t.phoneLabel}</Label>
            <Input id="otp-phone" inputMode="tel" autoComplete="tel" placeholder={t.phonePlaceholder}
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        )}

        {!sent ? (
          <Button data-testid="otp-send" className="w-full" onClick={send}
            disabled={busy !== null || (channel === "SMS" && phone.trim().length < 8)}>
            {busy === "send" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…</> : <Lock className="h-4 w-4" aria-hidden />}
            {channel === "EMAIL" ? `${t.emailCodeTo} ${state.maskedEmail}` : t.smsMe}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t.codeSentTo} <span className="font-medium text-foreground">{masked}</span>
            </p>
            <div className="flex justify-center" data-testid="otp-input">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((slot) => <InputOTPSlot key={slot} index={slot} />)}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button data-testid="otp-verify" className="w-full" onClick={verify} disabled={busy !== null || code.length < 6}>
              {busy === "verify" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t.verifying}</> : t.verifyContinue}
            </Button>
            <Button variant="ghost" size="sm" className="w-full" onClick={send} disabled={busy !== null || cooldown > 0}>
              {cooldown > 0 ? `${t.resendIn} ${cooldown}s` : t.resend}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
