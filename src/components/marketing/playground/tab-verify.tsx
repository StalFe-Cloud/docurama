"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileQuestion, Loader2, ShieldCheck } from "lucide-react";
import { sha256Hex, type Envelope } from "./data";
import { usePlayground } from "./store";

type Result = { kind: "verified"; env: Envelope; digest: string } | { kind: "missing"; code: string } | { kind: "unsealed"; env: Envelope };

export function VerifyTab() {
  const { state, clearVerify } = usePlayground();
  const [code, setCode] = useState(state.verifyCode ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = (raw: string) => {
    const wanted = raw.trim().toUpperCase();
    if (!wanted) return;
    setCode(wanted);
    setBusy(true);
    setResult(null);
    const env = state.envelopes.find((e) => e.code === wanted);
    window.setTimeout(async () => {
      if (!env) setResult({ kind: "missing", code: wanted });
      else if (env.status !== "COMPLETED") setResult({ kind: "unsealed", env });
      else {
        const digest = await sha256Hex(`${env.code}|${env.title}|${env.signers.map((s) => `${s.email}:${s.signedAt}`).join("|")}`);
        setResult({ kind: "verified", env, digest });
      }
      setBusy(false);
    }, 650);
  };

  // A code handed over from the Signing tab verifies on arrival.
  useEffect(() => {
    if (!state.verifyCode) return;
    const handed = state.verifyCode;
    // Deferred: state updates belong in a callback, not the effect body.
    const timer = window.setTimeout(() => { clearVerify(); run(handed); }, 0);
    return () => window.clearTimeout(timer);
  }, [state.verifyCode]);

  const sealed = state.envelopes.filter((e) => e.status === "COMPLETED").map((e) => e.code);
  const suggestions = [...new Set([...(state.lastSealedCode ? [state.lastSealedCode] : []), ...sealed])].slice(0, 2);

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col gap-4 overflow-y-auto p-5">
      <div>
        <p className="text-sm font-semibold">Verify a document</p>
        <p className="mt-1 text-xs text-muted-foreground">Anyone holding a verification code can check the seal. No account needed.</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(code); }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Verification code</span>
          <input
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DOC-XXXXXX"
            className="h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <button type="submit" disabled={!code.trim() || busy} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-50">
          Verify
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        Try
        {suggestions.map((c) => (
          <button key={c} type="button" onClick={() => run(c)} className="rounded-md border px-2 py-0.5 font-mono hover:bg-muted">{c}</button>
        ))}
        <button type="button" onClick={() => run("DOC-NOTREAL")} className="rounded-md border px-2 py-0.5 font-mono hover:bg-muted">DOC-NOTREAL</button>
      </div>

      {busy && (
        <div className="space-y-2 rounded-xl border p-4" aria-label="Checking the seal">
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking the seal and the timestamp…</p>
          <div className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      )}

      {result?.kind === "verified" && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4 motion-safe:animate-in motion-safe:fade-in">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" aria-hidden /> Signature verified</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Document</dt><dd className="font-medium">{result.env.title}</dd>
            <dt className="text-muted-foreground">Code</dt><dd className="font-mono">{result.env.code}</dd>
            <dt className="text-muted-foreground">Seal covers</dt><dd>Document, signers, audit trail, field values</dd>
            <dt className="text-muted-foreground">Timestamp</dt><dd>RFC 3161, from an independent authority</dd>
            <dt className="text-muted-foreground">Signed PDF</dt><dd>PAdES B-LTA, checkable in any PDF reader for decades</dd>
            <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-[10px]">{result.digest}</dd>
          </dl>
          <ul className="space-y-1 border-t pt-2 text-xs">
            {result.env.signers.map((s) => (
              <li key={s.email} className="flex items-center gap-2">
                <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
                <span className="font-medium">{s.name}</span>
                <span className="truncate text-muted-foreground">{s.email}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">signed {s.signedAt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result?.kind === "unsealed" && (
        <div className="rounded-xl border p-4 text-xs">
          <p className="font-semibold">Not sealed yet</p>
          <p className="mt-1 text-muted-foreground">{result.env.title} is still waiting for {result.env.signers.filter((s) => s.status !== "SIGNED").map((s) => s.name).join(" and ")}. The code verifies once everyone has signed.</p>
        </div>
      )}
      {result?.kind === "missing" && (
        <div className="rounded-xl border p-4 text-xs">
          <p className="flex items-center gap-2 font-semibold"><FileQuestion className="h-4 w-4 text-muted-foreground" aria-hidden /> No sealed document with this code</p>
          <p className="mt-1 text-muted-foreground">Check <span className="font-mono">{result.code}</span> against the certificate of completion.</p>
        </div>
      )}
    </div>
  );
}
