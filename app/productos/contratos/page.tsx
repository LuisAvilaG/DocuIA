import type { Metadata } from "next";
import ContractIntelligenceClient from "@/components/landing/contract-intelligence-client";

export const metadata: Metadata = {
  title: "Contract Intelligence — Flujos documentales con IA | DocuIA",
  description:
    "Motor genérico de análisis, validación cruzada y generación de documentos. Defines el flujo (tipos, campos, reglas, plantilla) y la IA lo ejecuta: clasifica, extrae con cita literal, valida entre documentos y genera el PDF final.",
  openGraph: {
    title: "Contract Intelligence — Flujos documentales con IA | DocuIA",
    description:
      "Tú defines el flujo, la IA lo ejecuta: clasifica, extrae con cita, valida cruzando documentos y genera el PDF. Sin código, sin ERP.",
    locale: "es_MX",
    type: "website",
  },
};

export default function ContractsProductPage() {
  return <ContractIntelligenceClient />;
}
