import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/settings/$tab")({
  head: () => ({
    meta: [
      { title: "Settings · Docurama" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalRoot,
});
