import type { Metadata } from "next";
import LandingClient from "@/components/landing/landing-client";

export const metadata: Metadata = {
  title: "DocuIA — Facturas, gastos y contratos procesados con IA",
  description:
    "DocuIA lee facturas, gastos y contratos con IA: extrae los datos, los valida con tus reglas y los deja en tu ERP o en un documento listo para firmar. Tu equipo solo decide.",
  openGraph: {
    title: "DocuIA — Facturas, gastos y contratos procesados con IA",
    description:
      "La contabilidad que se hace sola: extracción con IA, validación con algoritmos y destino en tu ERP.",
    locale: "es_MX",
    type: "website",
  },
};

export default function LandingPage() {
  return <LandingClient />;
}
