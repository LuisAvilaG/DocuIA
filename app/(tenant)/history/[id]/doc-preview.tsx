"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileX } from "lucide-react";
import type { BBox } from "@/lib/workflow/types";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocPreviewProps {
  docId: number;
  activeBbox: BBox | undefined;
  fileExt: string; // pdf | jpeg | png | webp | tiff | xml
}

function mimeFromExt(ext: string): "pdf" | "image" | "xml" | "unknown" {
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "tiff", "tif"].includes(ext)) return "image";
  if (ext === "xml") return "xml";
  return "unknown";
}

export function DocPreview({ docId, activeBbox, fileExt }: DocPreviewProps) {
  const kind = mimeFromExt(fileExt.toLowerCase());
  const fileUrl = `/api/v1/documents/${docId}/file`;

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [renderWidth, setRenderWidth] = useState(480);

  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container width for responsive PDF rendering
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setRenderWidth(Math.max(240, entry.contentRect.width - 32));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Jump to bbox page when active line changes
  useEffect(() => {
    if (activeBbox?.page) setPageNum(activeBbox.page);
  }, [activeBbox]);

  const zoomIn  = useCallback(() => setScale(s => Math.min(3, +(s + 0.25).toFixed(2))), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(0.4, +(s - 0.25).toFixed(2))), []);

  const Toolbar = () => (
    <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2 shrink-0">
      {numPages > 1 && (
        <>
          <button
            onClick={() => setPageNum(p => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {pageNum} / {numPages}
          </span>
          <button
            onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3.5 bg-border mx-0.5" />
        </>
      )}

      <button onClick={zoomOut} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">
        {Math.round(scale * 100)}%
      </span>
      <button onClick={zoomIn} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const BboxHighlight = ({ bbox, page }: { bbox: BBox | undefined; page?: number }) => {
    if (!bbox) return null;
    if (page !== undefined && bbox.page !== page) return null;
    return (
      <div
        style={{
          position:        "absolute",
          left:            `${bbox.x1 * 100}%`,
          top:             `${bbox.y1 * 100}%`,
          width:           `${(bbox.x2 - bbox.x1) * 100}%`,
          height:          `${(bbox.y2 - bbox.y1) * 100}%`,
          backgroundColor: "oklch(0.80 0.18 85 / 0.22)",
          border:          "2px solid oklch(0.58 0.18 85 / 0.65)",
          borderRadius:    "3px",
          pointerEvents:   "none",
          transition:      "all 200ms ease-out",
        }}
      />
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border">
      <Toolbar />

      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex flex-col items-center gap-4"
        style={{ backgroundColor: "oklch(0.94 0.01 258)" }}
      >
        {kind === "pdf" && (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={<p className="text-sm text-muted-foreground mt-12">Cargando documento…</p>}
            error={<p className="text-sm text-muted-foreground mt-12">No se pudo cargar el archivo</p>}
          >
            <div
              style={{
                position:     "relative",
                display:      "inline-block",
                boxShadow:    "0 2px 16px oklch(0.18 0.015 258 / 0.14)",
                borderRadius: "4px",
                overflow:     "hidden",
              }}
            >
              <Page
                pageNumber={pageNum}
                width={renderWidth * scale}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
              <BboxHighlight bbox={activeBbox} page={pageNum} />
            </div>
          </Document>
        )}

        {kind === "image" && (
          <div
            style={{
              position:     "relative",
              display:      "inline-block",
              width:        `${renderWidth * scale}px`,
              boxShadow:    "0 2px 16px oklch(0.18 0.015 258 / 0.14)",
              borderRadius: "4px",
              overflow:     "hidden",
            }}
          >
            <img
              src={fileUrl}
              alt="Documento"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
            <BboxHighlight bbox={activeBbox} />
          </div>
        )}

        {kind === "xml" && (
          <div className="w-full max-w-prose bg-card border border-border rounded-xl overflow-auto p-4">
            <p className="text-xs text-muted-foreground mb-2 font-mono">XML CFDI</p>
            <iframe
              src={fileUrl}
              title="CFDI XML"
              className="w-full border-0"
              style={{ height: `${Math.round(renderWidth * 1.3)}px` }}
            />
          </div>
        )}

        {kind === "unknown" && (
          <div className="mt-12 flex flex-col items-center gap-2 text-muted-foreground">
            <FileX className="w-8 h-8 opacity-40" />
            <p className="text-sm">Vista previa no disponible para este tipo de archivo</p>
          </div>
        )}
      </div>
    </div>
  );
}
