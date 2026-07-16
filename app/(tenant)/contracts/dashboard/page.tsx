import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations, contractObligations } from "@/db/schema";
import { and, eq, desc, count, isNotNull } from "drizzle-orm";
import { ScrollText, CheckCircle2, Loader, ShieldAlert, CalendarClock, ArrowRight, Upload } from "lucide-react";

// Classify a rule-defined signer status into a semantic tone.
function signerTone(status: string): "ok" | "warn" | "bad" {
  const s = status.toLowerCase();
  if (/(no_|no-|fail|rechaz|invalid|revoc)/.test(s)) return "bad";
  if (/(indeterm|duda|unknown|pend|revi)/.test(s)) return "warn";
  return "ok";
}

const CASE_STATUS_LABEL: Record<string, string> = {
  uploaded: "En cola", processing: "Procesando", review: "En revisión",
  validated: "Validado", generated: "Generado", failed: "Error",
  approved: "Aprobado", rejected: "Rechazado",
};

export default async function ContractDashboardPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  const orgId = session.orgId;

  const [statusRows, signerRows, docTypeRows, obligations, recent] = await Promise.all([
    db.select({ status: contractCases.status, n: count() }).from(contractCases).where(eq(contractCases.organizationId, orgId)).groupBy(contractCases.status),
    db.select({ status: contractValidations.status, n: count() }).from(contractValidations)
      .innerJoin(contractCases, eq(contractValidations.caseId, contractCases.id))
      .where(eq(contractCases.organizationId, orgId)).groupBy(contractValidations.status),
    db.select({ type: contractDocuments.detectedType, n: count() }).from(contractDocuments)
      .innerJoin(contractCases, eq(contractDocuments.caseId, contractCases.id))
      .where(eq(contractCases.organizationId, orgId)).groupBy(contractDocuments.detectedType),
    db.select({ description: contractObligations.description, dueDate: contractObligations.dueDate }).from(contractObligations)
      .innerJoin(contractCases, eq(contractObligations.caseId, contractCases.id))
      .where(and(eq(contractCases.organizationId, orgId), eq(contractObligations.status, "open"), isNotNull(contractObligations.dueDate)))
      .orderBy(contractObligations.dueDate).limit(6),
    db.query.contractCases.findMany({ where: eq(contractCases.organizationId, orgId), columns: { id: true, title: true, status: true, createdAt: true }, orderBy: [desc(contractCases.createdAt)], limit: 6 }),
  ]);

  const statusCount: Record<string, number> = {};
  for (const r of statusRows) statusCount[r.status] = r.n;
  const totalCases = Object.values(statusCount).reduce((a, b) => a + b, 0);
  const done = (statusCount.validated ?? 0) + (statusCount.generated ?? 0) + (statusCount.approved ?? 0);
  const inProgress = (statusCount.uploaded ?? 0) + (statusCount.processing ?? 0) + (statusCount.review ?? 0);
  const failed = (statusCount.failed ?? 0) + (statusCount.rejected ?? 0);

  const signers = { ok: 0, warn: 0, bad: 0 };
  const signerByStatus: Array<{ status: string; n: number; tone: "ok" | "warn" | "bad" }> = [];
  for (const r of signerRows) { const t = signerTone(r.status); signers[t] += r.n; signerByStatus.push({ status: r.status, n: r.n, tone: t }); }
  const totalSigners = signers.ok + signers.warn + signers.bad;
  const flagged = signers.warn + signers.bad;

  const docTypes = docTypeRows.map((r) => ({ type: r.type ?? "sin clasificar", n: r.n })).sort((a, b) => b.n - a.n);
  const maxDoc = Math.max(1, ...docTypes.map((d) => d.n));

  // Per-request "now" in an async Server Component (intentionally dynamic).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const SOON = 30 * 86400_000;

  const statusSegments = [
    { label: "Validados", n: done, cls: "bg-success" },
    { label: "En proceso", n: inProgress, cls: "bg-warning" },
    { label: "Con error", n: failed, cls: "bg-destructive" },
  ].filter((s) => s.n > 0);

  const toneCls = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive" } as const;

  const kpis = [
    { label: "Casos totales", value: totalCases, Icon: ScrollText, chip: "bg-primary/10 text-primary" },
    { label: "Validados", value: done, Icon: CheckCircle2, chip: "bg-success/10 text-success" },
    { label: "En proceso", value: inProgress, Icon: Loader, chip: "bg-warning/10 text-warning" },
    { label: "Firmantes con hallazgo", value: flagged, Icon: ShieldAlert, chip: "bg-destructive/10 text-destructive" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground">Panel de contratos</h1>
            <p className="text-xs text-muted-foreground mt-1">Resumen de casos, validaciones y obligaciones.</p>
          </div>
          <Link href="/contracts" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-medium shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] hover:bg-primary/90 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Nuevo caso
          </Link>
        </div>

        {totalCases === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto"><ScrollText className="w-5 h-5" /></div>
            <p className="text-sm font-medium text-foreground mt-3">Aún no hay casos</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Sube los documentos de un caso y la IA los clasificará, extraerá y validará según tu flujo. Las métricas aparecerán aquí.</p>
            <Link href="/contracts" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium mt-4"><Upload className="w-3.5 h-3.5" /> Subir documentos</Link>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpis.map((k) => (
                <div key={k.label} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className={`w-7 h-7 rounded-md flex items-center justify-center ${k.chip}`}><k.Icon className="w-4 h-4" /></span>
                  </div>
                  <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground tabular-nums mt-3">{k.value}</p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {/* Estado de casos */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-foreground">Estado de los casos</h2>
                <div className="flex h-2.5 rounded-full overflow-hidden mt-4 bg-secondary">
                  {statusSegments.map((s) => (
                    <div key={s.label} className={s.cls} style={{ width: `${(s.n / totalCases) * 100}%` }} title={`${s.label}: ${s.n}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                  {statusSegments.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`w-2 h-2 rounded-full ${s.cls}`} /> {s.label} <span className="text-foreground font-medium tabular-nums">{s.n}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Validación de firmantes */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-foreground">Validación de firmantes</h2>
                {totalSigners === 0 ? (
                  <p className="text-xs text-muted-foreground mt-4">Sin validaciones todavía.</p>
                ) : (
                  <div className="space-y-2.5 mt-4">
                    {signerByStatus.sort((a, b) => b.n - a.n).map((s) => (
                      <div key={s.status}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-muted-foreground">{s.status}</span>
                          <span className="text-foreground font-medium tabular-nums">{s.n}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className={`h-full rounded-full ${toneCls[s.tone]}`} style={{ width: `${(s.n / totalSigners) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Documentos por tipo */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-foreground">Documentos por tipo</h2>
                {docTypes.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-4">Sin documentos.</p>
                ) : (
                  <div className="space-y-2.5 mt-4">
                    {docTypes.slice(0, 6).map((d) => (
                      <div key={d.type} className="flex items-center gap-3">
                        <span className="text-[11px] text-foreground w-40 truncate">{d.type}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${(d.n / maxDoc) * 100}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums w-6 text-right">{d.n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Obligaciones próximas */}
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-muted-foreground" /><h2 className="text-sm font-semibold text-foreground">Obligaciones próximas</h2></div>
                {obligations.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-4">Sin fechas próximas registradas.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-border">
                    {obligations.map((o, i) => {
                      const due = o.dueDate ? new Date(o.dueDate).getTime() : 0;
                      const soon = due && due - now < SOON;
                      return (
                        <li key={i} className="flex items-center gap-2 py-2 first:pt-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${soon ? "bg-warning" : "bg-muted-foreground/40"}`} />
                          <span className="text-[11px] text-foreground flex-1 truncate">{o.description ?? "Obligación"}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">{o.dueDate ? new Date(o.dueDate).toLocaleDateString("es-MX") : "—"}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Casos recientes */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Casos recientes</h2></div>
              <div className="divide-y divide-border">
                {recent.map((c) => (
                  <Link key={c.id} href={`/contracts/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/50 transition-colors">
                    <ScrollText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{c.title || `Caso ${c.id.slice(0, 8)}`}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{new Date(c.createdAt).toLocaleString("es-MX")}</p>
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">{CASE_STATUS_LABEL[c.status] ?? c.status}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
