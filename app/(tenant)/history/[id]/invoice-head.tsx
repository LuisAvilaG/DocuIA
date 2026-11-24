import Link from "next/link";
import { ApStatusPill, StageNav, type Stage } from "@/components/kit";
import type { InvoiceTab } from "@/lib/ap/invoice-stages";

export { invoiceStages, parseInvoiceTab, INVOICE_TABS, type InvoiceTab, type StageInput } from "@/lib/ap/invoice-stages";

/** Encabezado de la factura: ruta, título, estado, datos de contexto, acciones y etapas. */
export function InvoiceHead({ title, status, statusDetail, meta, actions, stages, current }: {
  title: string;
  status: string;
  statusDetail?: string | null;
  meta: Array<string | null | undefined | false>;
  actions?: React.ReactNode;
  stages: Stage[];
  current: InvoiceTab;
}) {
  return (
    <div className="px-6 pt-5.5 md:px-8">
      <nav aria-label="Ruta" className="text-[13px]">
        <Link href="/documents" className="text-link hover:underline">Documentos</Link>
        <span className="text-muted-foreground"> / Facturas</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
            <ApStatusPill status={status} detail={statusDetail} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{meta.filter(Boolean).join(" · ")}</p>
        </div>
        {actions && <div className="mt-1.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <StageNav className="mt-4.5" label="Etapas de la factura" stages={stages} current={current} />
    </div>
  );
}

/**
 * Why the invoice waits for a person, beside its title: how sure the reading
 * was, and the reason it stopped. One line and a thin bar, so it never weighs
 * more than the title it sits next to.
 */
export function ReadingConfidence({ pct, reason }: { pct: number; reason?: string | null }) {
  return (
    <div aria-label="Por qué está en revisión" className="mt-0.5 flex max-w-[380px] flex-col gap-[3px] md:items-end md:text-right">
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">Confianza de lectura</span>
        <span role="img" aria-label={`${pct} de 100`} className="block h-1 w-[72px] rounded-sm bg-border">
          <span className="block h-full rounded-sm bg-[#B07C0E]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
        <b className="text-[15px] font-semibold tabular-nums">{pct} %</b>
      </div>
      {reason && <span className="text-[12.5px] leading-snug text-muted-foreground">En revisión: {reason}</span>}
    </div>
  );
}
