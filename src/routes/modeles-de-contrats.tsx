import { createFileRoute } from "@tanstack/react-router";
import ModelesDeContratsPage from "@/components/pages/modeles-de-contrats";

export const Route = createFileRoute("/modeles-de-contrats")({
  head: () => ({
    meta: [
      { title: "Modèles de contrats prêts à signer · Docurama" },
      {
        name: "description",
        content:
          "Modèles contractuels conformes au droit français: prestation de services, CDI, NDA, bail commercial et RGPD.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ModelesDeContratsPage,
});
