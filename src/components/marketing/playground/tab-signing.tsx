"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileText, Loader2, Lock, PenLine, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { sha256Hex, type Envelope } from "./data";
import { usePlayground } from "./store";

const STYLES = [
  { key: "caveat", label: "Caveat", cls: "signature-font-caveat" },
  { key: "dancing", label: "Dancing Script", cls: "signature-font-dancing" },
  { key: "vibes", label: "Great Vibes", cls: "signature-font-greatvibes" },
] as const;

export function SigningTab() {
  const { state } = usePlayground();
  const env = state.envelopes.find((e) => e.id === state.signingId) ?? state.envelopes[0];
  const signerIndex = env.signers.findIndex((s) => s.status !== "SIGNED");
  // Each signer in routing order gets a fresh form (remount via key).
  return signerIndex < 0 ? <Sealed env={env} /> : <SignForm key={`${env.id}:${signerIndex}`} env={env} signerIndex={signerIndex} />;
}

function Sealed({ env }: { env: Envelope }) {
  const { verify, setTab } = usePlayground();
  const [digest, setDigest] = useState("");
  useEffect(() => {
    let live = true;
    // The digest binds the document and every signer (the real seal: src/lib/esign.ts).
    sha256Hex(`${env.code}|${env.title}|${env.signers.map((s) => `${s.email}:${s.signedAt}`).join("|")}`).then((d) => { if (live) setDigest(d); });
    return () => { live = false; };
  }, [env]);

  return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" aria-hidden /></span>
        <div>
          <p className="text-sm font-semibold">All parties signed. The envelope is sealed.</p>
          <p className="mt-1 text-xs text-muted-foreground">{env.title} · verification code <span className="font-mono text-foreground">{env.code}</span></p>
          <p className="mx-auto mt-2 max-w-sm break-all font-mono text-[10px] text-muted-foreground">SHA-256 {digest || "…"}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => verify(env.code)} className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98]">
            Verify this code
          </button>
          <button type="button" onClick={() => setTab("audit")} className="h-9 rounded-lg border px-3 text-xs font-medium hover:bg-muted active:scale-[0.98]">
            Inspect the audit trail
          </button>
        </div>
      </div>
  );
}

function SignForm({ env, signerIndex }: { env: Envelope; signerIndex: number }) {
  const { sign } = usePlayground();
  const signer = env.signers[signerIndex];
  const [name, setName] = useState(signer.name);
  const [style, setStyle] = useState<(typeof STYLES)[number]["key"]>("caveat");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"form" | "sealing">("form");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent || name.trim().length < 2) return;
    setPhase("sealing");
    window.setTimeout(() => sign(env.id, signerIndex), 1100);
  };

  const styleCls = STYLES.find((s) => s.key === style)!.cls;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem]">
      {/* What the signer reviews */}
      <div className="min-h-0 overflow-y-auto border-b bg-muted/30 p-4 md:border-b-0 md:border-r">
        <div className="mx-auto max-w-md rounded-md bg-white p-5 text-zinc-800 shadow-sm ring-1 ring-black/5">
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><FileText className="h-3 w-3" aria-hidden /> {env.title}</p>
          <div className="mt-3 space-y-1.5" aria-hidden>
            {[92, 88, 95, 60, 90, 84, 70].map((w, i) => <div key={i} className="h-1.5 rounded bg-zinc-200" style={{ width: `${w}%` }} />)}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-[10px] text-zinc-500">
            {env.signers.map((s, i) => (
              <div key={s.email}>
                <p className="font-semibold text-zinc-700">{s.company}</p>
                <div className={cn(
                  "mt-1.5 flex h-10 items-center rounded-md px-2",
                  i === signerIndex ? "bg-primary/10 ring-2 ring-primary" : s.status === "SIGNED" ? "bg-zinc-50" : "border border-dashed border-zinc-300 bg-zinc-50",
                )}>
                  {s.status === "SIGNED" ? (
                    <span className="signature-font-caveat text-lg text-zinc-800">{s.name}</span>
                  ) : i === signerIndex ? (
                    <span className={cn("truncate text-lg text-zinc-800", styleCls)}>{name.trim() || "Sign here"}</span>
                  ) : (
                    <span className="text-zinc-400">Waiting for {s.name.split(" ")[0]}</span>
                  )}
                </div>
                <p className="mt-1">{s.name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The signer's form */}
      <form onSubmit={submit} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div>
          <p className="text-xs text-muted-foreground">Signing as</p>
          <p className="text-sm font-semibold">{signer.name}</p>
          <p className="text-[11px] text-muted-foreground">{signer.email}</p>
        </div>
        <label className="space-y-1">
          <span className="text-xs font-medium">Your full name</span>
          <input
            value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
            className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="space-y-1">
          <p className="text-xs font-medium">Signature style</p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Signature style">
            {STYLES.map((s) => (
              <button
                key={s.key} type="button" role="radio" aria-checked={style === s.key} onClick={() => setStyle(s.key)}
                className={cn("flex h-12 items-center justify-center rounded-lg border-2 px-1 transition-colors",
                  style === s.key ? "border-primary" : "border-transparent bg-muted/50 hover:border-muted-foreground/30")}
              >
                <span className={cn("truncate text-base", s.cls)}>{name.trim().split(" ")[0] || "Name"}</span>
                <span className="sr-only">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
          I agree to sign electronically. My signature and the audit record are sealed with the document.
        </label>
        <button
          type="submit" disabled={!consent || name.trim().length < 2 || phase === "sealing"}
          className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-50"
        >
          {phase === "sealing" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {env.signers.length - signerIndex > 1 ? "Signing…" : "Signing and sealing…"}</> : <><PenLine className="h-4 w-4" aria-hidden /> Sign document</>}
        </button>
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden /> eIDAS simple electronic signature
          <BadgeCheck className="ml-auto h-3 w-3 text-primary" aria-hidden /> RFC 3161 timestamp
        </p>
      </form>
    </div>
  );
}
