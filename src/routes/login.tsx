import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · Docurama" },
      { name: "description", content: "Sign in to your Docurama workspace." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalRoot,
});
