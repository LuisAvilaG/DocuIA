"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// El lienzo usa React Flow, que solo funciona en el navegador.
export const ApprovalMapEditor = dynamic(
  () => import("./editor").then((m) => m.ApprovalMapEditorClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
    ),
  },
);
