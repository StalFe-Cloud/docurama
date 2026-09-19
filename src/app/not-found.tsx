import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";

/**
 * Root 404 — rendered for any unmatched route. Matches the marketing surfaces'
 * look (light, bordered, emerald accent) and gives lost visitors the three
 * useful exits: home, verify a document, documentation.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-4 sm:px-6">
          <Link href="/" aria-label="Docurama home"><BrandLogo tagline size="sm" /></Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col items-start px-4 py-20 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          This page does not exist
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          The link may be outdated or mistyped. Nothing is broken on your side —
          here are the places most people are looking for.
        </p>
        <ul className="mt-8 space-y-2.5 text-sm">
          <li>
            <Link className="font-medium underline underline-offset-4 hover:text-primary" href="/">Homepage and pricing</Link>
            <span className="ml-2 text-muted-foreground">plans, live demos, FAQ</span>
          </li>
          <li>
            <Link className="font-medium underline underline-offset-4 hover:text-primary" href="/verify">Verify a document</Link>
            <span className="ml-2 text-muted-foreground">check a sealed envelope with its DOC code</span>
          </li>
          <li>
            <Link className="font-medium underline underline-offset-4 hover:text-primary" href="/docs">Documentation</Link>
            <span className="ml-2 text-muted-foreground">guides, API reference, legal documents</span>
          </li>
          <li>
            <Link className="font-medium underline underline-offset-4 hover:text-primary" href="/login">Sign in</Link>
            <span className="ml-2 text-muted-foreground">open your workspace</span>
          </li>
        </ul>
      </main>
    </div>
  );
}
