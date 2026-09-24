"use client";

/**
 * Seal details shared by the public verify portal and the workspace Verify
 * page: what the seal covers, the local file check, and the failure panel
 * shown when the records no longer match what was sealed.
 */

import { useState } from "react";
import { Check, Clock, FileCheck2, FileSearch, FileX2, ListTree, Minus, ShieldAlert } from "lucide-react";
import { SEAL_FORMAT, SEAL_MISMATCH_LABELS, type SealCheck } from "@/lib/seal-shared";
import { cn } from "@/lib/utils";

function coverage(seal: SealCheck) {
  const has = (k: SealCheck["scope"][number]) => seal.scope.includes(k);
  return [
    {
      key: "document",
      label: seal.documentSha256 ? "Signed file (SHA-256 fingerprint)" : "Signed file: none, sent from a template",
      on: has("document"),
    },
    { key: "signers", label: `Signer records (${seal.bound.signers})`, on: has("signers") },
    { key: "audit-trail", label: `Audit trail (${seal.bound.events} event${seal.bound.events === 1 ? "" : "s"})`, on: has("audit-trail") },
    { key: "field-values", label: `Field values (${seal.bound.fields})`, on: has("field-values") },
  ];
}

/** What the seal binds, and whether it is anchored in the transparency log. */
export function SealCoverage({ seal }: { seal: SealCheck }) {
  const v2 = seal.format === SEAL_FORMAT;
  return (
    <div className="space-y-2.5 rounded-lg border bg-card p-3">
      <p className="text-xs font-medium">
        Seal recomputed from the records just now: they match what was sealed
      </p>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {coverage(seal).map((item) => (
          <li key={item.key} className={cn("flex items-center gap-2", !item.on && "text-muted-foreground")}>
            {item.on
              ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              : <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span>{item.label}</span>
            <span className="sr-only">{item.on ? "covered by the seal" : "not covered by the seal"}</span>
          </li>
        ))}
      </ul>
      {!v2 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This envelope was sealed before signer data was bound into the seal. Its digest covers
          {seal.documentSha256 ? " the signed file only" : " the signer roster and event list, without names, event details or field values"}.
          Envelopes sealed now also bind signer names, event details and field values.
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {seal.timestamp
          ? `RFC 3161 timestamp from ${seal.timestamp.tsa}: the seal existed at ${new Date(seal.timestamp.at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.`
          : "No trusted timestamp: the sealing time comes from Docurama's clock."}
      </p>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ListTree className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {seal.transparency.status === "MATCHES"
          ? `Seal digest committed to the workspace transparency log, entry #${seal.transparency.seq}.`
          : "Not yet committed to the transparency log (it is committed at the latest when the evidence pack is exported)."}
      </p>
    </div>
  );
}

async function sha256OfFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a copy of the file in the browser and compare fingerprints: the
 * original upload, the PAdES-signed PDF, or an earlier copy of it that a
 * long-term update (validation data, archive timestamp) has since extended.
 */
export function FileFingerprintCheck({ documentSha256, signedPdfSha256 = null, earlierSignedPdfs = [] }: {
  documentSha256: string; signedPdfSha256?: string | null; earlierSignedPdfs?: { sha256: string; level: string | null }[];
}) {
  const [state, setState] = useState<{ name: string; match: "original" | "signed" | "earlier" | null; level?: string | null } | { busy: true } | { error: string } | null>(null);

  const check = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: true });
    try {
      const hash = await sha256OfFile(file);
      const earlier = earlierSignedPdfs.find((r) => r.sha256 === hash);
      setState({
        name: file.name, level: earlier?.level,
        match: hash === documentSha256 ? "original" : hash === signedPdfSha256 ? "signed" : earlier ? "earlier" : null,
      });
    } catch {
      setState({ error: "This browser could not read the file." });
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <label className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-sm focus-within:ring-2 focus-within:ring-ring">
        <FileSearch className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="font-medium">Check your copy of the file</span>
        <span className="text-xs text-muted-foreground">Hashed on this device, never uploaded.</span>
        <input
          type="file" accept="application/pdf,.pdf" className="sr-only"
          onChange={(e) => { void check(e.target.files?.[0]); e.target.value = ""; }}
        />
        <span className="ml-auto rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">Choose file</span>
      </label>
      <div aria-live="polite">
        {state && "busy" in state && <p className="text-xs text-muted-foreground">Computing SHA-256…</p>}
        {state && "error" in state && <p className="text-xs text-destructive">{state.error}</p>}
        {state && "match" in state && (state.match ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <FileCheck2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {state.match === "signed"
              ? `${state.name} is the signed PDF sealed by Docurama, byte for byte.`
              : state.match === "earlier"
                ? `${state.name} is an earlier copy of the signed PDF${state.level ? ` (${state.level.replace("-", " ")})` : ""}, byte for byte. It is still valid; the current copy adds long-term validation data.`
                : `${state.name} is the exact file that was sent for signature.`}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <FileX2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> {state.name} is neither the original nor the signed PDF: its fingerprint differs by at least one byte.
          </p>
        ))}
      </div>
    </div>
  );
}

/** Shown instead of the verified card when the records no longer match. */
export function SealIntegrityFailed({ seal, title, tenantName, sealedAt }: {
  seal: SealCheck; title: string; tenantName: string; sealedAt: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> Not verified: the records changed after sealing
      </p>
      <p className="text-sm text-muted-foreground">
        “{title}” from {tenantName} was sealed on {new Date(sealedAt).toLocaleString("en-GB")}, but recomputing the
        seal from today&apos;s records gives a different result. These parts no longer match:
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {seal.mismatches.map((m) => <li key={m}>{SEAL_MISMATCH_LABELS[m]}</li>)}
      </ul>
      <p className="text-xs text-muted-foreground">
        Do not rely on this document until the sender explains the difference. The digest sealed at signing was{" "}
        <span className="break-all font-mono">{seal.sealDigest}</span>.
      </p>
    </div>
  );
}
