import Link from "next/link";
/** Curated links, not an all-to-all keyword/link block. Safe in client and server trees. */
export function KnowledgeLinks(){
  return <section aria-label="Document workflow guides" className="border-t bg-muted/20">
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6"><div className="flex flex-wrap items-baseline justify-between gap-4"><h2 className="text-xl font-semibold">Make your next document workflow clearer.</h2><Link className="text-sm underline" href="/blog">Explore the knowledge library</Link></div>
      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Link className="rounded-xl border bg-background p-5 hover:border-primary" href="/blog/prepare-pdf-for-signing"><h3 className="font-semibold">Prepare a document</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Check the version, fields and recipient roles before sending.</p></Link>
        <Link className="rounded-xl border bg-background p-5 hover:border-primary" href="/blog/what-signing-evidence-proves"><h3 className="font-semibold">Understand the evidence</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Separate recorded facts, file integrity and identity assurance.</p></Link>
        <Link className="rounded-xl border bg-background p-5 hover:border-primary" href="/blog/document-workflow-pilot"><h3 className="font-semibold">Run a useful pilot</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Test the exception paths, not just a successful signature.</p></Link>
      </div>
    </div>
  </section>;
}
