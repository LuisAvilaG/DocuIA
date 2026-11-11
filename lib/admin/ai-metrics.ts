// Métricas del superadmin (fase 6): costo de IA por cliente y por documento,
// tasa de segundo modelo y errores por cliente, y clientes en modo QA.
// El costo solo lo ve el superadmin (decisión 8 del plan).
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimateCost } from "@/lib/ai/usage";
import { qaModeState } from "@/lib/features/qa-mode-state";

export interface AdminAiMetrics {
  days: number;
  since: string | null;
  totalCost: number;
  unpriced: string[];
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }[];
  clients: {
    id: string; name: string; calls: number; cost: number; documents: number; costPerDoc: number | null;
    sources: Record<string, number>; topModel: string | null;
  }[];
  health: {
    id: string; name: string; extractions: number; fallbackPct: number | null;
    exceptions: number; open: number; erpErrors: number; failedCases: number;
  }[];
  qa: { id: string; name: string; expiresOn: string; appliesTo: string }[];
}

type Row = Record<string, unknown>;
async function rows<T extends Row>(q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return ((res as unknown as { rows?: T[] }).rows ?? []) as T[];
}

/** Suma el costo de filas agrupadas por modelo (con tokens en caché y lote). */
export function costOf(r: { model: string; input: number; output: number; cached: number; batch: boolean; long: boolean }): number | null {
  return estimateCost(r.model, r.input, r.output, r.cached, r.batch, r.long);
}

export async function loadAdminAiMetrics(days = 30): Promise<AdminAiMetrics> {
  const from = new Date(Date.now() - days * 86_400_000);

  const [first, usage, docs, health, qaOrgs] = await Promise.all([
    rows<{ since: string | null }>(sql`select min(created_at) as since from usage_events where event_type in ('ai_primary_call', 'ai_fallback_call')`),
    rows<{ org: string; name: string; model: string; source: string | null; batch: boolean; long: boolean; calls: number; input: number; output: number; cached: number }>(sql`
      select u.organization_id as org, o.name, u.ai_model as model, u.metadata_json->>'source' as source,
        coalesce((u.metadata_json->>'batch')::boolean, false) as batch,
        -- El tramo de precio largo se decide por llamada (Haiku 5.5: más de 100 mil tokens de entrada).
        (u.tokens_input > 100000) as long, count(*)::int as calls,
        sum(u.tokens_input)::bigint as input, sum(u.tokens_output)::bigint as output,
        coalesce(sum((u.metadata_json->>'cached')::bigint), 0)::bigint as cached
      from usage_events u join organizations o on o.id = u.organization_id
      where u.event_type in ('ai_primary_call', 'ai_fallback_call') and u.created_at >= ${from} and u.ai_model is not null
      group by 1, 2, 3, 4, 5, 6`),
    rows<{ org: string; n: number }>(sql`
      select org, sum(n)::int as n from (
        select organization_id as org, count(*) as n from history_documents where created_at >= ${from} group by 1
        union all select organization_id, count(*) from contract_cases where created_at >= ${from} group by 1
        union all select organization_id, count(*) from expense_reports where created_at >= ${from} group by 1
      ) x group by org`),
    rows<{ org: string; name: string; extractions: number; fallback: number; exceptions: number; open: number; erp: number; failed: number }>(sql`
      select o.id as org, o.name,
        (select count(*) from workflow_runtime_logs l where l.organization_id = o.id and l.step = 'extract' and l.status = 'SUCCESS' and l.created_at >= ${from})::int as extractions,
        (select count(*) from workflow_runtime_logs l where l.organization_id = o.id and l.step = 'extract' and l.status = 'SUCCESS' and l.fallback_used and l.created_at >= ${from})::int as fallback,
        (select count(*) from exception_queue x where x.organization_id = o.id and x.created_at >= ${from})::int as exceptions,
        (select count(*) from exception_queue x where x.organization_id = o.id and x.status in ('pending', 'in_progress'))::int as open,
        (select count(*) from exception_queue x where x.organization_id = o.id and x.failure_stage = 'process' and x.created_at >= ${from})::int as erp,
        (select count(*) from contract_cases c where c.organization_id = o.id and c.status = 'failed' and c.updated_at >= ${from})::int as failed
      from organizations o`),
    rows<{ org: string; name: string }>(sql`
      select o.id as org, o.name from org_features f join organizations o on o.id = f.organization_id
      where f.feature_id = 'qa_mode' and f.admin_granted and o.deleted_at is null`),
  ]);

  const unpriced = new Set<string>();
  const byModel = new Map<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>();
  const clients = new Map<string, { name: string; calls: number; cost: number; sources: Record<string, number>; models: Map<string, number> }>();
  for (const r of usage) {
    const cost = costOf({ model: r.model, input: Number(r.input), output: Number(r.output), cached: Number(r.cached), batch: Boolean(r.batch), long: Boolean(r.long) });
    if (cost === null) unpriced.add(r.model);
    const c = cost ?? 0;
    const m = byModel.get(r.model) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    m.calls += Number(r.calls); m.inputTokens += Number(r.input); m.outputTokens += Number(r.output); m.cost += c;
    byModel.set(r.model, m);
    const cl = clients.get(r.org) ?? { name: r.name, calls: 0, cost: 0, sources: {} as Record<string, number>, models: new Map<string, number>() };
    cl.calls += Number(r.calls); cl.cost += c;
    const src = r.source ?? "otro";
    cl.sources[src] = (cl.sources[src] ?? 0) + c;
    cl.models.set(r.model, (cl.models.get(r.model) ?? 0) + Number(r.calls));
    clients.set(r.org, cl);
  }
  const docsBy = new Map(docs.map((d) => [d.org, Number(d.n)]));

  const qa = (await Promise.all(qaOrgs.map(async (o) => {
    const st = await qaModeState(o.org).catch(() => null);
    return st?.active && st.config ? { id: o.org, name: o.name, expiresOn: st.config.expires_on, appliesTo: st.config.applies_to === "invoices_and_po" ? "Facturas y órdenes de compra" : "Facturas" } : null;
  }))).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));

  return {
    days,
    since: first[0]?.since ? new Date(String(first[0].since)).toISOString() : null,
    totalCost: [...clients.values()].reduce((a, c) => a + c.cost, 0),
    unpriced: [...unpriced],
    byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cost - a.cost),
    clients: [...clients.entries()].map(([id, c]) => {
      const documents = docsBy.get(id) ?? 0;
      const topModel = [...c.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { id, name: c.name, calls: c.calls, cost: c.cost, documents, costPerDoc: documents ? c.cost / documents : null, sources: c.sources, topModel };
    }).sort((a, b) => b.cost - a.cost),
    health: health
      .filter((h) => Number(h.extractions) + Number(h.exceptions) + Number(h.open) + Number(h.failed) > 0)
      .map((h) => ({
        id: h.org, name: h.name, extractions: Number(h.extractions),
        fallbackPct: Number(h.extractions) ? Math.round((100 * Number(h.fallback)) / Number(h.extractions)) : null,
        exceptions: Number(h.exceptions), open: Number(h.open), erpErrors: Number(h.erp), failedCases: Number(h.failed),
      }))
      .sort((a, b) => (b.open + b.erpErrors + b.failedCases) - (a.open + a.erpErrors + a.failedCases) || (b.fallbackPct ?? 0) - (a.fallbackPct ?? 0)),
    qa,
  };
}
