"use client";

/**
 * Signer document preview — the embedded page viewer of /sign/{token}.
 *
 * Renders the envelope's attached PDF one page at a time through the
 * token-gated renderer (/api/sign/{token}/pages/{n}), keeping the signer
 * portal's one-page philosophy: review, adopt, sign — no wizard, no tabs.
 *
 * Design notes:
 *  - Plain <img>, not an iframe/embed: identical behaviour on every device
 *    (mobile browsers hijack native PDF embeds), and it keeps the document
 *    inside Docurama's chrome where the SHA-256 and consent live.
 *  - Graceful degradation: if a page fails to render the signer still sees
 *    the metadata card + integrity digest from the parent — signing is never
 *    blocked by a rendering hiccup.
 *  - Keyboard: ← / → flip pages when the viewer has focus.
 */

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SignDocument = { filename: string; pages: number; sha256: string };

export interface PreviewField {
  id: string;
  type: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientEmail: string;
  recipientName: string;
  label?: string;
}

export function SignDocumentPreview({
  token,
  document: doc,
  fields,
  currentRecipientEmail,
  onFieldClick,
}: {
  token: string;
  document: SignDocument;
  fields?: PreviewField[];
  currentRecipientEmail?: string;
  onFieldClick?: (field: PreviewField) => void;
}) {
  const [page, setPage] = useState(1);
  // Derived lifecycle, no effects: a page is "loading" until the <img> for
  // exactly that page reports onLoad (key={page} forces a fresh element per
  // page, so the callbacks always refer to the current one).
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [errorPage, setErrorPage] = useState<number | null>(null);
  const state = errorPage === page ? "error" : loadedPage === page ? "ready" : "loading";

  const src = `/api/sign/${encodeURIComponent(token)}/pages/${page}?dpi=150`;

  // SSR hydration race: the server-rendered <img> starts loading the moment
  // the HTML arrives — on a slow-hydrating client the image can FINISH before
  // React attaches onLoad, and the load event is then lost forever (the
  // overlay would spin eternally on an image that is already on screen).
  // Checking completeness at ref-attach time closes that gap; fresh loads
  // still go through onLoad. useCallback keyed on page: the key={page} on
  // the <img> re-attaches the ref for every page flip.
  const attachImg = useCallback((el: HTMLImageElement | null) => {
    if (!el) return;
    if (el.complete) {
      if (el.naturalWidth > 0) setLoadedPage(page);
      else setErrorPage(page);
    }
  }, [page]);

  const go = (delta: number) => {
    setPage((p) => Math.min(doc.pages, Math.max(1, p + delta)));
  };

  return (
    <Card data-testid="doc-preview">
      <CardContent className="space-y-3 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Document preview
          </p>
          <p className="truncate text-xs text-muted-foreground" title={doc.filename}>{doc.filename}</p>
        </div>

        <div
          role="region"
          aria-label={`Document preview, page ${page} of ${doc.pages}. Use left and right arrow keys to flip pages.`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
          }}
          className="relative overflow-hidden rounded-lg border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* The page itself. key={page} guarantees a fresh load per page so
              onLoad/onError fire for THIS page, not a cached previous one.
              Bounded height (DocuSign-style reader pane): a full-size A4
              render would push the pager and the rest of the flow far below
              the fold on every device. */}
          <img
            key={page}
            ref={attachImg}
            src={src}
            alt={`Page ${page} of ${doc.pages} of ${doc.filename}`}
            data-testid="doc-preview-img"
            onLoad={() => { setLoadedPage(page); setErrorPage(null); }}
            onError={() => { setErrorPage(page); }}
            className={cn(
              "mx-auto block h-auto w-full max-w-full max-h-[60vh] object-contain bg-white transition-opacity",
              state === "ready" ? "opacity-100" : "opacity-0",
            )}
          />

          {/* Placed signature holders for the current page */}
          {state === "ready" && (
            <div className="absolute inset-0 pointer-events-none">
              {(fields || []).filter((f) => f.pageNumber === page).map((f) => {
                const isMine = !currentRecipientEmail || f.recipientEmail.toLowerCase() === currentRecipientEmail.toLowerCase();
                return (
                  <div
                    key={f.id}
                    onClick={() => onFieldClick?.(f)}
                    style={{
                      left: `${f.x}%`,
                      top: `${f.y}%`,
                      width: `${f.width}%`,
                      height: `${f.height}%`,
                    }}
                    className={cn(
                      "absolute flex items-center justify-center rounded border-2 p-1 text-xs cursor-pointer pointer-events-auto transition-all shadow-sm select-none",
                      isMine
                        ? "border-blue-600 bg-blue-500/25 text-blue-700 font-semibold ring-2 ring-blue-400/50 hover:bg-blue-500/35"
                        : "border-slate-400 bg-slate-200/40 text-slate-500 opacity-60"
                    )}
                    title={isMine ? "Click to sign here" : `Assigned to ${f.recipientName}`}
                  >
                    <span className="truncate text-[11px] font-bold uppercase tracking-tight">
                      {isMine ? "✍️ Sign Here" : f.label || "Signature"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {state === "loading" && (
            <div className="absolute inset-0 flex min-h-64 items-center justify-center" aria-live="polite">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Rendering page {page}…
              </span>
            </div>
          )}

          {state === "error" && (
            <div className="flex min-h-64 items-center justify-center p-6" role="alert">
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                This page could not be rendered. You can still review the document details above and
                sign — the file integrity is independently verified by its SHA-256 digest.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline" size="sm"
            data-testid="doc-preview-prev"
            aria-label="Previous page"
            onClick={() => go(-1)} disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
          </Button>
          <p data-testid="doc-preview-page" className="font-mono text-xs text-muted-foreground">
            Page {page} of {doc.pages}
          </p>
          <Button
            variant="outline" size="sm"
            data-testid="doc-preview-next"
            aria-label="Next page"
            onClick={() => go(1)} disabled={page >= doc.pages}
          >
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
