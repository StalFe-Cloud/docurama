import { createFileRoute } from "@tanstack/react-router";
import { AcceptInvite } from "@/components/onboarding/accept-invite";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Join your team on Docurama" },
      { name: "description", content: "Accept your workspace invitation and start signing." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AcceptInvite,
});
