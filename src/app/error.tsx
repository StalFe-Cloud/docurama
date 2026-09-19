"use client";

/**
 * Route-segment error boundary — catches render failures inside any route and
 * offers a retry before the user has to reach for the back button. The digest
 * is shown so a report to support@docurama.eu can be correlated with logs.
 */
import { useEffect } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the failure server-side too — the console is monitored.
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-4 sm:px-6">
          <Link href="/" aria-label="Docurama home"><BrandLogo tagline size="sm" /></Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col items-start px-4 py-20 sm:px-6" role="alert">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-destructive">Something broke</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          This view failed to load
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          The error was recorded. You can retry immediately — if it keeps
          happening, send the reference below to support@docurama.eu.
        </p>
        {error.digest && (
          <p className="mt-3 rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => { window.location.assign("/"); }}>
            Back to safety
          </Button>
        </div>
      </main>
    </div>
  );
}
