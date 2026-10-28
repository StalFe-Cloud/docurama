import { createFileRoute } from "@tanstack/react-router";
import BlogIndexPage from "@/components/pages/blog-index";

export const Route = createFileRoute("/blog")({
  head: () => ({
    meta: [
      { title: "Knowledge · Docurama" },
      {
        name: "description",
        content: "Practical guides on electronic signatures, evidence records and compliance.",
      },
      { property: "og:title", content: "Docurama Knowledge" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: BlogIndexPage,
});
