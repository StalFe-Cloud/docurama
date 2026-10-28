import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, formatDate, relatedBlogPosts, getBlogTopic } from "@/lib/blog";
import { articleSchema, safeJsonLd, BLOG_AUTHOR, AUTHOR_PATH, SITE_URL } from "@/lib/seo";
import { MarkdownBody } from "@/components/docs/markdown-body";
import { BlogLayout } from "@/components/blog/blog-layout";
type Props = { params: Promise<{ slug: string }> };
export default function BlogPostPage({ slug }: { slug: string }) {
  const {slug}=await params;
  const post=getBlogPost(slug);
  if(!post) notFound();
  const related=relatedBlogPosts(post);
  return <BlogLayout>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(articleSchema(post))}} />
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/">Home</Link> / <Link href="/blog">Knowledge</Link> / <span>{post.title}</span></nav>
      <article className="mt-8">
        <nav aria-label="Article topics" className="flex flex-wrap gap-2">{post.tags.map((tag)=><Link key={tag} href={`/blog/topics/${tag}`} className="rounded-full border px-3 py-1 text-xs">{getBlogTopic(tag).title}</Link>)}</nav>
        <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{post.title}</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.description}</p>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-b pb-6 text-sm text-muted-foreground">
          {post.author===BLOG_AUTHOR?<Link rel="author" href={AUTHOR_PATH}>{post.author}</Link>:<span>{post.author}</span>}
          <span>Published <time dateTime={post.date}>{formatDate(post.date)}</time></span>
          {post.updated&&post.updated!==post.date&&<span>Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time></span>}
          <span>{post.readingMinutes} min read</span>
        </div>
        <MarkdownBody>{post.content}</MarkdownBody>
      </article>
      <aside className="mt-10 rounded-xl border bg-muted/30 p-6"><h2 className="font-semibold">Put the guide into practice</h2><p className="mt-2 text-sm leading-7">Use a non-sensitive sample in the <Link className="underline" href="/docs/getting-started/tutorial-send-first-envelope">signing tutorial</Link> and compare the results with the <Link className="underline" href="/docs/compliance/eidas">documented assurance limits</Link>. See the <Link className="underline" href="/docs">documentation</Link> for deployment-specific setup.</p></aside>
      {related.length>0&&<section aria-label="Related articles" className="mt-12 border-t pt-8"><h2 className="text-xl font-semibold">Related reading</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{related.map((p)=><Link key={p.slug} href={`/blog/${p.slug}`} className="rounded-xl border p-5 hover:border-primary"><h3 className="font-semibold">{p.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{p.description}</p></Link>)}</div></section>}
      <p className="mt-10 text-sm"><Link className="underline" href="/blog">Browse all knowledge articles</Link></p>
    </div>
  </BlogLayout>;
}
