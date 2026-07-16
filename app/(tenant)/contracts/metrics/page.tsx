import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations, contractFlows } from "@/db/schema";
import { eq, desc, count } from "drizzle-orm";
import { CheckCircle2, ShieldCheck, Timer, Files } from "lucide-react";
import { ThroughputArea, SignerDonut, FlowBars } from "./charts";

function signerTone(status: string): "ok" | "warn" | "bad" {
  const s = status.toLowerCase();
  if (/(no_|no-|fail|rechaz|invalid|revoc)/.test(s)) return "bad";
  if (/(indeterm|duda|unknown|pend|revi)/.test(s)) return "warn";
  return "ok";
}
const pad = (n: number) => String(n).padStart(2, "0");
const DONE = new Set(["validated", "generated", "approved"]);

export default async function ContractMetricsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  const orgId = session.orgId;

  const [cases, docCountRows, signerRows, flows] = await Promise.all([
    db.query.contractCases.findMany({ where: eq(contractCases.organizationId, orgId), columns: { createdAt: true, updatedAt: true, status: true, flowId: true }, orderBy: [desc(contractCases.createdAt)], limit: 1000 }),
    db.select({ n: count() }).from(contractDocuments).innerJoin(contractCases, eq(contractDocuments.caseId, contractCases.id)).where(eq(contractCases.organizationId, orgId)),
    db.select({ status: contractValidations.status, n: count() }).from(contractValidations).innerJoin(contractCases, eq(contractValidations.caseId, contractCases.id)).where(eq(contractCases.organizationId, orgId)).groupBy(contractValidations.status),
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, orgId), columns: { id: true, name: true } }),
  ]);

  const total = cases.length;
  const done = cases.filter((c) => DONE.has(c.status)).length;
  const successRate = total ? Math.round((done / total) * 100) : 0;

  const durations = cases
    .filter((c) => DONE.has(c.status) && c.updatedAt && c.createdAt && c.updatedAt > c.createdAt)
    .map((c) => new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime());
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const avgTime = avgMs === 0 ? "—" : avgMs < 60_000 ? `${Math.round(avgMs / 1000)}s` : `${(avgMs / 60_000).toFixed(1)} min`;

  const docCount = docCountRows[0]?.n ?? 0;
  const docsPerCase = total ? (docCount / total).toFixed(1) : "0";

  const signerData = signerRows.map((r) => ({ name: r.status, value: r.n, tone: signerTone(r.status) }));
  const totalSigners = signerData.reduce((a, b) => a + b.value, 0);
  const vigentes = signerData.filter((d) => d.tone === "ok").reduce((a, b) => a + b.value, 0);
  const vigencyRate = totalSigners ? Math.round((vigentes / totalSigners) * 100) : 0;

  // 30-day throughput buckets.
  const today = new Date();
  const days: Array<{ key: string; label: string; n: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    days.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, n: 0 });
  }
  const dayIdx = new Map(days.map((x, i) => [x.key, i]));
  for (const c of cases) {
    const d = new Date(c.createdAt);
    const i = dayIdx.get(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    if (i != null) days[i].n++;
  }

  // Cases per flow.
  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const perFlowMap = new Map<string, number>();
  for (const c of cases) {
    const key = c.flowId ? (flowName.get(c.flowId) ?? "Flujo eliminado") : "Sin flujo asignado";
    perFlowMap.set(key, (perFlowMap.get(key) ?? 0) + 1);
  }
  const perFlow = [...perFlowMap.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8);

  const kpis = [
    { label: "Tasa de validación", value: `${successRate}%`, sub: `${done} de ${total} casos`, Icon: CheckCircle2, chip: "bg-success/10 text-success" },
    { label: "Firmantes vigentes", value: `${vigencyRate}%`, sub: `${vigentes} de ${totalSigners}`, Icon: ShieldCheck, chip: "bg-primary/10 text-primary" },
    { label: "Tiempo prom. de proceso", value: avgTime, sub: `${durations.length} casos medidos`, Icon: Timer, chip: "bg-warning/10 text-warning" },
    { label: "Documentos por caso", value: docsPerCase, sub: `${docCount} documentos`, Icon: Files, chip: "bg-primary/10 text-primary" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground">Métricas de contratos</h1>
          <p className="text-xs text-muted-foreground mt-1">Rendimiento, tasas y tendencias del procesamiento.</p>
        </div>

        {total === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <p className="text-sm font-medium text-foreground">Aún no hay datos</p>
            <p className="text-xs text-muted-foreground mt-1">Las métricas aparecerán cuando proceses tus primeros casos.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpis.map((k) => (
                <div key={k.label} className="bg-card border border-border rounded-xl p-4">
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center ${k.chip}`}><k.Icon className="w-4 h-4" /></span>
                  <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground tabular-nums mt-3">{k.value}</p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground mt-0.5">{k.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{k.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">Casos procesados por día <span className="text-muted-foreground font-normal">· últimos 30 días</span></h2>
              <ThroughputArea data={days} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-foreground mb-4">Resultado de validación de firmantes</h2>
                <SignerDonut data={signerData} />
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-foreground mb-3">Casos por flujo</h2>
                <FlowBars data={perFlow} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
