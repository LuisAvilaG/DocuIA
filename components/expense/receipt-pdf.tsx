"use client";

// A PDF receipt shown inside the app. Opened in its own tab it depends on the
// browser's PDF viewer, which does not load a file served with the "sandbox"
// policy that every stored file carries. Read through pdf.js (a plain download
// by the page) it shows in every browser, and that policy stays as it is.
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MAX_PAGES = 30;

export function ReceiptPdf({ url, maxWidth = 720 }: { url: string; /** Narrower when the receipt sits in a column beside its expense. */ maxWidth?: number }) {
  const [pages, setPages] = useState(0);
  // Rendered in the browser only (loaded without SSR), so the window is there.
  const [width] = useState(() => Math.max(280, Math.min(maxWidth, window.innerWidth - 96)));
  return (
    <Document
      file={url}
      onLoadSuccess={(pdf) => setPages(pdf.numPages)}
      loading={<p className="p-6 text-center text-xs text-muted-foreground">Cargando comprobante…</p>}
      error={<p className="p-6 text-center text-xs text-destructive">No se pudo mostrar el comprobante. Descárgalo para abrirlo.</p>}
    >
      {Array.from({ length: Math.min(pages, MAX_PAGES) }, (_, index) => (
        <Page key={index} pageNumber={index + 1} width={width} renderAnnotationLayer={false} renderTextLayer={false} className="mx-auto mb-3 w-fit shadow-sm" />
      ))}
      {pages > MAX_PAGES && <p className="pb-2 text-center text-xs text-muted-foreground">Se muestran las primeras {MAX_PAGES} páginas de {pages}. Descárgalo para verlo completo.</p>}
    </Document>
  );
}
