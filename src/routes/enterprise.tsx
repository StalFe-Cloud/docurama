import { createFileRoute } from "@tanstack/react-router";
import EnterprisePage from "@/components/pages/enterprise";

export const Route = createFileRoute("/enterprise")({
  head: () => ({
    meta: [
      { title: "Docurama Enterprise: dedicated cloud and self-hosted e-signature" },
      {
        name: "description",
        content:
          "Dedicated infrastructure, SSO/SAML, custom retention and self-hosted options for regulated organizations.",
      },
      { property: "og:title", content: "Docurama Enterprise" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: EnterprisePage,
});
