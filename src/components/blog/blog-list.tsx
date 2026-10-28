import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_PAGE_SIZE, blogTagCloud, formatDate, listBlogPosts, postsForBlogTag, getBlogTopic } from "@/lib/blog";
import { safeJsonLd, SITE_URL } from "@/lib/seo";
import { BlogLayout } from "./blog-layout";
export function blogListPath(page: number, tag?: string): string {
  const base = tag ? `/blog/topics/${tag}` : "/blog";
  return page === 1 ? base : `${base}/page/${page}`;
}
export function BlogList({ page = 1, tag }: { page?: number; tag?: string }) {
  const all = tag ? postsForBlogTag(tag) : listBlogPosts();
  const totalPages = Math.max(1, Math.ceil(all.length / BLOG_PAGE_SIZE));
  if (!Number.isSafeInteger(page) || page < 1 || page > totalPages || (tag && !all.length)) notFound();
  const posts = all.slice((page-1)*BLOG_PAGE_SIZE, page*BLOG_PAGE_SIZE);
  const path = blogListPath(page, tag);
  const heading = tag ? `${getBlogTopic(tag).title}: workflow guides` : "Document signing, explained.";
  return <BlogLayout>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html:safeJsonLd({
      "@context":"https://schema.org", "@type":"CollectionPage", name:heading, url:SITE_URL+path,
      mainEntity:{"@type":"ItemList", itemListElement:posts.map((p,i) => ({"@type":"ListItem",position:(page-1)*BLOG_PAGE_SIZE+i+1,name:p.title,url:`${SITE_URL}/blog/${p.slug}`}))},
    }) }} />
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/">Home</Link> / <Link href="/blog">Knowledge</Link>{tag ? ` / ${tag.replace(/-/g," ")}` : ""}</nav>
    <div className="mt-6 max-w-3xl"><p className="text-xs font-semibold uppercase tracking-widest text-primary">Docurama Knowledge</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{heading}</h1>
      <p className="mt-5 text-base leading-7 text-muted-foreground">{tag ? getBlogTopic(tag).description : "Practical guides to preparing documents, collecting signatures, understanding evidence and running reliable workflows. Start with the question you need to answer."}</p>
      <p className="mt-4 text-sm text-muted-foreground">{all.length} articles{totalPages > 1 ? ` / Page ${page} of ${totalPages}` : ""}</p>
    </div>
    <nav aria-label="Knowledge topics" className="mt-8 flex flex-wrap gap-2">
      <Link href="/blog" className="rounded-full border px-3 py-2 text-sm">All topics</Link>
      {blogTagCloud().slice(0, 12).map(({tag:t,count}) => <Link key={t} href={`/blog/topics/${t}`} aria-current={tag===t ? "page" : undefined} className="rounded-full border px-3 py-2 text-sm hover:border-primary">{getBlogTopic(t).title} <span className="text-muted-foreground">({count})</span></Link>)}
      <Link href="/blog/topics" className="rounded-full border px-3 py-2 text-sm font-semibold">Browse every topic</Link>
    </nav>
    <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => <article key={p.slug} className="flex flex-col rounded-2xl border bg-card p-6">
        <p className="text-xs text-muted-foreground"><time dateTime={p.date}>{formatDate(p.date)}</time> / {p.readingMinutes} min read</p>
        <h2 className="mt-3 text-lg font-semibold leading-7"><Link className="hover:text-primary" href={`/blog/${p.slug}`}>{p.title}</Link></h2>
        <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{p.description}</p>
        <p className="mt-5 text-xs text-muted-foreground">{p.author}</p>
      </article>)}
    </div>
    {totalPages > 1 && <nav aria-label="Article pagination" className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
      {page>1 ? <Link rel="prev" href={blogListPath(page-1,tag)} className="rounded-lg border px-4 py-2">Previous articles</Link> : <span />}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {[...new Set([1, page-1, page, page+1, totalPages])].filter((p)=>p>=1&&p<=totalPages).sort((a,b)=>a-b).map((p)=><Link key={p} href={blogListPath(p,tag)} aria-current={p===page?"page":undefined} className="rounded border px-3 py-2">{p}</Link>)}
      </div>
      {page<totalPages ? <Link rel="next" href={blogListPath(page+1,tag)} className="rounded-lg border px-4 py-2">Next articles</Link> : <span />}
    </nav>}
    <aside className="mt-12 rounded-2xl bg-muted/40 p-6"><h2 className="font-semibold">New to Docurama?</h2>
      <p className="mt-2 text-sm leading-7">Follow the <Link className="underline" href="/docs/getting-started/tutorial-send-first-envelope">first-envelope tutorial</Link>, then inspect the <Link className="underline" href="/docs/getting-started/tutorial-verify-a-document">verification walkthrough</Link>. Check the <Link className="underline" href="/docs/compliance/eidas">assurance limits</Link> before choosing a signing workflow.</p>
      {/* Keep the launch guide discoverable after the newest articles fill page one. */}
      <p className="mt-3 text-sm"><Link className="underline" href="/blog/docurama-is-live">Docurama: sign documents and inspect recorded evidence</Link></p>
    </aside>
  </BlogLayout>;
}
