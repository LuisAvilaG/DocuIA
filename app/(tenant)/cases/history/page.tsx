import { redirect } from "next/navigation";

// Historial se unió a Casos (rediseño 2026, fase 4): la lista tiene vistas por estado.
export default function CasesHistoryPage() {
  redirect("/cases?view=done");
}
