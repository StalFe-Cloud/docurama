import { createFileRoute } from "@tanstack/react-router";
import DevelopersPage from "@/components/pages/developers";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      { title: "Developers · Docurama API" },
      { name: "description", content: "REST API, webhooks and MCP server for Docurama document signing." },
      { property: "og:title", content: "Developers · Docurama API" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DevelopersPage,
});
