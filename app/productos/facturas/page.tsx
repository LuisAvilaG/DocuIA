import type { Metadata } from "next";
import ApAutomationClient from "@/components/landing/ap-automation-client";

export const metadata: Metadata = {
  title: "AP Automation — Facturas y OC con IA | DocuIA",
  description:
    "Facturas, órdenes de compra y CFDI leídos completos con IA, cotejados contra tus reglas y la OC, con detección de duplicados y mapeos que se aprenden. La transacción aterriza en tu ERP.",
  openGraph: {
    title: "AP Automation — Facturas y OC con IA | DocuIA",
    description:
      "Factura que llega, asiento que cuadra: extracción, cotejo, duplicados y mapeos aprendidos, directo a tu ERP.",
    locale: "es_MX",
    type: "website",
  },
};

export default function ApAutomationPage() {
  return <ApAutomationClient />;
}
