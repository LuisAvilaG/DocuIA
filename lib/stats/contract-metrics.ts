// Métricas nuevas de Contratos (fase 6): tiempo a decisión, resultado de las
// decisiones, reglas que más frenan, correcciones por campo, impacto de cada
// versión de flujo y referencias del Archivo sin confirmar. Últimas 12 semanas.

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";

export interface ContractMetrics {
  since: string | null;
  decisionTime: { median: number | null; p90: number | null; count: number; weeks: { label: string; value: number }[] };
  outcomes: { label: string; clean: number; exception: number; rejected: number }[];
  rules: { name: string; block: number; warn: number; unknown: number }[];
  corrections: { fields: { label: string; value: number }[]; learned: number; total: number; activeLearnings: number };
  versions: { flow: string; version: number; cases: number; cleanPct: number | null; findings: number; decisionHours: number | null }[];
  references: { missing: number; review: number; list: { id: string; code: string; page: number; status: string; document: string }[] };
}

type Row = Record<string, unknown>;
async function rows<T extends Row>(q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return ((res as unknown as { rows?: T[] }).rows ?? []) as T[];
}

// date_trunc devuelve medianoche UTC: se etiqueta en UTC.
const weekLabel = (d: unknown) => new Date(String(d)).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Nombre legible de un campo extraído («valor_total» → «Valor total»). */
export function fieldLabel(key: string): string {
  const s = key.replace(/[_.]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

export async function loadContractMetrics(orgId: string, flowId: string | null = null): Promise<ContractMetrics> {
  const from = new Date(Date.now() - 12 * 7 * 86_400_000);
  const caseScope = sql`c.organization_id = ${orgId} ${flowId ? sql`and c.flow_id = ${flowId}` : sql``}`;

  // Del alta del caso a su primera aprobación o rechazo. (El primer evento no
  // sirve de inicio: los casos anteriores al registro de eventos empiezan tarde.)
  const decisions = sql`
    select c.id, c.flow_id, c.result_json,
      c.created_at as created_at,
      min(e.changed_at) filter (where e.to_status in ('approved', 'rejected')) as decided_at
    from contract_cases c join status_events e on e.entity = 'contract_case' and e.entity_id = c.id
    where ${caseScope} group by c.id`;

  const [first, timeRows, weekRows, outcomeRows, ruleRows, corrRows, learnRows, versionRows, refCounts, refList] = await Promise.all([
    rows<{ since: string | null }>(sql`select min(changed_at) as since from status_events where organization_id = ${orgId} and entity = 'contract_case'`),
    rows<{ median: number | null; p90: number | null; count: number }>(sql`
      select percentile_cont(0.5) within group (order by h) as median, percentile_cont(0.9) within group (order by h) as p90, count(*)::int as count
      from (select extract(epoch from (decided_at - created_at)) / 3600.0 as h from (${decisions}) d where decided_at >= ${from}) x`),
    rows<{ week: string; median: number }>(sql`
      select date_trunc('week', decided_at) as week, percentile_cont(0.5) within group (order by extract(epoch from (decided_at - created_at)) / 3600.0) as median
      from (${decisions}) d where decided_at >= ${from} group by 1 order by 1`),
    rows<{ week: string; clean: number; exception: number; rejected: number }>(sql`
      select date_trunc('week', (c.result_json->'decision'->>'at')::timestamptz) as week,
        count(*) filter (where c.result_json->'decision'->>'action' = 'approve' and coalesce((c.result_json->'decision'->>'override')::boolean, false) = false)::int as clean,
        count(*) filter (where c.result_json->'decision'->>'action' = 'approve' and (c.result_json->'decision'->>'override')::boolean)::int as exception,
        count(*) filter (where c.result_json->'decision'->>'action' = 'reject')::int as rejected
      from contract_cases c
      where ${caseScope} and c.result_json->'decision'->>'at' is not null and (c.result_json->'decision'->>'at')::timestamptz >= ${from}
      group by 1 order by 1`),
    rows<{ name: string; block: number; warn: number; unknown: number }>(sql`
      select coalesce(v.rule_name, 'Validación') as name,
        count(*) filter (where v.ok = false and v.severity = 'block')::int as block,
        count(*) filter (where v.ok = false and v.severity <> 'block')::int as warn,
        count(*) filter (where v.ok is null and v.severity <> 'info')::int as unknown
      from contract_validations v join contract_cases c on c.id = v.case_id
      where ${caseScope} and c.created_at >= ${from}
      group by 1 having count(*) filter (where v.ok is distinct from true and v.severity <> 'info') > 0
      order by block desc, warn desc, unknown desc limit 10`),
    rows<{ field: string; count: number; learned: number }>(sql`
      select a.metadata->>'fieldKey' as field, count(*)::int as count,
        count(*) filter (where a.action = 'contract.extraction_corrected_and_learned')::int as learned
      from tenant_audit_log a
      where a.organization_id = ${orgId} and a.action in ('contract.extraction_corrected', 'contract.extraction_corrected_and_learned')
        and a.created_at >= ${from}
        ${flowId ? sql`and exists (select 1 from contract_cases c where c.id = a.metadata->>'caseId' and c.flow_id = ${flowId})` : sql``}
      group by 1 order by count desc limit 10`),
    rows<{ active: number }>(sql`select count(*) filter (where is_active and retired_at is null)::int as active from contract_extraction_learnings where organization_id = ${orgId}`),
    rows<{ flow: string; version: number; cases: number; clean: number; verdicts: number; findings: number; hours: number | null }>(sql`
      select f.name as flow, (d.result_json->'flow'->'snapshot'->>'version')::int as version, count(*)::int as cases,
        count(*) filter (where d.result_json->>'verdict' = 'ok')::int as clean,
        count(*) filter (where d.result_json->>'verdict' is not null)::int as verdicts,
        coalesce(sum((select count(*) from contract_validations v where v.case_id = d.id and v.ok is distinct from true and v.severity <> 'info')), 0)::int as findings,
        percentile_cont(0.5) within group (order by extract(epoch from (d.decided_at - d.created_at)) / 3600.0) as hours
      from (${decisions}) d join contract_flows f on f.id = d.flow_id
      where d.result_json->'flow'->'snapshot'->>'version' is not null
      group by 1, 2 order by 1, 2 desc`),
    rows<{ missing: number; review: number }>(sql`
      select count(*) filter (where r.status = 'missing')::int as missing,
        count(*) filter (where r.status in ('review', 'ambiguous', 'unrelated'))::int as review
      from contract_archive_references r where r.organization_id = ${orgId}`),
    rows<{ id: string; code: string; page: number; status: string; document: string }>(sql`
      select r.id, r.raw_code as code, r.page_number as page, r.status, coalesce(d.title, d.original_name) as document
      from contract_archive_references r join contract_archive_documents d on d.id = r.source_document_id
      where r.organization_id = ${orgId} and r.status in ('missing', 'review', 'ambiguous', 'unrelated')
      order by r.updated_at desc limit 8`),
  ]);

  const total = corrRows.reduce((a, r) => a + Number(r.count), 0);
  return {
    since: first[0]?.since ? new Date(String(first[0].since)).toISOString() : null,
    decisionTime: {
      median: n(timeRows[0]?.median), p90: n(timeRows[0]?.p90), count: Number(timeRows[0]?.count ?? 0),
      weeks: weekRows.map((r) => ({ label: weekLabel(r.week), value: Math.round(Number(r.median) * 10) / 10 })),
    },
    outcomes: outcomeRows.map((r) => ({ label: weekLabel(r.week), clean: Number(r.clean), exception: Number(r.exception), rejected: Number(r.rejected) })),
    rules: ruleRows.map((r) => ({ name: r.name, block: Number(r.block), warn: Number(r.warn), unknown: Number(r.unknown) })),
    corrections: {
      fields: corrRows.filter((r) => r.field).map((r) => ({ label: fieldLabel(r.field), value: Number(r.count) })),
      learned: corrRows.reduce((a, r) => a + Number(r.learned), 0), total, activeLearnings: Number(learnRows[0]?.active ?? 0),
    },
    versions: versionRows.map((r) => ({
      flow: r.flow, version: Number(r.version), cases: Number(r.cases),
      cleanPct: Number(r.verdicts) ? Math.round((100 * Number(r.clean)) / Number(r.verdicts)) : null,
      findings: Number(r.cases) ? Math.round((10 * Number(r.findings)) / Number(r.cases)) / 10 : 0,
      decisionHours: n(r.hours),
    })),
    references: { missing: Number(refCounts[0]?.missing ?? 0), review: Number(refCounts[0]?.review ?? 0), list: refList.map((r) => ({ ...r, page: Number(r.page) })) },
  };
}
