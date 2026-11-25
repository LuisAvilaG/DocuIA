"use client";

// Primera página de un documento, para verlo sin descargarlo: el documento
// generado de un caso (su versión PDF, la misma de «PDF para compartir») o uno
// de los documentos que se subieron al caso. Se pinta con pdf.js.
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const box = "rounded-[10px] bg-[#E9E6E0] p-4";
const note = "py-10 text-center text-[13px] text-muted-foreground";
// A document that was uploaded can weigh more than 100 MB: only the parts of
// the file that the first page needs are requested, never the rest.
const FIRST_PAGE_ONLY = { disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 };

function FirstPage({ file, partial, failed, onPages }: { file: string; partial?: boolean; failed: string; onPages: (pages: number) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={box}>
      <div ref={frame} className="min-h-[220px]">
        <Document key={file} file={file} options={partial ? FIRST_PAGE_ONLY : undefined} onLoadSuccess={(pdf) => onPages(pdf.numPages)}
          loading={<p className={note}>Preparando la vista previa…</p>}
          error={<p className={note}>{failed}</p>}>
          <Page pageNumber={1} width={width} renderAnnotationLayer={false} renderTextLayer={false} className="shadow-[0_2px_16px_rgba(30,32,41,0.14)]" />
        </Document>
      </div>
    </div>
  );
}

export function OutputPreview({ caseId, fullHref, stamp }: { caseId: string; fullHref?: string; /** When the case last changed: a regenerated document is never read from the browser's cache. */ stamp?: string | number }) {
  const [pages, setPages] = useState(0);
  return (
    <>
      <FirstPage file={`/api/v1/contracts/cases/${caseId}/output?format=pdf${stamp ? `&v=${encodeURIComponent(stamp)}` : ""}`} onPages={setPages}
        failed="No se pudo mostrar la vista previa. Descarga el documento para verlo." />
      {pages > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          Página 1 de {pages}
          {fullHref && <> · <a href={fullHref} className="font-semibold text-link hover:underline">Ver en el caso</a></>}
        </p>
      )}
    </>
  );
}

export interface SourceDocument { id: string; name: string; mime: string | null }

/** The documents uploaded to a case: the first page of the chosen one. */
export function SourcePreview({ documents, fullHref }: { documents: SourceDocument[]; /** Where the documents are read whole. */ fullHref: string }) {
  const [docId, setDocId] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const doc = documents.find((d) => d.id === docId) ?? documents[0] ?? null;
  if (!doc) return <p className="text-[13px] text-muted-foreground">Este caso no tiene documentos.</p>;

  const mime = (doc.mime ?? "").toLowerCase();
  const kind = mime.includes("pdf") ? "pdf" : mime.startsWith("image/") ? "image" : "other";
  const file = `/api/v1/contracts/documents/${doc.id}/file`;
  const several = documents.length > 1;

  return (
    <>
      {several && (
        <select aria-label="Documento del caso" value={doc.id} onChange={(e) => { setDocId(e.target.value); setPages(0); }}
          className="min-h-[34px] w-full rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px]">
          {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {kind === "pdf" ? (
        <FirstPage file={file} partial onPages={setPages} failed="No se pudo mostrar la vista previa. Ábrelo en el caso para verlo." />
      ) : kind === "image" ? (
        <div className={box}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file} alt={`Documento ${doc.name}`} className="mx-auto max-h-[460px] w-auto max-w-full shadow-[0_2px_16px_rgba(30,32,41,0.14)]" />
        </div>
      ) : (
        <div className={box}><p className={note}>Este tipo de archivo no se puede ver aquí. Ábrelo en el caso.</p></div>
      )}
      <p className="break-words text-[12.5px] text-muted-foreground">
        {!several && <>{doc.name} · </>}
        {kind === "pdf" && pages > 0 && <>Página 1 de {pages} · </>}
        <a href={fullHref} className="font-semibold text-link hover:underline">Ver completo</a>
      </p>
    </>
  );
}
