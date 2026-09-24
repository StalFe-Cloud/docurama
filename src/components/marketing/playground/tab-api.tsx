"use client";

import { useState } from "react";
import { Loader2, Play, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayground } from "./store";

type EndpointKey = "create" | "get" | "remind" | "verify";

const ENDPOINTS: { key: EndpointKey; method: "GET" | "POST"; path: string; label: string }[] = [
  { key: "create", method: "POST", path: "/v1/envelopes", label: "Create and send" },
  { key: "get", method: "GET", path: "/v1/envelopes/{code}", label: "Get status" },
  { key: "remind", method: "POST", path: "/v1/envelopes/{code}/remind", label: "Send reminder" },
  { key: "verify", method: "GET", path: "/v1/verify/{code}", label: "Public verify" },
];

const CREATE_BODY = `{
  "title": "Consulting agreement, Kvarn Studio",
  "document_id": "doc_5f2a9c",
  "signers": [
    { "name": "Sofia Lindqvist", "email": "sofia@kvarnstudio.se" }
  ]
}`;

export function ApiTab() {
  const { state, create, post } = usePlayground();
  const [endpoint, setEndpoint] = useState<EndpointKey>("create");
  const [body, setBody] = useState(CREATE_BODY);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<{ status: number; json: unknown } | null>(null);
  const target = state.envelopes[0];
  const ep = ENDPOINTS.find((e) => e.key === endpoint)!;
  const path = ep.path.replace("{code}", target.code);

  const send = () => {
    setBusy(true);
    setResponse(null);
    window.setTimeout(() => {
      if (endpoint === "create") {
        try {
          const input = JSON.parse(body) as { title?: string; signers?: { name?: string; email?: string }[] };
          const signers = (input.signers ?? []).filter((s) => s.name && s.email).map((s) => ({ name: s.name!, email: s.email!, company: "" }));
          if (!input.title || signers.length === 0) throw new Error("title and at least one signer are required");
          const env = create({ title: input.title, pages: 3, signers, via: "api" });
          setResponse({ status: 201, json: { code: env.code, status: "SENT", signers: signers.map((s) => ({ email: s.email, status: "PENDING" })), verify_url: `https://verify.docurama.eu/${env.code}` } });
        } catch (err) {
          setResponse({ status: 422, json: { error: err instanceof Error ? err.message : "Invalid JSON body" } });
        }
      } else if (endpoint === "get") {
        setResponse({ status: 200, json: { code: target.code, title: target.title, status: target.status, signers: target.signers.map((s) => ({ email: s.email, status: s.status })) } });
      } else if (endpoint === "remind") {
        const open = target.status !== "COMPLETED" && target.status !== "DECLINED";
        if (open) post(target.id, "out", "Automated reminder sent through the API.", "email");
        setResponse(open ? { status: 202, json: { code: target.code, reminded: target.signers.filter((s) => s.status !== "SIGNED").map((s) => s.email) } } : { status: 409, json: { error: `Envelope is ${target.status.toLowerCase()}` } });
      } else {
        setResponse(target.status === "COMPLETED"
          ? { status: 200, json: { result: "VERIFIED", code: target.code, seal: { format: "docurama-seal/2", integrity: "INTACT", binds: ["document", "signers", "audit-trail", "field-values"], timestamp: { tsa: "timestamp.digicert.com" } }, signers: target.signers.length } }
          : { status: 200, json: { result: "NOT_SEALED", code: target.code, status: target.status } });
      }
      setBusy(false);
    }, 550);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Endpoint">
          {ENDPOINTS.map((e) => (
            <button key={e.key} type="button" role="radio" aria-checked={endpoint === e.key} onClick={() => { setEndpoint(e.key); setResponse(null); }}
              className={cn("rounded-md px-2 py-1 text-[11px] font-medium transition-colors", endpoint === e.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-[11px]">
          <span className={cn("font-semibold", ep.method === "POST" ? "text-primary" : "text-sky-600 dark:text-sky-400")}>{ep.method}</span>
          <span className="min-w-0 truncate">https://api.docurama.eu{path}</span>
          <button type="button" onClick={send} disabled={busy}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 font-sans text-[11px] font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-60">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />} Send
          </button>
        </div>
        {endpoint === "create" && (
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Request body (editable)</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} spellCheck={false}
              className="mt-1 w-full resize-none rounded-lg border bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
        )}
        <div aria-live="polite">
          <p className="text-[11px] font-medium text-muted-foreground">Response</p>
          <pre className="mt-1 min-h-24 overflow-x-auto rounded-lg border bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
            {busy ? "…" : response
              ? <><span className={response.status < 300 ? "text-emerald-400" : "text-rose-400"}>HTTP {response.status}</span>{"\n"}{JSON.stringify(response.json, null, 2)}</>
              : <span className="text-zinc-500">Press Send to call the sandbox.</span>}
          </pre>
        </div>
      </div>
      <aside className="min-h-0 overflow-y-auto border-t p-4 lg:border-l lg:border-t-0" aria-label="Webhook deliveries">
        <p className="flex items-center gap-1.5 text-xs font-semibold"><Webhook className="h-3.5 w-3.5 text-primary" aria-hidden /> Webhook deliveries</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Signed with HMAC-SHA256, retried with backoff.</p>
        <ul className="mt-3 space-y-1.5">
          {state.deliveries.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
              <span className="font-mono">{d.event}</span>
              <span className="ml-auto font-mono text-primary">{d.status}</span>
              <span className="text-muted-foreground">{d.at}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
