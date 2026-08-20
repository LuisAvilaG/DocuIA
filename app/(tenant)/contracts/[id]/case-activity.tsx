import { CheckCircle2, CircleDot, FileOutput, FilePenLine, FileUp, History, RotateCcw, ShieldCheck, ShieldX, Sparkles, TriangleAlert, UserRound } from "lucide-react";

export type CaseActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  actor: string | null;
  metadata?: Record<string, unknown> | null;
};

const ACTIONS: Record<string, { title: string; Icon: typeof History; tone: string }> = {
  "contract.case_created": { title: "Caso creado", Icon: CircleDot, tone: "text-primary" },
  "contract.documents_uploaded": { title: "Documentos cargados", Icon: FileUp, tone: "text-primary" },
  "contract.processing_started": { title: "Análisis iniciado", Icon: Sparkles, tone: "text-warning" },
  "contract.processing_completed": { title: "Análisis y validaciones terminados", Icon: CheckCircle2, tone: "text-success" },
  "contract.processing_failed": { title: "Análisis interrumpido", Icon: TriangleAlert, tone: "text-destructive" },
  "contract.extraction_corrected": { title: "Dato extraído corregido", Icon: FilePenLine, tone: "text-primary" },
  "contract.extraction_corrected_and_learned": { title: "Dato corregido y guardado para futuros documentos", Icon: FilePenLine, tone: "text-primary" },
  "contract.generated": { title: "Documento generado", Icon: FileOutput, tone: "text-success" },
  "contract.output_viewed": { title: "Documento generado consultado", Icon: FileOutput, tone: "text-muted-foreground" },
  "contract.approved": { title: "Caso aprobado", Icon: ShieldCheck, tone: "text-success" },
  "contract.rejected": { title: "Caso rechazado", Icon: ShieldX, tone: "text-destructive" },
  "contract.reopened": { title: "Caso reabierto", Icon: RotateCcw, tone: "text-warning" },
};

function detailsFor(item: CaseActivityItem) {
  const meta = item.metadata ?? {};
  if (item.action === "contract.documents_uploaded" && Array.isArray(meta.files)) {
    return meta.files.filter((file): file is string => typeof file === "string").join(", ");
  }
  if (item.action.startsWith("contract.extraction_corrected")) {
    const field = typeof meta.fieldKey === "string" ? meta.fieldKey.replace(/_/g, " ") : "campo";
    const original = typeof meta.originalValue === "string" ? meta.originalValue : null;
    const corrected = typeof meta.correctedValue === "string" ? meta.correctedValue : null;
    return original !== null && corrected !== null
      ? `${field}: “${original}” → “${corrected}”`
      : `${field}${meta.appliedToFuture ? " · aplicado a futuros documentos" : ""}`;
  }
  if (item.action === "contract.processing_failed" && typeof meta.message === "string") return meta.message;
  if (item.action === "contract.approved" && meta.override === true) return "Aprobado con una excepción documentada.";
  if (item.action === "contract.rejected" && typeof meta.reason === "string") return meta.reason;
  return null;
}

export function CaseActivity({ items }: { items: CaseActivityItem[] }) {
  return (
    <section aria-labelledby="case-activity-heading" className="border-t border-border pt-5">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <div>
          <h2 id="case-activity-heading" className="text-sm font-semibold text-foreground">Historial de actividad</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Registro cronológico del caso, sus documentos y decisiones.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">Todavía no hay eventos registrados para este caso.</p>
      ) : (
        <ol className="space-y-0 rounded-xl border border-border bg-card px-4 py-1">
          {items.map((item, index) => {
            const config = ACTIONS[item.action] ?? { title: item.action.replace(/^contract\./, "").replace(/_/g, " "), Icon: History, tone: "text-muted-foreground" };
            const detail = detailsFor(item);
            return (
              <li key={item.id} className="relative flex gap-3 py-3.5">
                {index < items.length - 1 && <span className="absolute left-[13px] top-10 h-[calc(100%-18px)] w-px bg-border" />}
                <span className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary ${config.tone}`}><config.Icon className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-semibold text-foreground">{config.title}</p>
                    <time className="text-[10px] tabular-nums text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("es-MX")}</time>
                  </div>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><UserRound className="h-3 w-3" />{item.actor ?? "DocuIA"}</p>
                  {detail && <p className="mt-1 text-[11px] leading-relaxed text-foreground/80 break-words">{detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
