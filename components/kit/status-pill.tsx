import { cn } from "@/lib/utils";
import { TONE_DOT, TONE_PILL, apStatus, caseStatus, type Tone } from "@/lib/status-vocabulary";

/** Píldora de estado con el vocabulario del rediseño. */
export function StatusPill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5", TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

/** Punto + etiqueta, para columnas de estado en tablas largas. */
export function StatusDot({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px]", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}

/** Estado de una factura; `detail` agrega el motivo («Por revisar · 2 líneas sin ítem»). */
export function ApStatusPill({ status, detail, dot }: { status: string | null | undefined; detail?: string | null; dot?: boolean }) {
  const word = apStatus(status);
  const text = detail ? `${word.label} · ${detail}` : word.label;
  return dot ? <StatusDot tone={word.tone}>{text}</StatusDot> : <StatusPill tone={word.tone}>{text}</StatusPill>;
}

/** Estado de un caso de contratos. */
export function CaseStatusPill({ status, detail, dot }: { status: string | null | undefined; detail?: string | null; dot?: boolean }) {
  const word = caseStatus(status);
  const text = detail ? `${word.label} · ${detail}` : word.label;
  return dot ? <StatusDot tone={word.tone}>{text}</StatusDot> : <StatusPill tone={word.tone}>{text}</StatusPill>;
}
