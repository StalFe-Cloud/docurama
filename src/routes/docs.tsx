import { createFileRoute } from "@tanstack/react-router";
import DocsIndexPage from "@/components/pages/docs-index";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docurama documentation" },
      {
        name: "description",
        content:
          "Guides and API reference for Docurama: sending envelopes, templates, verification, domains, notifications, the REST API, webhooks and signer policy.",
      },
      { property: "og:title", content: "Docurama documentation" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DocsIndexPage,
});
