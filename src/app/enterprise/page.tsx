import type { Metadata } from "next";
import { EnterpriseLeadForm } from "@/components/marketing/enterprise-lead-form";

export const metadata: Metadata = {
  title: "Docurama Enterprise - custom seats, volume and price",
  description:
    "Negotiated seats, envelope volume and pricing for regulated teams: SSO/SAML, bring-your-own certificates, PAdES B-LTA sealing, legal hold and EU data residency.",
};

/**
 * Public Enterprise lead page. Form submissions create an EnterpriseLead row
 * worked by the platform team in the admin pipeline; nothing here promises
 * certifications we do not hold — capabilities are described as implemented.
 */
export default function EnterprisePage() {
  return <EnterpriseLeadForm />;
}
