"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApChecks } from "@/lib/workflow/ap-checks";
import { Badge, Card, FiscalPanel, PoComparisonCard, money } from "./ap-panels";

interface Props {
  docId: number;
  numDoc: string | null;
  vendor: string | null;
  total: string | null;
  reason: string | null;
  apChecks: ApChecks | null;
  awaitingSince: string | null;
  nextCheckAt: string | null;
  recheckHours: number;
  maxWaitDays: number;
  onTimeout: "manual_review" | "exception";
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Step = { label: string; detail?: string | null; state: "done" | "current" | "todo" };

export function AwaitingReceiptClient(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"check" | "manual" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const po = props.apChecks?.po ?? null;
  const cmp = po?.comparison ?? null;
  const missing = cmp?.lines.filter((l) => l.status === "not_received") ?? [];

  async function run(action: "check" | "manual") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/workflow/${props.docId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage({ tone: "err", text: data.error ?? "No se pudo completar la acción" }); return; }
      if (data.status === "awaiting_receipt") {
        setMessage({ tone: "info", text: `Aún falta recepción: ${data.reason}. Próxima revisión ${fmtDateTime(data.nextCheckAt)}.` });
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setMessage({ tone: "err", text: "No se pudo conectar con el servidor" });
    } finally {
      setBusy(null);
    }
  }

  const steps: Step[] = [
    { label: props.apChecks?.fiscal ? "Extraído y validado ante el SAT" : "Extraído y revisado", detail: props.awaitingSince ? `En espera desde ${fmtDateTime(props.awaitingSince)}` : null, state: "done" },
    {
      label: cmp ? `Coincide con ${cmp.poTranid || `OC #${cmp.poInternalId}`}` : "Orden de compra elegida",
      detail: cmp ? `Diferencia ${cmp.totalDifference >= 0 ? "+" : "−"}$${money(Math.abs(cmp.totalDifference))} (${Math.abs(cmp.totalDifferencePct)}%)${cmp.totalWithinTolerance ? ", en tolerancia" : ""}` : null,
      state: "done",
    },
    {
      label: "Esperando entrada de almacén",
      detail: missing.length
        ? missing.map((l) => `${l.description}: ${(l.quantity - l.missingReceipt).toLocaleString("es-MX")} de ${l.quantity.toLocaleString("es-MX")} recibidas`).join(" · ")
        : props.reason,
      state: "current",
    },
    { label: "Crear factura en el ERP", state: "todo" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <Link href="/history" aria-label="Volver al historial" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate">{props.numDoc ? `Factura ${props.numDoc}` : `Documento #${props.docId}`}</h1>
          <p className="text-xs text-muted-foreground truncate">{props.vendor ?? "—"}{props.total ? ` · $${money(Number(props.total))}` : ""}</p>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[oklch(0.95_0.03_250)] text-[oklch(0.45_0.14_255)]">Esperando recepción</span>
      </div>

      <div className="p-6 flex flex-col lg:flex-row gap-5 items-start">
        <div className="flex-1 min-w-0 w-full flex flex-col gap-3.5">
          {cmp && <PoComparisonCard comparison={cmp} requireReceipt={po?.requireReceipt ?? true} />}
          {props.apChecks?.fiscal && <FiscalPanel fiscal={props.apChecks.fiscal} />}
        </div>

        <Card className="w-full lg:w-[400px] shrink-0 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-foreground">Seguimiento</h2>
            {props.apChecks?.vendorRule?.ruleId && <Badge tone="info">Regla: {props.apChecks.vendorRule.ruleLabel.replace(/^(Categoría|Proveedor): /, "")}</Badge>}
          </div>
          <ol className="flex flex-col gap-3">
            {steps.map((s) => (
              <li key={s.label} className="flex gap-3">
                <span className={cn(
                  "mt-1 w-2.5 h-2.5 rounded-full shrink-0",
                  s.state === "done" && "bg-success",
                  s.state === "current" && "bg-[oklch(0.50_0.14_255)] ring-4 ring-[oklch(0.50_0.14_255_/_0.15)]",
                  s.state === "todo" && "bg-border",
                )} />
                <div>
                  <p className={cn("text-[0.8125rem] font-semibold", s.state === "todo" ? "text-muted-foreground" : "text-foreground")}>{s.label}</p>
                  {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>

          <div className="rounded-lg bg-[oklch(0.97_0.015_250)] dark:bg-secondary px-3.5 py-3 flex flex-col gap-1">
            <span className="text-[0.8125rem] font-semibold text-foreground">Revisión automática cada {props.recheckHours} hora{props.recheckHours === 1 ? "" : "s"}</span>
            <span className="text-xs text-muted-foreground">
              {props.nextCheckAt ? `Próxima revisión ${fmtDateTime(props.nextCheckAt)}. ` : ""}
              Cuando la recepción esté completa se envía sola al ERP. Si pasan {props.maxWaitDays} días, {props.onTimeout === "exception" ? "se marca como excepción" : "pasa a revisión manual"}.
            </span>
          </div>

          {message && (
            <p className={cn("rounded-md px-3 py-2 text-xs", message.tone === "err" ? "bg-destructive/10 text-destructive" : message.tone === "ok" ? "bg-success/10 text-success" : "bg-secondary text-foreground")}>
              {message.text}
            </p>
          )}

          <div className="flex gap-2.5">
            <button type="button" onClick={() => run("manual")} disabled={busy !== null} className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-[0.8125rem] font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
              {busy === "manual" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Pasar a revisión manual
            </button>
            <button type="button" onClick={() => run("check")} disabled={busy !== null} className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-[0.8125rem] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy === "check" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}Revisar ahora
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
