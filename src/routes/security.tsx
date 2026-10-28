import { createFileRoute } from "@tanstack/react-router";
import SecurityPage from "@/components/pages/security";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security · Docurama" },
      {
        name: "description",
        content: "How Docurama protects documents, signatures and evidence: encryption, access control and audit trails.",
      },
      { property: "og:title", content: "Security · Docurama" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: SecurityPage,
});
