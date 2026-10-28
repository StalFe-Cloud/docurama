import { createFileRoute } from "@tanstack/react-router";
import ResetPasswordPage from "@/components/pages/reset-password";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password · Docurama" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});
