"use client";

/**
 * Homepage playground: a clickable miniature of the Docurama workspace.
 *
 * The visitor drives it: switch tabs, send reminders and get scripted signer
 * replies, auto-detect fields, sign, verify the seal, tamper with the audit
 * chain, call the API. Tabs share one store, so an envelope sent from the
 * Builder shows up in Documents, signing it seals it, and its code verifies.
 * Sample data only; nothing leaves the browser.
 */

import { useEffect, useRef, useState } from "react";
import {
  Code2, FileSignature, FileText, Inbox, LayoutTemplate, MousePointerClick, PenTool, RotateCcw, ScrollText, ShieldCheck, Users,
} from "lucide-react";
import { BrandMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import type { TabKey } from "./data";
import { PlaygroundProvider, usePlayground } from "./store";
import { DocumentsTab } from "./tab-documents";
import { BuilderTab } from "./tab-builder";
import { SigningTab } from "./tab-signing";
import { VerifyTab } from "./tab-verify";
import { TemplatesTab } from "./tab-templates";
import { AuditTab } from "./tab-audit";
import { TeamTab } from "./tab-team";
import { ApiTab } from "./tab-api";

const TABS: { key: TabKey; label: string; icon: typeof Inbox }[] = [
  { key: "documents", label: "Documents", icon: Inbox },
  { key: "builder", label: "Builder", icon: PenTool },
  { key: "signing", label: "Signing", icon: FileSignature },
  { key: "verify", label: "Verify", icon: ShieldCheck },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "audit", label: "Audit trail", icon: ScrollText },
  { key: "team", label: "Team", icon: Users },
  { key: "api", label: "API", icon: Code2 },
];

const HINT_KEY = "docurama.playground.hint";

export function Playground() {
  // Remounting the provider is the reset: every tab returns to its sample state.
  const [generation, setGeneration] = useState(0);
  return (
    <PlaygroundProvider key={generation}>
      <PlaygroundShell onReset={() => setGeneration((g) => g + 1)} />
    </PlaygroundProvider>
  );
}

function PlaygroundShell({ onReset }: { onReset: () => void }) {
  const { state, setTab } = usePlayground();
  const [hint, setHint] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // The tip appears once per session, after the page has settled.
  useEffect(() => {
    let seen = false;
    try { seen = window.sessionStorage.getItem(HINT_KEY) === "1"; } catch { /* storage blocked */ }
    if (seen) return;
    const timer = window.setTimeout(() => setHint(true), 1400);
    return () => window.clearTimeout(timer);
  }, []);

  const dismissHint = () => {
    setHint(false);
    try { window.sessionStorage.setItem(HINT_KEY, "1"); } catch { /* storage blocked */ }
  };

  const choose = (key: TabKey) => { setTab(key); if (hint) dismissHint(); };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + TABS.length) % TABS.length;
    choose(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  const active = TABS.find((t) => t.key === state.tab)!;

  return (
    <div className="w-full">
      <div
        role="tablist" aria-label="Product areas"
        className="-mx-4 flex snap-x gap-1 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:justify-center sm:px-0"
      >
        {TABS.map((t, i) => {
          const selected = state.tab === t.key;
          return (
            <button
              key={t.key} ref={(el) => { tabRefs.current[i] = el; }}
              type="button" role="tab" id={`pg-tab-${t.key}`} aria-controls="pg-panel" aria-selected={selected} tabIndex={selected ? 0 : -1}
              onClick={() => choose(t.key)} onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.98]",
                selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <div className="overflow-hidden rounded-2xl border bg-card text-left shadow-[0_24px_60px_-28px_rgba(15,122,90,0.25)]">
          {/* Workspace bar */}
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <BrandMark className="h-5 w-5" />
            <span className="text-xs font-semibold">StålFe AB</span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">Starter workspace</span>
            <span className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onReset} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" title="Reset the demo">
                <RotateCcw className="h-3 w-3" aria-hidden /> Reset
              </button>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground" aria-label="Signed in as Alexandra Fischer">AF</span>
            </span>
          </div>
          <div id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${active.key}`} className="h-[34rem] sm:h-[32rem]">
            {state.tab === "documents" && <DocumentsTab />}
            {state.tab === "builder" && <BuilderTab />}
            {state.tab === "signing" && <SigningTab />}
            {state.tab === "verify" && <VerifyTab />}
            {state.tab === "templates" && <TemplatesTab />}
            {state.tab === "audit" && <AuditTab />}
            {state.tab === "team" && <TeamTab />}
            {state.tab === "api" && <ApiTab />}
          </div>
        </div>

        {hint && (
          <div
            role="status"
            className="absolute right-3 top-12 z-10 w-64 rounded-xl border border-primary/30 bg-background p-3.5 text-left shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 sm:-right-4"
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MousePointerClick className="h-4 w-4 text-primary" aria-hidden /> This demo is clickable
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Open any tab and try it: send a reminder, auto-detect fields, sign, verify the seal.
            </p>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={dismissHint} className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98]">
                Got it
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <FileText className="h-3 w-3" aria-hidden /> Sample data. Everything runs in your browser and nothing is sent.
      </p>
    </div>
  );
}
