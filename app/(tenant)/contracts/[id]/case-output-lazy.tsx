"use client";

// pdf.js necesita el navegador: la pestaña «Documento» se carga solo en el cliente.
import dynamic from "next/dynamic";

const loading = () => <p className="px-6 py-5.5 text-[13px] text-muted-foreground md:px-8">Cargando el documento…</p>;

export const CaseOutput = dynamic(() => import("./case-output").then((m) => m.CaseOutput), { ssr: false, loading });
export const GenerateOutput = dynamic(() => import("./case-output").then((m) => m.GenerateOutput), { ssr: false, loading });
