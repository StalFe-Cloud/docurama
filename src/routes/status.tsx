import { createFileRoute } from "@tanstack/react-router";
import StatusPage from "@/components/pages/status";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Platform status · Docurama" },
      { name: "description", content: "Live availability of the Docurama signing portal, API and verification service." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: StatusPage,
});
