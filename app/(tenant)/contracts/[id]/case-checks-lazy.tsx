"use client";

// pdf.js necesita el navegador (DOMMatrix): el visor de validaciones no se renderiza en el servidor.
import dynamic from "next/dynamic";

export const CaseChecks = dynamic(() => import("./case-checks").then((m) => m.CaseChecks), {
  ssr: false,
  loading: () => <p className="text-[13px] text-muted-foreground">Cargando validaciones…</p>,
});
