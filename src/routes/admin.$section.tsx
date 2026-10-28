import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/admin/$section")({
  head: () => ({
    meta: [
      { title: "Admin console · Docurama" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalRoot,
});
