"use client";

/**
 * Honest cookie notice. The platform sets exactly one strictly necessary
 * cookie (the signed-in session) and loads no analytics or trackers, so this
 * is an informative notice, not a consent wall. Remembered in localStorage;
 * the store is read via useSyncExternalStore so the first paint after
 * hydration decides visibility without a setState-in-effect.
 */

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const KEY = "docurama.cookie-notice.v1";

const emptySubscribe = () => () => {};

export function CookieNotice() {
  const seen = useSyncExternalStore(
    emptySubscribe,
    () => {
      try {
        return window.localStorage.getItem(KEY) !== null;
      } catch {
        return false; // storage blocked: show once per visit
      }
    },
    () => true, // server snapshot: render nothing, decide after hydration
  );
  const [dismissed, setDismissed] = useState(false);

  if (seen || dismissed) return null;

  return (
    <div
      role="note"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-relaxed text-muted-foreground">
          We set one strictly necessary cookie to keep you signed in. No
          analytics, no trackers, no advertising. Our{" "}
          <Link className="underline underline-offset-2 hover:text-foreground" href="/docs/legal">privacy policy</Link>{" "}
          explains exactly what is stored and why.
        </p>
        <button
          type="button"
          onClick={() => {
            try { window.localStorage.setItem(KEY, "seen"); } catch { /* storage blocked */ }
            setDismissed(true);
          }}
          className="shrink-0 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
