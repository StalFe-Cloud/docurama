import type { BlogSummary } from "./blog";
export const SITE_URL = "https://docurama.eu";
export const BLOG_AUTHOR = "Sriram Rajan";
export const AUTHOR_PATH = "/authors/sriram-rajan";
export const SITEMAP_CHUNK_SIZE = 5000;
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
export function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function authorSchema(name: string) {
  return name === BLOG_AUTHOR ? { "@type": "Person", name, url: SITE_URL + AUTHOR_PATH, "@id": SITE_URL + AUTHOR_PATH + "#person" } : { "@type": "Organization", name };
}
export function articleSchema(post: BlogSummary) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org", "@graph": [
      { "@type":"BlogPosting", "@id":`${url}#article`, headline:post.title, description:post.description,
        datePublished:post.date, ...(post.updated ? {dateModified:post.updated} : {}),
        author:authorSchema(post.author), publisher:{"@type":"Organization",name:"VOIRIA SASU",alternateName:"Docurama",url:SITE_URL},
        mainEntityOfPage:{"@type":"WebPage","@id":url}, url, inLanguage:"en", wordCount:post.wordCount,
        isPartOf:{"@type":"Blog","@id":`${SITE_URL}/blog#blog`,name:"Docurama Knowledge",url:`${SITE_URL}/blog`} },
      { "@type":"BreadcrumbList", itemListElement:[
        {"@type":"ListItem",position:1,name:"Home",item:SITE_URL},
        {"@type":"ListItem",position:2,name:"Knowledge",item:`${SITE_URL}/blog`},
        {"@type":"ListItem",position:3,name:post.title,item:url},
      ]},
    ],
  };
}
export function sitemapChunkCount(count: number): number { return Math.ceil(count / SITEMAP_CHUNK_SIZE); }
export function sitemapXml(posts: BlogSummary[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${posts.map((p) =>
    `<url><loc>${xmlEscape(`${SITE_URL}/blog/${p.slug}`)}</loc><lastmod>${p.updated ?? p.date}</lastmod></url>`).join("")}</urlset>`;
}
export const XML_HEADERS = { "Content-Type":"application/xml; charset=utf-8", "Cache-Control":"public, max-age=0, s-maxage=3600" };
export const TEXT_HEADERS = { "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"public, max-age=0, s-maxage=3600", "X-Robots-Tag":"noindex" };
