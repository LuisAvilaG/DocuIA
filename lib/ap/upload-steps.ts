// The steps the upload panel draws for one document: what is done, what is
// running and where it stopped. Pure, so the panel only has to paint them.

export type StepState = "done" | "active" | "pending" | "failed" | "attention" | "waiting";

export interface UploadStep {
  title: string;
  /** What is happening in the step, or what came out of it. */
  detail: string | null;
  state: StepState;
}

export interface UploadProgressInput {
  /** Panel status ("pending", "uploading") or the document's status once it exists. */
  status: string;
  /** Where the pipeline is or stopped: "read", "match", "checks" or "send". */
  stage?: string | null;
  /** The server already has the document. */
  received: boolean;
  /** "A-1234 · Proveedor · $1,200.00": what was read from the header, if anything. */
  readSummary?: string | null;
  /** Why it stopped or what it waits for, already written for a person. */
  reason?: string | null;
  /** "$1,200.00 · ERP 5521" for a document already in the ERP. */
  sentSummary?: string | null;
  /** Waiting for a provider batch: it can take hours. */
  batch?: boolean;
}

const STAGE_INDEX: Record<string, number> = { read: 1, match: 2, checks: 3, send: 4 };
const TITLES = ["Subir el archivo", "Leer el documento", "Identificar proveedor y productos", "Validar contra tus reglas", "Enviar al ERP"] as const;
const RUNNING = [
  "Subiendo…",
  "Leyendo proveedor, número, importes y líneas…",
  "Buscando en los catálogos de tu ERP y revisando que no esté repetido…",
  "Orden de compra, datos fiscales y reglas del proveedor…",
  "Enviando al ERP…",
] as const;

/** Index of the step in course (0–4), or 5 when the document no longer moves on its own. */
export function activeStep(input: Pick<UploadProgressInput, "status" | "stage">): number {
  switch (input.status) {
    case "pending": case "uploading": return 0;
    case "queued": case "uploaded": return 1;
    case "extracting": return Math.min(3, STAGE_INDEX[input.stage ?? "read"] ?? 1);
    case "processing": case "approved": return 4;
    default: return 5;
  }
}

export function uploadSteps(input: UploadProgressInput): UploadStep[] {
  const { status } = input;
  const failed = status === "failed";
  // A failed document stops at the step it was in; one never received, at the upload.
  const at = failed ? (input.received ? STAGE_INDEX[input.stage ?? "read"] ?? 1 : 0) : activeStep(input);
  const waitingInLine = status === "queued" || status === "uploaded";

  const steps: UploadStep[] = TITLES.map((title, i) => {
    if (i < at) {
      const detail = i === 1 ? input.readSummary ?? null : null;
      return { title, detail, state: "done" as const };
    }
    if (i > at) return { title, detail: null, state: "pending" as const };
    if (failed) return { title, detail: input.reason ?? "No se pudo completar este paso.", state: "failed" as const };
    const detail = i === 1 && waitingInLine
      ? input.batch ? "En espera de su lote; puede tardar." : "En cola; empieza en un momento."
      : RUNNING[i];
    return { title, detail, state: "active" as const };
  });
  if (failed || at < 5) return steps;

  // Settled: the last step says how it ended.
  const last = steps.length - 1;
  if (status === "completed") steps[last] = { title: "En el ERP", detail: input.sentSummary ?? null, state: "done" };
  else if (status === "review") steps[last] = { title: "Pasa a revisión", detail: input.reason ?? "Revísalo y envíalo al ERP.", state: "attention" };
  else if (status === "pending_approval") steps[last] = { title: "Espera aprobación", detail: input.reason ?? "Un aprobador lo revisa antes de enviarlo al ERP.", state: "waiting" };
  else if (status === "awaiting_receipt") steps[last] = { title: "Espera la entrada de almacén", detail: input.reason ?? "Se envía solo cuando almacén registre la recepción.", state: "waiting" };
  return steps;
}
