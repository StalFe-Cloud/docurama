"use client";

import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATES, type Template } from "./data";
import { usePlayground } from "./store";

const CATEGORIES = ["All", "Sales", "HR", "Procurement", "Legal"] as const;

export function TemplatesTab() {
  const { applyTemplate } = usePlayground();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => TEMPLATES.filter((t: Template) =>
    (category === "All" || t.category === category) && t.name.toLowerCase().includes(query.trim().toLowerCase())), [category, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="flex gap-1 overflow-x-auto" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
              className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-48">
          <span className="sr-only">Search templates</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates"
            className="h-8 w-full rounded-lg border bg-background pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No template matches. Upload any PDF and AI Auto-Detect places the fields for you.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <li key={t.id} className="group flex flex-col rounded-xl border bg-background p-3 transition hover:border-primary/40 hover:shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-4 w-4" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.category} · {t.pages} {t.pages > 1 ? "pages" : "page"} · {t.fields} fields</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Used {t.uses} times</span>
                  <button type="button" onClick={() => applyTemplate(t.name)}
                    className="rounded-md border px-2 py-1 text-[11px] font-medium transition hover:border-primary hover:text-primary active:scale-[0.98]">
                    Use template
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
