import { createFileRoute } from "@tanstack/react-router";
import BlogTopicsPage from "@/components/pages/blog-topics";

export const Route = createFileRoute("/blog/topics")({
  head: () => ({
    meta: [
      { title: "Browse document and workflow topics | Docurama" },
      {
        name: "description",
        content: "Find practical guides by document type, workflow task or operating situation.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: BlogTopicsPage,
});
