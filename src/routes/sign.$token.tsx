import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PublicSign, type SignPageState } from "@/components/marketing/public-sign";
import { apiGet } from "@/lib/client";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign a document · Docurama" },
      {
        name: "description",
        content:
          "Review and electronically sign a document shared with you via Docurama. The link is unique to you - no account needed.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SignPage,
});

type SignApiResponse = {
  envelope: {
    title: string;
    pages: number;
    senderName: string;
    senderOrg: string;
    message: string | null;
    expiresAt: string | null;
  };
  recipient: { name: string; email: string; role: string; status: string };
  consent: { schema: 1; text: string; version: string; digest: string };
};

function SignPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<SignPageState | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<SignApiResponse>(`/api/sign/${token}`)
      .then((res) => {
        if (cancelled) return;
        if (res.recipient.status === "SIGNED") {
          setState({
            phase: "signed",
            title: res.envelope.title,
            code: token.slice(-8).toUpperCase(),
            tenantName: res.envelope.senderOrg,
            recipientName: res.recipient.name,
            sealed: true,
            document: null,
          });
          return;
        }
        setState({
          phase: "active",
          consent: res.consent,
          title: res.envelope.title,
          code: token.slice(-8).toUpperCase(),
          tenantName: res.envelope.senderOrg,
          message: res.envelope.message,
          pages: res.envelope.pages,
          senderName: res.envelope.senderName,
          senderDomainVerified: "docurama.eu",
          recipientName: res.recipient.name,
          recipientEmail: res.recipient.email,
          signers: [{ name: res.recipient.name, email: res.recipient.email, status: res.recipient.status, order: 1 }],
          bodyMarkdown: null,
          document: null,
          expiresAt: res.envelope.expiresAt,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!state) return <div className="min-h-screen bg-background" aria-busy />;
  return <PublicSign token={token} locale="en" state={state} />;
}
