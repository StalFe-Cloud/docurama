import { notFound } from "next/navigation";
import { BlogList } from "@/components/blog/blog-list";
import { validBlogSlug, getBlogTopic } from "@/lib/blog";
type Props={params:Promise<{tag:string}>};
export default function Page({params}:Props) {
  const {tag}=await params;
  if(!validBlogSlug(tag)) notFound();
  return <BlogList tag={tag} />;
}
