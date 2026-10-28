import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents · Docurama" },
      { name: "description", content: "Send, track and manage signature envelopes." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalRoot,
});
