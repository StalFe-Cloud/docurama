"use client";

import { useState } from "react";
import { CalendarDays, Check, Loader2, PenLine, Send, Sparkles, Trash2, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIGNER_TONES } from "./data";
import { usePlayground } from "./store";

type Kind = "signature" | "initials" | "date" | "text";
/**
 * A detected field is anchored to the blank it was found on and drawn inside
 * it, so it stays on its line at every width (the page reflows); a field
 * placed by clicking keeps its position on the page, in percent.
 */
interface Field { id: string; kind: Kind; signer: number; label: string; anchor?: string; x?: number; y?: number }

const TOOLS: { kind: Kind; label: string; icon: typeof PenLine }[] = [
  { kind: "signature", label: "Signature", icon: PenLine },
  { kind: "initials", label: "Initials", icon: PenLine },
  { kind: "date", label: "Date", icon: CalendarDays },
  { kind: "text", label: "Text", icon: Type },
];

const SIGNERS = [
  { name: "Jonas Weber", email: "jonas.weber@nordlicht.de", company: "Nordlicht GmbH" },
  { name: "Alexandra Fischer", email: "alex@stalfe.example", company: "StålFe AB" },
];

/** The signature blocks on this page: one per party, in the signers' order. */
const PARTIES = ["For Nordlicht GmbH", "For StålFe AB"];
const BLANKS: { key: string; label: string; kind: Kind }[] = [
  { key: "signature", label: "Signature", kind: "signature" },
  { key: "name", label: "Name", kind: "text" },
  { key: "date", label: "Date", kind: "date" },
];

/** What Document Intelligence finds on this page: each blank of each party's block. */
const DETECTED: Omit<Field, "id">[] = PARTIES.flatMap((_, party) =>
  BLANKS.map((b) => ({ kind: b.kind, signer: party, label: b.label, anchor: `${party}-${b.key}` })),
);

export function BuilderTab() {
  const { state, create, setTab } = usePlayground();
  const [fields, setFields] = useState<Field[]>([]);
  const [tool, setTool] = useState<Kind>("signature");
  const [signer, setSigner] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const title = state.builderTitle;

  const missing = SIGNERS.filter((_, i) => !fields.some((f) => f.signer === i && f.kind === "signature"));

  const autoDetect = () => {
    setDetecting(true);
    window.setTimeout(() => {
      setFields(DETECTED.map((f, i) => ({ ...f, id: `auto${i}` })));
      setDetecting(false);
    }, 900);
  };

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-field]")) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(70, Math.max(2, ((e.clientX - box.left) / box.width) * 100 - 10));
    const y = Math.min(92, Math.max(2, ((e.clientY - box.top) / box.height) * 100 - 2));
    setFields((prev) => [...prev, { id: `f${Date.now()}`, kind: tool, signer, x, y, label: TOOLS.find((t) => t.kind === tool)!.label }]);
  };

  const remove = (id: string) => setFields((prev) => prev.filter((x) => x.id !== id));

  const send = () => {
    const env = create({ title, pages: 4, signers: SIGNERS });
    setSent(env.code);
  };

  if (sent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-6 w-6" aria-hidden /></span>
        <div>
          <p className="text-sm font-semibold">Sent to {SIGNERS[0].name} and {SIGNERS[1].name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{title} · <span className="font-mono">{sent}</span> · {fields.length} fields, signing in routing order</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => setTab("signing")} className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98]">
            Sign it as {SIGNERS[0].name.split(" ")[0]}
          </button>
          <button type="button" onClick={() => setTab("documents")} className="h-9 rounded-lg border px-3 text-xs font-medium hover:bg-muted active:scale-[0.98]">
            Track it in Documents
          </button>
          <button type="button" onClick={() => { setSent(null); setFields([]); }} className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:text-foreground">
            Prepare another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Signer">
          {SIGNERS.map((s, i) => (
            <button
              key={s.email} type="button" role="radio" aria-checked={signer === i} onClick={() => setSigner(i)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                signer === i ? cn(SIGNER_TONES[i].bg, SIGNER_TONES[i].text) : "text-muted-foreground hover:bg-muted")}
            >
              <span className={cn("h-2 w-2 rounded-full", SIGNER_TONES[i].solid)} aria-hidden />
              {s.name}
              <span className="rounded bg-background/70 px-1 text-[10px]">{fields.filter((f) => f.signer === i).length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5" role="radiogroup" aria-label="Field type">
          {TOOLS.map((t) => (
            <button
              key={t.kind} type="button" role="radio" aria-checked={tool === t.kind} onClick={() => setTool(t.kind)}
              className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                tool === t.kind ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <t.icon className="h-3 w-3" aria-hidden /> <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button" onClick={autoDetect} disabled={detecting}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium hover:bg-muted active:scale-[0.98] disabled:opacity-60"
          >
            {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
            AI Auto-Detect
          </button>
          {fields.length > 0 && (
            <button type="button" onClick={() => setFields([])} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Remove all fields">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button" onClick={send} disabled={missing.length > 0}
            title={missing.length ? `Place a signature for ${missing.map((m) => m.name).join(" and ")}` : "Send for signature"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> Send
          </button>
        </div>
      </div>

      <p className="border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground" aria-live="polite">
        {detecting
          ? "Reading the document: labels, blanks and signature blocks…"
          : fields.length === 0
            ? "Click AI Auto-Detect, or click on the page to place a field for the selected signer."
            : missing.length
              ? `Still needed: a signature for ${missing.map((m) => m.name).join(" and ")}.`
              : `${fields.length} fields placed. Each party has a signature, ready to send.`}
      </p>

      {/* Page */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4">
        <div
          onClick={place}
          className="relative mx-auto aspect-[1/1.2] w-full max-w-xl cursor-crosshair rounded-md bg-white p-[6%] text-zinc-800 shadow-sm ring-1 ring-black/5"
          role="application" aria-label="Contract page. Click to place a field."
        >
          <p className="text-[clamp(11px,1.6vw,15px)] font-semibold">{title}</p>
          <p className="mt-2 text-[clamp(7px,0.9vw,9px)] leading-relaxed text-zinc-600">
            This agreement is made between StålFe AB, Kungsgatan 12, 111 43 Stockholm, and Nordlicht GmbH,
            Friedrichstrasse 44, 10117 Berlin. Nordlicht is appointed non-exclusive distributor for the DACH region.
          </p>
          <p className="mt-2 text-[clamp(7px,0.9vw,9px)] font-semibold">1. Term</p>
          <p className="text-[clamp(7px,0.9vw,9px)] leading-relaxed text-zinc-600">Twenty-four months from the effective date, renewable by written agreement.</p>
          <p className="mt-2 text-[clamp(7px,0.9vw,9px)] font-semibold">2. Pricing</p>
          <p className="text-[clamp(7px,0.9vw,9px)] leading-relaxed text-zinc-600">Distributor prices follow Annex A. Invoices are payable within 30 days.</p>
          <p className="mt-2 text-[clamp(7px,0.9vw,9px)] font-semibold">3. Governing law</p>
          <p className="text-[clamp(7px,0.9vw,9px)] leading-relaxed text-zinc-600">French law. The courts of Paris have exclusive jurisdiction.</p>

          <div className="absolute inset-x-[6%] bottom-[8%] grid grid-cols-2 gap-[6%] text-[clamp(7px,0.9vw,9px)] text-zinc-600">
            {PARTIES.map((party, p) => (
              <div key={party} className="space-y-[0.7em]">
                <p className="font-semibold text-zinc-800">{party}</p>
                {BLANKS.map((b) => {
                  const anchor = `${p}-${b.key}`;
                  return (
                    <p key={b.key} className="flex items-end gap-[0.4em]">
                      <span className="shrink-0">{b.label}:</span>
                      {/* The blank itself: detected fields are drawn inside it. */}
                      <span
                        data-blank={anchor}
                        className={cn("relative min-w-0 flex-1 border-b border-dashed border-zinc-400", b.kind === "signature" ? "h-[2.6em]" : "h-[1.7em]")}
                      >
                        {fields.map((f, i) => f.anchor === anchor && (
                          <FieldChip key={f.id} field={f} index={i} className="absolute inset-x-0 bottom-[0.15em] top-0" onRemove={remove} />
                        ))}
                      </span>
                    </p>
                  );
                })}
              </div>
            ))}
          </div>

          {fields.map((f, i) => !f.anchor && (
            <FieldChip
              key={f.id} field={f} index={i} onRemove={remove}
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              className={cn("absolute", f.kind === "signature" ? "h-[6%] w-[34%]" : "h-[5%] w-[26%]")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldChip({ field: f, index, className, style, onRemove }: {
  field: Field; index: number; className?: string; style?: React.CSSProperties; onRemove: (id: string) => void;
}) {
  return (
    <span
      data-field
      style={{ ...style, animationDelay: f.anchor ? `${index * 90}ms` : undefined }}
      className={cn(
        "group flex items-center justify-between rounded-md px-1.5 text-[clamp(7px,0.9vw,10px)] font-semibold ring-2 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in",
        SIGNER_TONES[f.signer].bg, SIGNER_TONES[f.signer].ring, SIGNER_TONES[f.signer].text,
        className,
      )}
    >
      <span className="truncate">{f.label} · {SIGNERS[f.signer].name.split(" ")[0]}</span>
      <button
        type="button" onClick={() => onRemove(f.id)}
        className="rounded p-0.5 opacity-60 hover:opacity-100" aria-label={`Remove ${f.label} field`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
