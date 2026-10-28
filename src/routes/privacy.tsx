import { createFileRoute } from "@tanstack/react-router";
import PrivacyPage from "@/components/pages/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy · Docurama" },
      { name: "description", content: "What data Docurama collects, why, and how to exercise your GDPR rights." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PrivacyPage,
});
