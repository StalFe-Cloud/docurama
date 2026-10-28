import { createFileRoute } from "@tanstack/react-router";
import TermsPage from "@/components/pages/terms";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of service · Docurama" },
      { name: "description", content: "The terms that govern use of the Docurama platform." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: TermsPage,
});
