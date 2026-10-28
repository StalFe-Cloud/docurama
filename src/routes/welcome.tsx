import { createFileRoute } from "@tanstack/react-router";
import { WelcomeWizard } from "@/components/onboarding/welcome-wizard";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Start your free trial · Docurama" },
      { name: "description", content: "Create your Docurama workspace and send your first document for signature." },
    ],
  }),
  component: WelcomeWizard,
});
