import { createFileRoute } from "@tanstack/react-router";
import BlogPostPage from "@/components/pages/blog-post";
import { getBlogPost } from "@/lib/blog";

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const post = getBlogPost(params.slug);
    if (!post) {
      return { meta: [{ title: "Article not found · Docurama" }, { name: "robots", content: "noindex, nofollow" }] };
    }
    return {
      meta: [
        { title: `${post.title} | Docurama` },
        { name: "description", content: post.description },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: BlogPostRoute,
});

function BlogPostRoute() {
  const { slug } = Route.useParams();
  return <BlogPostPage slug={slug} />;
}
