"use client";

// pdf.js necesita el navegador: la vista previa se carga solo en el cliente.
import dynamic from "next/dynamic";

const loading = () => <p className="rounded-[10px] bg-[#E9E6E0] px-4 py-10 text-center text-[13px] text-muted-foreground">Preparando la vista previa…</p>;

export const OutputPreview = dynamic(() => import("./output-preview").then((m) => m.OutputPreview), { ssr: false, loading });
export const SourcePreview = dynamic(() => import("./output-preview").then((m) => m.SourcePreview), { ssr: false, loading });
