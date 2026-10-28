import { createFileRoute } from "@tanstack/react-router";
import { PortalRoot } from "@/components/portal/portal-root";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Verify a document · Docurama" },
      { name: "description", content: "Verify a signed document's digest and attestation." },
    ],
  }),
  component: PortalRoot,
});
