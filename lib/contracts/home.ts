// Datos de «Hoy» en Contratos: lo que espera una decisión, los últimos 30 días y
// el uso por flujo. Sin vencimientos (se revisan con el control Fecha y vigencia).
import { findingLevel } from "./validate";
import { db } from "@/lib/db";
import { contractCases, contractFlows, contractValidations, statusEvents } from "@/db/schema";
import { and, desc, eq, gte, inArray, sql, or, isNull } from "drizzle-orm";

export type AttentionTone = "err" | "warn" | "ok";

export interface AttentionItem {
  id: string;
  title: string;
  flowName: string;
  tone: AttentionTone;
  label: string;
  detail: string;
  since: string;
  cta: string;
}

export interface FlowUsage { flowId: string | null; name: string; cases: number; done: number; findings: number; medianSec: number | null }

const DECIDE = ["review", "validated"] as const;
const DONE = ["approved", "generated", "rejected"] as const;

/** Resumen de validaciones de cada caso: bloqueos y advertencias que no pasaron, y la primera razón. */
async function findingsByCase(caseIds: string[]) {
  if (caseIds.length === 0) return new Map<string, { blocks: number; warns: number; first: string | null }>();
  const rows = await db.select({ caseId: contractValidations.caseId, ok: contractValidations.ok, severity: contractValidations.severity, subject: contractValidations.subject, reason: contractValidations.reason, ruleName: contractValidations.ruleName })
    .from(contractValidations)
    .where(and(inArray(contractValidations.caseId, caseIds), or(eq(contractValidations.ok, false), isNull(contractValidations.ok))));
  const out = new Map<string, { blocks: number; warns: number; first: string | null }>();
  for (const r of rows) {
    const cur = out.get(r.caseId) ?? { blocks: 0, warns: 0, first: null };
    const level = findingLevel(r);
    if (level === "block") { cur.blocks++; cur.first = r.reason ?? r.ruleName ?? r.subject; }
    else if (level === "warn") { cur.warns++; cur.first ??= r.reason ?? r.ruleName ?? r.subject; }
    out.set(r.caseId, cur);
  }
  return out;
}

export async function getContractsHome(orgId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const org = eq(contractCases.organizationId, orgId);

  const [flows, waiting, failed, analyzing, recent] = await Promise.all([
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, orgId), columns: { id: true, name: true } }),
    db.query.contractCases.findMany({ where: and(org, inArray(contractCases.status, [...DECIDE])), columns: { id: true, title: true, flowId: true, updatedAt: true }, orderBy: [desc(contractCases.updatedAt)], limit: 40 }),
    db.query.contractCases.findMany({ where: and(org, eq(contractCases.status, "failed"), gte(contractCases.updatedAt, since)), columns: { id: true, title: true, flowId: true, updatedAt: true, errorMessage: true }, orderBy: [desc(contractCases.updatedAt)], limit: 5 }),
    db.$count(contractCases, and(org, inArray(contractCases.status, ["uploaded", "processing"]))),
    db.select({ id: contractCases.id, flowId: contractCases.flowId, status: contractCases.status, createdAt: contractCases.createdAt })
      .from(contractCases).where(and(org, gte(contractCases.createdAt, since))),
  ]);
  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const nameOf = (id: string | null) => (id ? flowName.get(id) ?? "Flujo eliminado" : "Sin flujo");

  const findings = await findingsByCase([...waiting.map((c) => c.id), ...recent.map((c) => c.id)]);

  // Tiempo de análisis: del alta del caso a su primer estado «por decidir» o «error».
  const analysis = recent.length
    ? await db.select({ entityId: statusEvents.entityId, at: sql<Date>`min(${statusEvents.changedAt})` })
      .from(statusEvents)
      .where(and(eq(statusEvents.entity, "contract_case"), inArray(statusEvents.entityId, recent.map((c) => c.id)), inArray(statusEvents.toStatus, ["review", "validated", "failed"])))
      .groupBy(statusEvents.entityId)
    : [];
  const created = new Map(recent.map((c) => [c.id, c.createdAt.getTime()]));
  const secsByCase = new Map(analysis.map((a) => [a.entityId, Math.max(0, (new Date(a.at).getTime() - (created.get(a.entityId) ?? 0)) / 1000)]));
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const tone = (id: string): { tone: AttentionTone; label: string; detail: string } => {
    const f = findings.get(id);
    if (f?.blocks) return { tone: "err", label: "Bloqueo", detail: f.first ?? `${f.blocks} bloqueo${f.blocks === 1 ? "" : "s"}` };
    if (f?.warns) return { tone: "warn", label: "Por decidir", detail: `${f.warns} advertencia${f.warns === 1 ? "" : "s"}${f.first ? `: ${f.first}` : ""}` };
    return { tone: "ok", label: "Listo", detail: "Todos los controles correctos. Solo falta tu decisión." };
  };
  const rank: Record<AttentionTone, number> = { err: 0, warn: 1, ok: 2 };
  const attention: AttentionItem[] = [
    ...waiting.map((c) => ({ id: c.id, title: c.title ?? "Caso sin título", flowName: nameOf(c.flowId), ...tone(c.id), since: c.updatedAt.toISOString(), cta: "Decidir" })),
    ...failed.map((c) => ({ id: c.id, title: c.title ?? "Caso sin título", flowName: nameOf(c.flowId), tone: "err" as const, label: "Error", detail: c.errorMessage?.split("\n")[0] ?? "El análisis no terminó.", since: c.updatedAt.toISOString(), cta: "Revisar" })),
  ].sort((a, b) => rank[a.tone] - rank[b.tone] || a.since.localeCompare(b.since)).slice(0, 8);

  const byFlow = new Map<string, FlowUsage>();
  for (const c of recent) {
    const key = c.flowId ?? "none";
    const u = byFlow.get(key) ?? { flowId: c.flowId, name: nameOf(c.flowId), cases: 0, done: 0, findings: 0, medianSec: null };
    u.cases++;
    if ((DONE as readonly string[]).includes(c.status)) u.done++;
    const f = findings.get(c.id);
    if (f && (f.blocks || f.warns)) u.findings++;
    byFlow.set(key, u);
  }
  for (const [key, u] of byFlow) u.medianSec = median(recent.filter((c) => (c.flowId ?? "none") === key).map((c) => secsByCase.get(c.id)).filter((x): x is number => x !== undefined));

  return {
    waiting: waiting.length,
    analyzing,
    attention,
    last30: {
      created: recent.length,
      done: recent.filter((c) => (DONE as readonly string[]).includes(c.status)).length,
      medianSec: median([...secsByCase.values()]),
      findings: recent.filter((c) => { const f = findings.get(c.id); return Boolean(f && (f.blocks || f.warns)); }).length,
    },
    byFlow: [...byFlow.values()].sort((a, b) => b.cases - a.cases),
  };
}

export type ContractsHome = Awaited<ReturnType<typeof getContractsHome>>;

/** «3 min 40 s», «11 min», «45 s». */
export function fmtDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return s && m < 10 ? `${m} min ${String(s).padStart(2, "0")} s` : `${m} min`;
}
