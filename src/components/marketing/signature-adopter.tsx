"use client";

/**
 * Adopt a signature: type it in a script font, draw it (mouse, touch or pen),
 * upload an image of it, or reuse the one saved on your Docurama account.
 *
 * Drawn and uploaded signatures leave this component as a PNG data URL,
 * trimmed to the ink and at most 600 x 200 px; an upload's paper background is
 * made transparent so the signature sits on the document like ink. The server
 * re-checks the image and binds its SHA-256 into the seal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, ImageUp, PenLine, Sparkles, Type } from "lucide-react";
import { cn } from "@/lib/utils";

export const SIGNATURE_FONTS = [
  { key: "caveat", label: "Caveat", cls: "signature-font-caveat" },
  { key: "dancing-script", label: "Dancing Script", cls: "signature-font-dancing" },
  { key: "great-vibes", label: "Great Vibes", cls: "signature-font-greatvibes" },
] as const;

export type AdoptMethod = "type" | "draw" | "upload" | "saved";
export type Adoption = { method: AdoptMethod; image: string | null };
export type SavedSignature = { method: "type" | "image"; value: string; font: string | null };

const MAX_W = 600;
const MAX_H = 200;

/** Crop a canvas to its ink, scale into 600 x 200, return a PNG data URL (or null when blank). */
function exportInk(source: HTMLCanvasElement): string | null {
  const ctx = source.getContext("2d");
  if (!ctx) return null;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  out.getContext("2d")!.drawImage(source, minX, minY, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

function DrawPad({ onChange }: { onChange: (image: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the element (sharp on high-DPI screens).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f2a6b";
    ctx.lineWidth = 2.4;
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = point(e);
    // Pen pressure when the device reports it; mouse and touch report 0.5.
    ctx.lineWidth = e.pressure > 0 && e.pointerType === "pen" ? 1.2 + e.pressure * 2.6 : 2.4;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvasRef.current) onChange(exportInk(canvasRef.current));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-dashed bg-card">
        <canvas
          ref={canvasRef} data-testid="signature-pad"
          className="h-40 w-full cursor-crosshair touch-none rounded-xl"
          aria-label="Signature drawing area. Draw with a mouse, finger or pen, or choose Type to type your signature instead."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
            Draw your signature here
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-muted-foreground/30" aria-hidden />
      </div>
      <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Eraser className="h-3.5 w-3.5" aria-hidden /> Clear
      </button>
    </div>
  );
}

/** Load an image file, drop its paper background, trim to the ink. */
async function processUpload(file: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Choose a PNG or JPEG image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is larger than 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This image could not be read."));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / img.width, 800 / img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum > 215) d[i + 3] = 0;
      else if (lum > 170) d[i + 3] = Math.round(d[i + 3] * (215 - lum) / 45);
    }
    ctx.putImageData(pixels, 0, 0);
    const out = exportInk(canvas);
    if (!out) throw new Error("No signature found in that image.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SignatureAdopter({
  name, font, onFont, adoption, onAdoption, saved, signedIn, save, onSave,
}: {
  name: string;
  font: string;
  onFont: (font: string) => void;
  adoption: Adoption;
  onAdoption: (a: Adoption) => void;
  saved: SavedSignature | null;
  signedIn: boolean;
  save: boolean;
  onSave: (v: boolean) => void;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const tabs: { key: AdoptMethod; label: string; icon: typeof Type }[] = [
    ...(saved ? [{ key: "saved" as const, label: "Saved", icon: Sparkles }] : []),
    { key: "type", label: "Type", icon: Type },
    { key: "draw", label: "Draw", icon: PenLine },
    { key: "upload", label: "Upload", icon: ImageUp },
  ];

  const pick = useCallback((method: AdoptMethod) => {
    onAdoption({ method, image: method === "draw" ? drawn : method === "upload" ? uploaded : null });
  }, [drawn, uploaded, onAdoption]);

  const displayName = name.trim() || "Your name";
  const savedFont = SIGNATURE_FONTS.find((f) => f.key === saved?.font) ?? SIGNATURE_FONTS[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Your signature</p>
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="How to adopt your signature">
          {tabs.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={adoption.method === t.key}
              data-testid={`adopt-${t.key}`}
              onClick={() => pick(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                adoption.method === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {adoption.method === "saved" && saved && (
        <div className="flex h-28 items-center justify-center rounded-xl border-2 border-primary bg-card p-3">
          {saved.method === "image"
            ? <img src={saved.value} alt="Your saved signature" className="max-h-full max-w-full object-contain" />
            : <span className={cn("truncate text-4xl", savedFont.cls)}>{displayName}</span>}
        </div>
      )}

      {adoption.method === "type" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Signature style">
          {SIGNATURE_FONTS.map((f) => (
            <button
              key={f.key} type="button" role="radio" aria-checked={font === f.key}
              data-testid={`font-${f.key}`}
              onClick={() => onFont(f.key)}
              className={cn(
                "flex h-24 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border-2 bg-card p-2 transition-colors",
                font === f.key ? "border-primary" : "border-transparent hover:border-muted",
              )}
            >
              <span className={cn("max-w-full truncate text-2xl leading-none", f.cls)}>{displayName}</span>
              <span className="text-[11px] text-muted-foreground">{f.label}</span>
            </button>
          ))}
        </div>
      )}

      {adoption.method === "draw" && (
        <DrawPad onChange={(image) => { setDrawn(image); onAdoption({ method: "draw", image }); }} />
      )}

      {adoption.method === "upload" && (
        <div className="space-y-2">
          <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed bg-card p-3 text-center focus-within:ring-2 focus-within:ring-ring">
            {uploaded
              ? <img src={uploaded} alt="Your uploaded signature" className="max-h-full max-w-full object-contain" />
              : <>
                  <ImageUp className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium">Choose a photo or scan of your signature</span>
                  <span className="text-xs text-muted-foreground">PNG or JPEG. The paper background is removed on this device.</span>
                </>}
            <input
              type="file" accept="image/png,image/jpeg" className="sr-only" data-testid="signature-upload"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadError(null);
                try {
                  const image = await processUpload(file);
                  setUploaded(image);
                  onAdoption({ method: "upload", image });
                } catch (err) {
                  setUploadError(err instanceof Error ? err.message : "This image could not be used.");
                }
              }}
            />
          </label>
          {uploadError && <p role="alert" className="text-xs text-destructive">{uploadError}</p>}
        </div>
      )}

      {signedIn && adoption.method !== "saved" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={save} onChange={(e) => onSave(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Save this signature to my Docurama account for next time
        </label>
      )}
    </div>
  );
}
