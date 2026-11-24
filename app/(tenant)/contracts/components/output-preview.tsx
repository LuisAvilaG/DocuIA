"use client";

// Primera página del documento generado de un caso, para verlo sin descargarlo.
// Se lee la versión PDF (la misma de «PDF para compartir») con pdf.js.
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function OutputPreview({ caseId, fullHref }: { caseId: string; fullHref?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [pages, setPages] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className="rounded-[10px] bg-[#E9E6E0] p-4">
        <div ref={frame} className="min-h-[220px]">
          <Document key={caseId} file={`/api/v1/contracts/cases/${caseId}/output?format=pdf`} onLoadSuccess={(pdf) => setPages(pdf.numPages)}
            loading={<p className="py-10 text-center text-[13px] text-muted-foreground">Preparando la vista previa…</p>}
            error={<p className="py-10 text-center text-[13px] text-muted-foreground">No se pudo mostrar la vista previa. Descarga el documento para verlo.</p>}>
            <Page pageNumber={1} width={width} renderAnnotationLayer={false} renderTextLayer={false} className="shadow-[0_2px_16px_rgba(30,32,41,0.14)]" />
          </Document>
        </div>
      </div>
      {pages > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          Página 1 de {pages}
          {fullHref && <> · <a href={fullHref} className="font-semibold text-link hover:underline">Ver en el caso</a></>}
        </p>
      )}
    </>
  );
}
