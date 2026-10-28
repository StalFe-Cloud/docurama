import { notFound } from "next/navigation";
import { BlogList } from "@/components/blog/blog-list";
import { validBlogSlug } from "@/lib/blog";

export default function BlogTagPage({ tag }: { tag: string }) {
  if (!validBlogSlug(tag)) notFound();
  return <BlogList tag={tag} />;
}
