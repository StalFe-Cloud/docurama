import { createFileRoute } from "@tanstack/react-router";
import BlogTagPage from "@/components/pages/blog-tag";
import { getBlogTopic, validBlogSlug } from "@/lib/blog";

export const Route = createFileRoute("/blog/topics/$tag")({
  head: ({ params }) => {
    const tag = validBlogSlug(params.tag) ? params.tag : "topic";
    const topic = getBlogTopic(tag);
    return {
      meta: [
        { title: `${topic.title} guides | Docurama` },
        { name: "description", content: `Explore practical ${topic.title} articles and related Docurama documentation.` },
        { property: "og:type", content: "website" },
      ],
    };
  },
  component: BlogTagRoute,
});

function BlogTagRoute() {
  const { tag } = Route.useParams();
  return <BlogTagPage tag={tag} />;
}
