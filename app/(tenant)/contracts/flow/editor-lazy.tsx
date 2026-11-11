"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// El editor usa React Flow y pdf.js (entrenamiento visual), que solo funcionan en
// el navegador: se carga sin render en el servidor para no romper la página.
export const ContractFlowEditor = dynamic(
  () => import("./client").then((m) => m.ContractFlowClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
    ),
  },
);
