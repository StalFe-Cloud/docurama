import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Templates · Docurama" },
      { name: "description", content: "Reusable documents with pre-configured fields and signer roles." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalRoot,
});
