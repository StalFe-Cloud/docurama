import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { PortalRoot } from "@/components/portal/portal-root";
import { SESSION_TOKEN_STORE } from "@/lib/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Docurama: Sign documents. Record evidence." },
      {
        name: "description",
        content:
          "Email-link document signing with typed adoption, immutable contract terms, explicit consent and digest evidence.",
      },
      { property: "og:title", content: "Docurama: Sign documents. Record evidence." },
      {
        property: "og:description",
        content:
          "Email-link document signing with typed adoption, immutable contract terms, explicit consent and digest evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  // Signed-in users land in the workspace; visitors see the marketing site.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setSignedIn(!!window.localStorage.getItem(SESSION_TOKEN_STORE));
    } catch {
      setSignedIn(false);
    }
  }, []);

  if (signedIn === null) {
    return <div className="min-h-screen bg-background" aria-busy />;
  }
  return signedIn ? <PortalRoot /> : <MarketingPage />;
}
