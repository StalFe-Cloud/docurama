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
 *  - Zoom: the renderer already accepts a dpi parameter (clamped server-side
 *    to 72–300), so zooming re-requests the page at a matching resolution —
 *    text stays sharp instead of being CSS-stretched. Beyond 100% the page
 *    scrolls horizontally inside the frame; the buttons stay keyboard-reachable.
 *
 * All labels arrive via props (src/lib/signer-strings.ts) so the preview
 * speaks the recipient's language.
 */

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPageLabel, type SignerStrings } from "@/lib/signer-strings";

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

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.5;
const BASE_DPI = 150;
const MAX_DPI = 300;

export function SignDocumentPreview({
  token,
  document: doc,
  fields,
  currentRecipientEmail,
  onFieldClick,
  strings,
}: {
  token: string;
  document: SignDocument;
  fields?: PreviewField[];
  currentRecipientEmail?: string;
  onFieldClick?: (field: PreviewField) => void;
  strings: SignerStrings;
}) {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  // Derived lifecycle, no effects: a page is "loading" until the <img> for
  // exactly that page reports onLoad (key={page} forces a fresh element per
  // page, so the callbacks always refer to the current one).
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [errorPage, setErrorPage] = useState<number | null>(null);
  const state = errorPage === page ? "error" : loadedPage === page ? "ready" : "loading";

  // Zoom re-requests the page at a higher render resolution (the server
  // clamps to its own 72–300 window), so zoomed-in text is re-rasterized
  // sharp rather than scaled blurry.
  const dpi = Math.min(MAX_DPI, Math.round(BASE_DPI * zoom));
  const src = `/api/sign/${encodeURIComponent(token)}/pages/${page}?dpi=${dpi}`;

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
  const zoomBy = (delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  };

  return (
    <Card data-testid="doc-preview">
      <CardContent className="space-y-3 p-4 sm:p-6">
        {fields && fields.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {strings.fieldHint}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <FileText className="h-3.5 w-3.5" aria-hidden /> {strings.docPreview}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={doc.filename}>{doc.filename}</p>
        </div>

        <div
          role="region"
          aria-label={`${strings.docPreview}, ${formatPageLabel(strings, page, doc.pages)}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
          }}
          className={cn(
            "relative flex justify-center rounded-lg border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring p-2 sm:p-4",
            zoom > 1 ? "overflow-x-auto" : "overflow-hidden",
          )}
        >
          <div className="relative inline-block max-w-full">
            <img
              key={page}
              ref={attachImg}
              src={src}
              alt={`${formatPageLabel(strings, page, doc.pages)} — ${doc.filename}`}
              data-testid="doc-preview-img"
              onLoad={() => { setLoadedPage(page); setErrorPage(null); }}
              onError={() => { setErrorPage(page); }}
              style={zoom !== 1 ? { width: `${Math.round(zoom * 100)}%`, maxWidth: "none" } : undefined}
              className={cn(
                "block h-auto w-auto max-w-full max-h-[70vh] rounded shadow-sm bg-white transition-opacity",
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
                      onClick={() => { if (isMine) onFieldClick?.(f); }}
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
                      title={isMine ? `${f.label || f.type}` : f.recipientName}
                    >
                      <span className="truncate text-[11px] font-bold uppercase tracking-tight">
                        {f.label || f.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {state === "loading" && (
            <div className="absolute inset-0 flex min-h-64 items-center justify-center" aria-live="polite">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {strings.renderingPage} {page}…
              </span>
            </div>
          )}

          {state === "error" && (
            <div className="flex min-h-64 items-center justify-center p-6" role="alert">
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                {strings.previewError}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline" size="sm"
            data-testid="doc-preview-prev"
            aria-label={strings.previousPage}
            onClick={() => go(-1)} disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> {strings.previousPage}
          </Button>
          <p data-testid="doc-preview-page" className="font-mono text-xs text-muted-foreground">
            {formatPageLabel(strings, page, doc.pages)}
          </p>
          <Button
            variant="outline" size="sm"
            data-testid="doc-preview-next"
            aria-label={strings.nextPage}
            onClick={() => go(1)} disabled={page >= doc.pages}
          >
            {strings.nextPage} <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center justify-center gap-1.5" role="group" aria-label={strings.zoomLabel}>
          <Button
            variant="outline" size="icon" className="size-8"
            data-testid="doc-preview-zoom-out"
            aria-label={strings.zoomOut}
            onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
          >
            <ZoomOut className="h-4 w-4" aria-hidden />
          </Button>
          <p data-testid="doc-preview-zoom" className="min-w-12 text-center font-mono text-xs text-muted-foreground" aria-live="polite">
            {Math.round(zoom * 100)}%
          </p>
          <Button
            variant="outline" size="icon" className="size-8"
            data-testid="doc-preview-zoom-in"
            aria-label={strings.zoomIn}
            onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
          >
            <ZoomIn className="h-4 w-4" aria-hidden />
          </Button>
          {zoom !== 1 && (
            <Button
              variant="ghost" size="icon" className="size-8"
              data-testid="doc-preview-zoom-reset"
              aria-label={strings.zoomReset}
              title={strings.zoomReset}
              onClick={() => setZoom(1)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
