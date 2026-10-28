import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/marketing/marketing-page";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Docurama: Sign documents. Record evidence." },
      {
        name: "description",
        content:
          "Email-link document signing with typed adoption, immutable contract terms, explicit consent and digest evidence.",
      },
      { property: "og:title", content: "Docurama: Sign documents. Record evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketingPage,
});
