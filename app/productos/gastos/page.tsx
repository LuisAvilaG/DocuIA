import type { Metadata } from "next";
import ExpenseManagementClient from "@/components/landing/expense-management-client";

export const metadata: Metadata = {
  title: "Expense Management — Gastos con IA | DocuIA",
  description:
    "Tu equipo fotografía el ticket y el gasto queda extraído y categorizado según tus políticas. Fluye por aprobación con avisos automáticos y se registra en tu ERP sin recapturas.",
  openGraph: {
    title: "Expense Management — Gastos con IA | DocuIA",
    description:
      "Foto del ticket, el resto se hace solo: extracción, categorización, aprobación y registro en tu ERP.",
    locale: "es_MX",
    type: "website",
  },
};

export default function ExpenseManagementPage() {
  return <ExpenseManagementClient />;
}
