import { createFileRoute } from "@tanstack/react-router";
import DocArticlePage from "@/components/pages/docs-article";
import { getDocArticle } from "@/lib/docs";

export const Route = createFileRoute("/docs/$")({
  head: ({ params }) => {
    const slug = (params._splat ?? "").split("/").filter(Boolean);
    const doc = getDocArticle(slug);
    return {
      meta: [
        { title: doc ? `${doc.meta.title} · Docurama Documentation` : "Documentation · Docurama" },
        { name: "description", content: doc?.meta.description || "Docurama developer and user documentation." },
        { property: "og:type", content: "article" },
      ],
    };
  },
  component: DocArticleRoute,
});

function DocArticleRoute() {
  const { _splat } = Route.useParams();
  return <DocArticlePage slug={(_splat ?? "").split("/").filter(Boolean)} />;
}
