"use client";

import dynamic from "next/dynamic";

// Lazy wrapper: react-pdf + pdfjs-dist (~400 KB) load only when a document
// preview actually mounts, keeping it out of the route's initial bundle.
export const DocPreview = dynamic(
  () => import("./doc-preview").then((m) => m.DocPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Cargando visor…
      </div>
    ),
  },
);
