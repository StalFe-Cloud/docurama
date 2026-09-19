import { expect, test } from "bun:test";
import { getBlogPost, listBlogPosts } from "../src/lib/blog";

test("frontmatter quotes are parsed before blog headings and authors are rendered", () => {
  const post = getBlogPost("docurama-is-live");
  expect(post?.title).toBe("Docurama is live: sign documents, prove everything");
  expect(post?.author).toBe("Docurama Team");
  expect(listBlogPosts().some((p) => p.slug === post?.slug)).toBe(true);
});
