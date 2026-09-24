"use client";

import { useEffect, useState } from "react";
import { FileArchive, FileJson, FileKey2, Link2, RotateCcw, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { sha256Hex } from "./data";
import { usePlayground } from "./store";

interface Row { index: number; at: string; actor: string; text: string; prev: string; hash: string; valid: boolean }

// The real pack layout (src/lib/evidence-pack.ts).
const EVIDENCE = [
  { name: "document/<code>-signed.pdf", icon: FileArchive, note: "PAdES-signed PDF with a certificate page" },
  { name: "evidence/seal-manifest.json", icon: FileJson, note: "What the seal binds: file, signers, trail, values" },
  { name: "evidence/seal-timestamp.tsr", icon: Timer, note: "RFC 3161 timestamp of the seal" },
  { name: "certificate/evidence-key.pem", icon: FileKey2, note: "X.509 certificate of the pack signature" },
];

export function AuditTab() {
  const { state } = usePlayground();
  const candidates = state.envelopes.filter((e) => e.thread.some((t) => t.kind === "event"));
  const [envId, setEnvId] = useState(candidates[0]?.id ?? "");
  const env = candidates.find((e) => e.id === envId) ?? candidates[0];
  const [tampered, setTampered] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const events = env ? env.thread.filter((t) => t.kind !== "note") : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The stored chain (what was sealed) vs. a recomputation over what is shown now.
      const sealed: string[] = [];
      let prev = "GENESIS";
      for (const e of events) { prev = await sha256Hex(`${prev}|${e.at}|${e.actor}|${e.text}`); sealed.push(prev); }
      const out: Row[] = [];
      prev = "GENESIS";
      let broken = false;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const text = i === tampered ? `${e.text} (edited)` : e.text;
        const hash = await sha256Hex(`${prev}|${e.at}|${e.actor}|${text}`);
        if (hash !== sealed[i]) broken = true;
        out.push({ index: i + 1, at: e.at, actor: e.actor, text, prev, hash, valid: !broken });
        prev = hash;
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
  }, [env?.id, events.length, tampered]);

  if (!env) return <p className="p-6 text-center text-xs text-muted-foreground">Send an envelope to see its audit trail.</p>;
  const firstBroken = rows.find((r) => !r.valid);
  const target = Math.min(1, events.length - 1);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <label className="min-w-0">
            <span className="sr-only">Envelope</span>
            <select value={env.id} onChange={(e) => { setEnvId(e.target.value); setTampered(null); }}
              className="h-8 max-w-[14rem] rounded-lg border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {candidates.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          {tampered === null ? (
            <button type="button" onClick={() => setTampered(target)} disabled={events.length < 2}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium hover:bg-muted active:scale-[0.98] disabled:opacity-50">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-600" aria-hidden /> Tamper with event {target + 1}
            </button>
          ) : (
            <button type="button" onClick={() => setTampered(null)}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium hover:bg-muted active:scale-[0.98]">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore original
            </button>
          )}
        </div>
        <p className={cn("flex items-center gap-2 border-b px-4 py-2 text-xs font-medium",
          firstBroken ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-primary/5 text-primary")} aria-live="polite">
          {firstBroken
            ? <><ShieldAlert className="h-4 w-4" aria-hidden /> Chain broken at event {firstBroken.index}: its hash no longer matches the sealed record.</>
            : <><ShieldCheck className="h-4 w-4" aria-hidden /> Chain intact: {rows.length} events, each hash covers the one before it.</>}
        </p>
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {rows.map((r) => (
            <li key={r.index} className={cn("rounded-lg border p-2.5 text-xs transition-colors", !r.valid && "border-rose-500/40 bg-rose-500/5")}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">#{r.index}</span>
                <span className="font-medium">{r.text}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{r.at}</span>
              </div>
              <p className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
                <Link2 className="h-2.5 w-2.5 shrink-0" aria-hidden /> {r.prev === "GENESIS" ? "genesis" : r.prev.slice(0, 16)} → <span className={cn(!r.valid && "text-rose-600")}>{r.hash.slice(0, 16)}</span>
              </p>
            </li>
          ))}
        </ol>
      </div>
      <aside className="hidden border-l p-4 lg:block" aria-label="Evidence pack">
        <p className="text-xs font-semibold">Evidence pack</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Opens offline. Your auditors verify it without Docurama.</p>
        <ul className="mt-3 space-y-2">
          {EVIDENCE.map((f) => (
            <li key={f.name} className="flex items-start gap-2 text-[11px]">
              <f.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0"><span className="block truncate font-mono">{f.name}</span><span className="text-muted-foreground">{f.note}</span></span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
