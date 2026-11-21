"use client";

// pdf.js necesita el navegador (DOMMatrix): cargado en el servidor, la pestaña
// «Documentos» del caso respondía con error 500.
import dynamic from "next/dynamic";

export const CaseDocuments = dynamic(() => import("./case-documents").then((m) => m.CaseDocuments), {
  ssr: false,
  loading: () => <p className="text-[13px] text-muted-foreground">Cargando documentos…</p>,
});
