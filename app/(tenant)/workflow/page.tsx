import { redirect } from "next/navigation";

// La carga vive ahora en Documentos, como panel lateral (rediseño 2026, fase 2).
export default function WorkflowPage() {
  redirect("/documents?upload=1");
}
