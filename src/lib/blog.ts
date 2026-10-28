import fs from "node:fs";
import path from "node:path";

export interface BlogSummary {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  draft: boolean;
  readingMinutes: number;
  wordCount: number;
}
export interface BlogPost extends BlogSummary { content: string }
const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const INDEX_FILE = path.join(BLOG_DIR, "index.json");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BLOG_PAGE_SIZE = 24;

export function validBlogSlug(slug: string): boolean {
  return slug.length <= 200 && SLUG.test(slug);
}
export function validContentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function parsePost(slug: string, raw: string): BlogPost | null {
  if (!validBlogSlug(slug)) return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  try {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const v = kv[2].trim();
      meta[kv[1]] = v.startsWith('"') ? JSON.parse(v) :
        v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
    }
  } catch { return null; }
  if (!meta.title || !meta.description || !validContentDate(meta.date ?? "")) return null;
  if (meta.updated && (!validContentDate(meta.updated) || meta.updated < meta.date)) return null;
  const tags = (meta.tags ?? "").replace(/^\[|\]$/g, "").split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, "")).filter((t) => SLUG.test(t));
  const content = match[2].trim();
  const wordCount = content ? content.split(/\s+/).length : 0;
  return {
    slug, title: meta.title, description: meta.description, date: meta.date,
    updated: meta.updated || undefined, author: meta.author || "Docurama Team",
    tags: [...new Set(tags)], draft: meta.draft !== "false", content, wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 210)),
  };
}
export function isPublished(post: BlogSummary, today = new Date().toISOString().slice(0, 10)): boolean {
  return !post.draft && validContentDate(post.date) && post.date <= today &&
    (!post.updated || (validContentDate(post.updated) && post.updated >= post.date && post.updated <= today));
}
/** Caches live on globalThis, not module scope: Next.js dev compiles each
 * route as its own module instance, so a module-level cache would hold one
 * parsed copy of the 54 MB index per route and OOM small hosts (14 routes
 * import this module; one shared copy keeps dev peak memory flat). Production
 * route bundles can also duplicate this module across chunks, so the sharing
 * is not dev-only. Same pattern as the Prisma client global. */
type BlogCacheStore = {
  cached?: { fingerprint: string; posts: BlogSummary[] };
  publicCache?: { fingerprint: string; day: string; posts: BlogSummary[] };
  taxonomyCache?: { posts: BlogSummary[]; tags: Map<string, BlogSummary[]>; cloud: { tag: string; count: number }[] };
  topicCache?: { mtime: number; data: Record<string, BlogTopic> };
};
const blogCacheStore: BlogCacheStore = ((globalThis as typeof globalThis & { __docuramaBlogCache?: BlogCacheStore }).__docuramaBlogCache ??= {});
/** Metadata only. The full corpus is never loaded to render a list or sitemap. */
export function listBlogPosts(): BlogSummary[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  const hasIndex = fs.existsSync(INDEX_FILE);
  const stat = fs.statSync(hasIndex ? INDEX_FILE : BLOG_DIR);
  const fingerprint = `${hasIndex}:${stat.mtimeMs}:${stat.size}`;
  if (!blogCacheStore.cached || blogCacheStore.cached.fingerprint !== fingerprint) {
    let posts: BlogSummary[];
    if (hasIndex) {
      const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
      if (index.version !== 1 || !Array.isArray(index.posts)) throw new Error("Invalid blog index; run content:index");
      posts = index.posts;
    } else {
      // Development/backward compatibility. Production builds create index.json.
      posts = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md")).flatMap((f) => {
        const parsed = parsePost(f.slice(0, -3), fs.readFileSync(path.join(BLOG_DIR, f), "utf8"));
        if (!parsed) return [];
        const { content: _content, ...summary } = parsed;
        return [summary];
      });
    }
    blogCacheStore.cached = { fingerprint, posts: posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)) };
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!blogCacheStore.publicCache || blogCacheStore.publicCache.fingerprint !== fingerprint || blogCacheStore.publicCache.day !== day) {
    blogCacheStore.publicCache = { fingerprint, day, posts: blogCacheStore.cached.posts.filter((post) => isPublished(post, day)) };
  }
  return blogCacheStore.publicCache.posts;
}
export function getBlogPost(slug: string): BlogPost | null {
  // Reject, rather than normalize, traversal/ambiguous slugs.
  if (!validBlogSlug(slug)) return null;
  const file = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const post = parsePost(slug, fs.readFileSync(file, "utf8"));
  return post && isPublished(post) ? post : null;
}
function taxonomy() {
  const posts = listBlogPosts();
  if (!blogCacheStore.taxonomyCache || blogCacheStore.taxonomyCache.posts !== posts) {
    const tags = new Map<string, BlogSummary[]>();
    for (const post of posts) for (const tag of post.tags) {
      const items = tags.get(tag);
      if (items) items.push(post); else tags.set(tag, [post]);
    }
    const cloud = [...tags].map(([tag, items]) => ({tag, count:items.length}))
      .sort((a,b) => b.count-a.count || a.tag.localeCompare(b.tag));
    blogCacheStore.taxonomyCache = {posts, tags, cloud};
  }
  return blogCacheStore.taxonomyCache;
}
/** Indexed metadata references only; callers must not mutate the returned arrays. */
export function postsForBlogTag(tag: string): BlogSummary[] { return taxonomy().tags.get(tag) ?? []; }
export function blogTagCloud(): { tag: string; count: number }[] { return taxonomy().cloud; }
export function relatedBlogPosts(post: BlogSummary, limit = 4): BlogSummary[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const tags = taxonomy().tags;
  const scores = new Map<BlogSummary, number>();
  for (const tag of post.tags) for (const candidate of tags.get(tag) ?? []) {
    if (candidate.slug !== post.slug) scores.set(candidate, (scores.get(candidate) ?? 0) + 1);
  }
  // Keep only the best requested results instead of allocating and sorting the full corpus.
  const best: {post:BlogSummary;score:number}[] = [];
  const compare = (a:{post:BlogSummary;score:number},b:{post:BlogSummary;score:number}) =>
    b.score-a.score || b.post.date.localeCompare(a.post.date) || a.post.slug.localeCompare(b.post.slug);
  for (const [candidate, score] of scores) {
    const entry = {post:candidate, score};
    if (best.length === limit && compare(entry,best[best.length-1]) >= 0) continue;
    let at = best.findIndex((item) => compare(entry,item)<0);
    if (at<0) at=best.length;
    best.splice(at,0,entry);
    if (best.length>limit) best.pop();
  }
  return best.map((entry)=>entry.post);
}
export function formatDate(iso: string): string {
  if (!validContentDate(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric", timeZone:"UTC" });
}

export interface BlogTopic { title: string; description: string; kind: string }
export function getBlogTopic(tag: string): BlogTopic {
  const file = path.join(BLOG_DIR, "topics.json");
  if (fs.existsSync(file)) {
    const mtime = fs.statSync(file).mtimeMs;
    if (!blogCacheStore.topicCache || blogCacheStore.topicCache.mtime !== mtime) blogCacheStore.topicCache = {mtime, data: JSON.parse(fs.readFileSync(file, "utf8"))};
    if (blogCacheStore.topicCache.data[tag]) return blogCacheStore.topicCache.data[tag];
  }
  return {title: tag.replace(/-/g, " "), description: `Practical ${tag.replace(/-/g, " ")} guidance and related product documentation.`, kind: "topic"};
}
