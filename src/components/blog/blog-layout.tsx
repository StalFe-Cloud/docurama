import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import type { ReactNode } from "react";
export function BlogLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#knowledge-main" className="sr-only focus:not-sr-only focus:block focus:p-4">Skip to content</a>
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Docurama home"><BrandLogo size="sm" /></Link>
        <nav aria-label="Main navigation" className="flex flex-wrap gap-5 text-sm">
          <Link href="/blog">Knowledge</Link><Link href="/docs">Documentation</Link>
          <Link href="/verify">Verify a document</Link><Link href="/marketing#pricing">Pricing</Link>
        </nav>
      </div>
    </header>
    <main id="knowledge-main" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">{children}</main>
    <footer className="border-t bg-muted/20"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-5 px-4 py-8 text-sm sm:px-6">
      <p>Docurama SAS</p><nav aria-label="Footer" className="flex flex-wrap gap-4">
        <Link href="/blog">All articles</Link><Link href="/authors/sriram-rajan">Sriram Rajan</Link>
        <Link href="/feed.xml">RSS</Link><Link href="/llms.txt">Text index</Link>
        <Link href="/security">Security</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>
      </nav></div></footer>
  </div>;
}
