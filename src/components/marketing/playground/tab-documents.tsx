"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AtSign, Link2, Lock, MessageCircle, Search, Send, Smartphone, Sparkles, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, initials, type Channel, type Envelope } from "./data";
import { usePlayground } from "./store";

const CHANNELS: { key: Channel; label: string; icon: typeof AtSign }[] = [
  { key: "email", label: "Email", icon: AtSign },
  { key: "sms", label: "SMS", icon: Smartphone },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "link", label: "Signing link", icon: Link2 },
];

type Mode = "reminder" | "note" | "smart";

function smartReminder(env: Envelope): string {
  const signer = env.signers.find((s) => s.status !== "SIGNED");
  const first = signer?.name.split(" ")[0] ?? "there";
  return `Hi ${first}, a quick reminder about "${env.title}". It takes about two minutes to sign, and your personal link is below. Thank you!`;
}

export function DocumentsTab() {
  const { state, select, post } = usePlayground();
  const [query, setQuery] = useState("");
  const [mobileDetail, setMobileDetail] = useState(false);
  const selected = state.envelopes.find((e) => e.id === state.selectedId) ?? state.envelopes[0];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? state.envelopes.filter((e) => `${e.title} ${e.code} ${e.signers.map((s) => s.name).join(" ")}`.toLowerCase().includes(q)) : state.envelopes;
  }, [query, state.envelopes]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Envelope inbox */}
      <aside className={cn("min-h-0 flex-col border-r", mobileDetail ? "hidden md:flex" : "flex")} aria-label="Envelopes">
        <label className="relative m-3">
          <span className="sr-only">Search envelopes</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search envelopes"
            className="h-8 w-full rounded-lg border bg-background pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No envelope matches "{query}".</li>}
          {list.map((e) => {
            const last = e.thread[e.thread.length - 1];
            const active = e.id === selected.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => { select(e.id); setMobileDetail(true); }}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-l-2 px-3 py-2.5 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                    {initials(e.signers.find((s) => s.status !== "SIGNED")?.name ?? e.signers[0].name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-xs", e.unread ? "font-semibold" : "font-medium")}>{e.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{last.text}</span>
                  </span>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_TONE[e.status])} title={STATUS_LABEL[e.status]} aria-label={STATUS_LABEL[e.status]} />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Envelope conversation */}
      <section className={cn("min-h-0 flex-col", mobileDetail ? "flex" : "hidden md:flex")} aria-label={selected.title}>
        <EnvelopeThread env={selected} onBack={() => setMobileDetail(false)} onPost={post} />
      </section>
    </div>
  );
}

function EnvelopeThread({ env, onBack, onPost }: {
  env: Envelope;
  onBack: () => void;
  onPost: (id: string, kind: "out" | "note", text: string, channel: Channel) => void;
}) {
  const [channel, setChannel] = useState<Channel>("email");
  const [mode, setMode] = useState<Mode>("reminder");
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const closed = env.status === "COMPLETED" || env.status === "DECLINED";

  // Scroll the thread itself, never the page: scrollIntoView would also move
  // the window and make the homepage jump whenever a message arrives.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [env.thread.length, env.id]);

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === "smart") setDraft(smartReminder(env));
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onPost(env.id, mode === "note" ? "note" : "out", text, channel);
    setDraft("");
    if (mode === "smart") setMode("reminder");
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <button type="button" onClick={onBack} className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden" aria-label="Back to envelopes">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{env.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            <span className="font-mono">{env.code}</span> · {env.pages} pages
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline-flex">
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[env.status])} aria-hidden />
          {STATUS_LABEL[env.status]}
        </span>
      </header>

      {/* Signers and delivery channel */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {env.signers.map((s) => (
            <span key={s.email} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px]">
              <span className="font-medium">{s.name}</span>
              <span className={cn(s.status === "SIGNED" ? "text-primary" : "text-muted-foreground")}>
                {s.status === "SIGNED" ? "signed" : s.status === "VIEWED" ? "viewed" : "pending"}
              </span>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5" role="radiogroup" aria-label="Reminder channel">
          {CHANNELS.map((c) => (
            <button
              key={c.key} type="button" role="radio" aria-checked={channel === c.key} title={c.label}
              onClick={() => setChannel(c.key)}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                channel === c.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <c.icon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4" aria-live="polite">
        {env.thread.map((item) => {
          if (item.kind === "event") {
            return (
              <p key={item.id} className="mx-auto w-fit max-w-[90%] rounded-full bg-background px-3 py-1 text-center text-[11px] text-muted-foreground shadow-sm motion-safe:animate-in motion-safe:fade-in">
                {item.text} <span className="opacity-70">{item.at}</span>
              </p>
            );
          }
          const mine = item.kind !== "in";
          return (
            <div key={item.id} className={cn("flex items-end gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1", mine && "flex-row-reverse")}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials(item.actor)}</span>
              <div className={cn(
                "max-w-[78%] rounded-xl px-3 py-2 text-xs leading-relaxed",
                item.kind === "in" && "bg-background shadow-sm",
                item.kind === "out" && "bg-primary text-primary-foreground",
                item.kind === "note" && "border border-dashed bg-background text-foreground",
              )}>
                {item.kind === "note" && (
                  <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground"><Lock className="h-2.5 w-2.5" aria-hidden /> Internal note, only your team sees this</span>
                )}
                {item.kind === "out" && item.channel && (
                  <span className="mb-0.5 block text-[10px] opacity-80">Reminder by {CHANNELS.find((c) => c.key === item.channel)?.label}</span>
                )}
                {item.text}
                <span className={cn("mt-1 block text-right text-[10px]", item.kind === "out" ? "opacity-75" : "text-muted-foreground")}>{item.at}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer: reminder, internal note, smart reminder */}
      <div className="border-t bg-background">
        <div className="flex gap-1 px-3 pt-2" role="tablist" aria-label="Message type">
          {([
            ["reminder", "Reminder", Send],
            ["note", "Internal note", StickyNote],
            ["smart", "Smart reminder", Sparkles],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key} type="button" role="tab" aria-selected={mode === key}
              onClick={() => pickMode(key)}
              className={cn(
                "inline-flex items-center gap-1 border-b-2 px-2 pb-1.5 text-[11px] font-medium transition-colors",
                mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{mode === "note" ? "Internal note" : "Reminder message"}</span>
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={closed && mode !== "note" ? "This envelope is closed. Internal notes still work." : mode === "note" ? "Write a note for your team" : "Write a reminder, or try Smart reminder"}
              disabled={closed && mode !== "note"}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </label>
          <button
            type="submit" disabled={!draft.trim() || (closed && mode !== "note")}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> {mode === "note" ? "Save" : "Send"}
          </button>
        </form>
      </div>
    </>
  );
}
