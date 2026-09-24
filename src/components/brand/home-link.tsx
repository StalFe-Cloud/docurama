"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Logo links. Two destinations, one rule:
 *
 *   public pages (marketing, sign-in, signup, docs, blog, status, verify,
 *   legal, errors) → the marketing home on the apex domain (docurama.eu)
 *   signed-in shells → the workspace home ("/" on app.docurama.eu, where
 *   sign-in lives — see the apex→app redirect in src/middleware.ts)
 *
 * Surface sub-domains (app., docs., status., verify., …) rewrite "/" to their
 * own surface, so from there the marketing home must be the absolute apex URL.
 * The host is only known in the browser: the server snapshot is "/" and React
 * swaps in the absolute URL right after hydration without a mismatch.
 */

const SURFACE_LABELS = new Set(["app", "admin", "docs", "status", "security", "verify", "sign", "mail", "api", "www"]);

/** The marketing home for a browser location: apex for surface hosts, "/" otherwise. */
export function marketingHomeHref(location: Pick<Location, "protocol" | "hostname" | "port">): string {
  const [first, ...rest] = location.hostname.split(".");
  if (rest.length >= 2 && SURFACE_LABELS.has(first)) return `${location.protocol}//${rest.join(".")}/`;
  return "/";
}

const noSubscription = () => () => {};

export function MarketingHomeLink({
  children,
  className,
  newTab = false,
}: {
  children: ReactNode;
  className?: string;
  /** Open in a new tab — for flows that must not be abandoned (signing). */
  newTab?: boolean;
}) {
  const href = useSyncExternalStore(noSubscription, () => marketingHomeHref(window.location), () => "/");
  return (
    <a
      href={href}
      className={cn("inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      aria-label="Docurama home"
      {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
    >
      {children}
    </a>
  );
}
