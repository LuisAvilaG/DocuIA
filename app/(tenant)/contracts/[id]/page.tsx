import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations, contractObligations } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import {
  CheckCircle2, XCircle, MinusCircle, ShieldCheck, ShieldAlert, ShieldX,
  FileText, Download, CalendarClock, FileInput, ListChecks, FileType,
} from "lucide-react";
import { CaseActions } from "./actions";
import { CaseDocuments, type CaseDoc } from "./case-documents";

const STATUS: Record<string, { label: string; cls: string }> = {
  uploaded:   { label: "En cola",     cls: "bg-secondary text-muted-foreground" },
  processing: { label: "Procesando",  cls: "bg-warning/10 text-warning" },
  review:     { label: "En revisión", cls: "bg-warning/10 text-warning" },
  validated:  { label: "Validado",    cls: "bg-success/10 text-success" },
  generated:  { label: "Generado",    cls: "bg-success/10 text-success" },
  approved:   { label: "Aprobado",    cls: "bg-success/10 text-success" },
  rejected:   { label: "Rechazado",   cls: "bg-destructive/10 text-destructive" },
  failed:     { label: "Error",       cls: "bg-destructive/10 text-destructive" },
};
const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

function Stage({ n, title, Icon, pill, first, last, children }: {
  n: number; title: string; Icon: typeof FileText; pill?: React.ReactNode; first?: boolean; last?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5 items-stretch">
      <div className="relative w-8 flex-none flex justify-center">
        {!first && <div className="absolute top-0 h-4 w-0.5 bg-border" />}
        {!last && <div className="absolute top-4 bottom-0 w-0.5 bg-border" />}
        <div className="relative z-10 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-4 h-4" /></div>
      </div>
      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{n} · {title}</span>
          {pill}
        </div>
        {children}
      </div>
    </div>
  );
}
const Pill = ({ children, cls }: { children: React.ReactNode; cls: string }) => (
  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{children}</span>
);

export default async function ContractCasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) notFound();

  const [documents, validations, obligations] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id) }),
    db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id) }),
    db.query.contractObligations.findMany({ where: eq(contractObligations.caseId, id), orderBy: [asc(contractObligations.dueDate)] }),
  ]);

  const result = (kase.resultJson ?? {}) as {
    outputKey?: string; missing?: string[];
    decision?: { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean } | null;
  };
  const status = STATUS[kase.status] ?? { label: kase.status, cls: "bg-secondary text-muted-foreground" };

  const docs: CaseDoc[] = documents.map((d) => ({
    id: d.id, originalName: d.originalName, mimeType: d.mimeType, detectedType: d.detectedType,
    extractedJson: (d.extractedJson ?? {}) as Record<string, unknown>,
    citationsJson: (d.citationsJson ?? {}) as Record<string, unknown>,
    detectedText: d.detectedText,
  }));

  // Verdict from validations.
  let verdict: "ok" | "warn" | "block" | null = validations.length ? "ok" : null;
  for (const v of validations) {
    if (v.ok === false && v.severity === "block") { verdict = "block"; break; }
    if (v.ok !== true && v.severity === "warn" && verdict === "ok") verdict = "warn";
  }
  const VERDICT = {
    ok:    { Icon: ShieldCheck, cls: "bg-success/10 text-success", text: "Sin observaciones" },
    warn:  { Icon: ShieldAlert, cls: "bg-warning/10 text-warning", text: "Con advertencias" },
    block: { Icon: ShieldX,     cls: "bg-destructive/10 text-destructive", text: "Con bloqueos" },
  };
  const SEV_TAG: Record<string, { label: string; cls: string }> = {
    block: { label: "Bloqueante", cls: "bg-destructive/10 text-destructive" },
    warn:  { label: "Advertencia", cls: "bg-warning/10 text-warning" },
    info:  { label: "Info", cls: "bg-success/10 text-success" },
  };
  const ruleGroups = new Map<string, typeof validations>();
  for (const v of validations) { const k = v.ruleName ?? "Validación"; (ruleGroups.get(k) ?? ruleGroups.set(k, []).get(k)!).push(v); }

  const totalFields = docs.reduce((a, d) => a + Object.keys(d.extractedJson).length, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <Link href="/contracts" className="text-xs text-muted-foreground hover:text-foreground">← Casos</Link>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">{kase.title || `Caso ${kase.id.slice(0, 8)}`}</h1>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
            {verdict && (() => { const b = VERDICT[verdict]; return <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ml-auto ${b.cls}`}><b.Icon className="w-3.5 h-3.5" /> {b.text}</span>; })()}
          </div>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">Creado el {new Date(kase.createdAt).toLocaleString("es-MX")}</p>
        </div>

        <CaseActions caseId={kase.id} status={kase.status} verdict={verdict} decision={result.decision} />
        {kase.status === "processing" && <p className="text-xs text-warning">Procesando el caso; recarga en unos segundos.</p>}
        {kase.errorMessage && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{kase.errorMessage}</div>}

        {/* Recorrido por etapas */}
        <div className="pt-1">
          <Stage n={1} title="Entrada" Icon={FileInput} first pill={<Pill cls="bg-secondary text-muted-foreground">{docs.length} documento(s)</Pill>}>
            {docs.length === 0 ? <p className="text-xs text-muted-foreground">Sin documentos.</p> : (
              <div className="flex flex-wrap gap-2">
                {docs.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground max-w-full">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{d.originalName || "Documento"}</span>
                    {d.detectedType && <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">{d.detectedType}</span>}
                  </span>
                ))}
              </div>
            )}
          </Stage>

          <Stage n={2} title="Extracción" Icon={ListChecks} pill={<Pill cls="bg-secondary text-muted-foreground">{totalFields} datos</Pill>}>
            <CaseDocuments documents={docs} />
          </Stage>

          <Stage n={3} title="Validación" Icon={ShieldCheck}
            pill={verdict ? (() => { const b = VERDICT[verdict]; return <Pill cls={b.cls}>{b.text}</Pill>; })() : <Pill cls="bg-secondary text-muted-foreground">sin reglas</Pill>}>
            {validations.length === 0 ? (
              <div className="bg-card border border-border rounded-xl px-5 py-4">
                <p className="text-xs text-muted-foreground">Este flujo no tiene reglas de validación. Agrégalas en el editor del flujo (nodos de Validación) para revisar firmantes, montos, cláusulas, fechas, etc.</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
                {[...ruleGroups.entries()].map(([ruleName, items]) => (
                  <div key={ruleName} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-foreground flex-1 min-w-0 truncate">{ruleName}</p>
                      {items[0]?.severity && SEV_TAG[items[0].severity] && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${SEV_TAG[items[0].severity].cls}`}>{SEV_TAG[items[0].severity].label}</span>}
                    </div>
                    <div className="space-y-1.5">
                      {items.map((v) => {
                        const Icon = v.ok === true ? CheckCircle2 : v.ok === false ? XCircle : MinusCircle;
                        const cls = v.ok === true ? "text-success" : v.ok === false ? "text-destructive" : "text-muted-foreground";
                        return (
                          <div key={v.id} className="flex items-start gap-2">
                            <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cls}`} />
                            <div className="min-w-0">
                              <p className="text-[11px] text-foreground break-words"><span className="font-medium">{v.subject}</span>{v.status ? ` · ${v.status}` : ""}</p>
                              {v.reason && <p className="text-[11px] text-muted-foreground break-words">{v.reason}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {obligations.length > 0 && (
              <div className="bg-card border border-border rounded-xl mt-3 overflow-hidden">
                <div className="px-5 py-2.5 border-b border-border flex items-center gap-2"><CalendarClock className="w-3.5 h-3.5 text-muted-foreground" /><p className="text-xs font-semibold text-foreground">Fechas y obligaciones</p></div>
                <ul className="divide-y divide-border">
                  {obligations.map((o) => (
                    <li key={o.id} className="px-5 py-2 flex items-center gap-2">
                      <span className="text-[11px] text-foreground flex-1 min-w-0 truncate">{o.description ?? o.type ?? "Obligación"}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{o.dueDate ? new Date(o.dueDate).toLocaleDateString("es-MX") : "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Stage>

          <Stage n={4} title="Generación" Icon={FileType} last
            pill={result.outputKey ? <Pill cls="bg-success/10 text-success">listo</Pill> : <Pill cls="bg-secondary text-muted-foreground">pendiente</Pill>}>
            <div className="bg-card border border-border rounded-xl px-5 py-4">
              {result.outputKey ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs text-foreground flex-1 truncate">Documento PDF</span>
                    <a href={`/api/v1/contracts/cases/${kase.id}/output`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline shrink-0"><Download className="w-3.5 h-3.5" /> Ver / descargar</a>
                  </div>
                  {result.missing && result.missing.length > 0 && (
                    <p className="text-[11px] text-warning">Campos sin dato ({result.missing.length}): {result.missing.slice(0, 6).map(pretty).join(", ")}{result.missing.length > 6 ? "…" : ""}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Aún no se ha generado. Usa <span className="text-foreground font-medium">“Generar documento”</span> arriba.</p>
              )}
            </div>
          </Stage>
        </div>
      </div>
    </div>
  );
}
