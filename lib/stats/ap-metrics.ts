// Métricas nuevas de Facturas (fase 6): tiempos por etapa, antigüedad de
// pendientes, precisión de lectura, segundo modelo, auto-mapeo, duplicados,
// diferencias con la OC, rechazos del ERP, respuesta de aprobadores y monto
// por subsidiaria. Salen de status_events, workflow_runtime_logs,
// exception_queue, item_mappings y history_documents.metrics_json.

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { periodRange, type StatsFilters } from "./ap-stats";
import { CORRECTION_LABEL } from "@/lib/workflow/review-corrections";

export const STAGES = [
  { key: "read", label: "Lectura", statuses: ["uploaded", "extracting"] },
  { key: "review", label: "Revisión", statuses: ["review"] },
  { key: "approval", label: "Aprobación", statuses: ["pending_approval"] },
  { key: "receipt", label: "Recepción", statuses: ["awaiting_receipt"] },
  { key: "erp", label: "ERP", statuses: ["approved", "processing"] },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];

export const PENDING_STATUSES = ["uploaded", "extracting", "review", "pending_approval", "awaiting_receipt"] as const;
export const AGE_BUCKETS = ["0–1 días", "1–3 días", "3–7 días", "+7 días"] as const;

export interface ApMetrics {
  since: string | null;
  stageTimes: { key: StageKey; label: string; median: number | null; p90: number | null; count: number }[];
  stageWeeks: { week: string; values: Partial<Record<StageKey, number>> }[];
  aging: { bucket: string; values: Record<string, number> }[];
  corrections: { reviewed: number; corrected: number; fields: { label: string; value: number }[] };
  fallback: { extractions: number; fallback: number; reasons: { label: string; value: number }[]; months: { label: string; value: number }[] };
  mapping: { weeks: { label: string; value: number }[]; newMappings: { label: string; value: number }[]; lines: number; fromMemory: number };
  duplicates: { count: number; byCurrency: { currency: string; amount: number }[]; list: { id: number; of: number; vendor: string | null; number: string | null; amount: number | null; currency: string | null; at: string }[] };
  poDiffs: { vendor: string; invoices: number; tolerance: number; approval: number; difference: number }[];
  erpRejections: { label: string; value: number }[];
  approvers: { name: string; count: number; median: number | null }[];
  bySubsidiary: { name: string; currency: string; amount: number; count: number }[];
}

type Row = Record<string, unknown>;
async function rows<T extends Row>(q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return ((res as unknown as { rows?: T[] }).rows ?? []) as T[];
}

/** Facturas del filtro (alias h). */
function docScope(f: StatsFilters, from: Date, to: Date): SQL {
  return sql`h.organization_id = ${f.organizationId} and h.document_type <> 'purchase_order'
    and h.created_at >= ${from} and h.created_at < ${to}
    ${f.subsidiaryId ? sql`and h.subsidiary_id = ${f.subsidiaryId}` : sql``}
    ${f.vendor ? sql`and h.vendor = ${f.vendor}` : sql``}
    ${f.includeQa ? sql`` : sql`and h.is_qa = false`}`;
}

const stageCase = sql.raw(`case ${STAGES.map((s) => `when ev.to_status in (${s.statuses.map((x) => `'${x}'`).join(",")}) then '${s.key}'`).join(" ")} end`);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
// date_trunc devuelve medianoche UTC: se etiqueta en UTC para no caer en el día anterior.
const weekLabel = (d: unknown) => new Date(String(d)).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

/** Agrupa los motivos del segundo modelo (texto de lib/workflow/extract.ts). */
export function fallbackBucket(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("sin líneas")) return "No leyó líneas";
  if (r.includes("no cuadran")) return "Las líneas no cuadran con el total";
  if (r.includes("sin número") || r.includes("sin proveedor")) return "Faltan datos de cabecera";
  if (r.includes("duda")) return "El modelo dudó";
  if (r.includes("forzado")) return "Siempre (configuración)";
  return "Otro motivo";
}

/** Agrupa los errores al crear en el ERP. */
export function erpRejectionBucket(reason: string | null, code: string | null): string {
  const r = `${code ?? ""} ${reason ?? ""}`.toLowerCase();
  if (/per[ií]odo|period/.test(r)) return "Periodo contable cerrado";
  if (/inactiv/.test(r)) return "Registro inactivo en el ERP";
  if (/proveedor|vendor/.test(r)) return "Proveedor rechazado";
  if (/[ií]tem|item/.test(r)) return "Ítem rechazado";
  if (/subsidiari|location|ubicaci/.test(r)) return "Subsidiaria o ubicación";
  if (/duplic|ya existe/.test(r)) return "Ya existe en el ERP";
  if (/timeout|tiempo de espera|econnreset|socket|5\d\d/.test(r)) return "El ERP no respondió";
  if (/permis|401|403|token|auth/.test(r)) return "Permisos o credenciales";
  return "Otro error";
}

export async function loadApMetrics(f: StatsFilters): Promise<ApMetrics> {
  const range = periodRange(f.period);
  const from = range.from, to = range.to;
  const trendFrom = new Date(Date.now() - 12 * 7 * 86_400_000);
  const scope = docScope(f, from, to);

  const [first] = await rows<{ since: string | null }>(sql`select min(changed_at) as since from status_events where organization_id = ${f.organizationId} and entity = 'document'`);

  // Tiempo en cada estado: del evento al siguiente evento del mismo documento.
  const durations = sql`
    with ev as (
      select e.entity_id, e.to_status, e.changed_at,
        lead(e.changed_at) over (partition by e.entity_id order by e.changed_at, e.id) as next_at
      from status_events e
      where e.organization_id = ${f.organizationId} and e.entity = 'document' and e.changed_at >= ${trendFrom}
    )
    select ${stageCase} as stage, ev.changed_at, extract(epoch from (ev.next_at - ev.changed_at)) / 3600.0 as hours
    from ev join history_documents h on h.id::text = ev.entity_id
    where ev.next_at is not null and ${docScope(f, new Date(0), to)}`;

  const [stageRows, weekRows] = await Promise.all([
    rows<{ stage: StageKey | null; median: number; p90: number; count: number }>(sql`
      select stage, percentile_cont(0.5) within group (order by hours) as median,
        percentile_cont(0.9) within group (order by hours) as p90, count(*)::int as count
      from (${durations}) d where stage is not null and changed_at >= ${from} group by stage`),
    rows<{ stage: StageKey | null; week: string; median: number }>(sql`
      select stage, date_trunc('week', changed_at) as week, percentile_cont(0.5) within group (order by hours) as median
      from (${durations}) d where stage is not null group by stage, week order by week`),
  ]);

  const stageTimes = STAGES.map((s) => {
    const r = stageRows.find((x) => x.stage === s.key);
    return { key: s.key, label: s.label, median: n(r?.median), p90: n(r?.p90), count: Number(r?.count ?? 0) };
  });
  const weeks = new Map<string, Partial<Record<StageKey, number>>>();
  for (const r of weekRows) {
    if (!r.stage) continue;
    const k = new Date(String(r.week)).toISOString().slice(0, 10);
    (weeks.get(k) ?? weeks.set(k, {}).get(k)!)[r.stage] = Number(r.median);
  }

  // Antigüedad de lo pendiente: desde que entró a su estado actual.
  const agingRows = await rows<{ status: string; bucket: number; count: number }>(sql`
    select h.status::text as status,
      case when age < 24 then 0 when age < 72 then 1 when age < 168 then 2 else 3 end as bucket, count(*)::int as count
    from (
      select h.*, extract(epoch from (now() - coalesce(
        (select max(e.changed_at) from status_events e where e.entity = 'document' and e.entity_id = h.id::text and e.to_status = h.status::text),
        h.updated_at))) / 3600.0 as age
      from history_documents h
      where h.organization_id = ${f.organizationId} and h.document_type <> 'purchase_order'
        and h.status::text in (${sql.join(PENDING_STATUSES.map((s) => sql`${s}`), sql`, `)})
        ${f.subsidiaryId ? sql`and h.subsidiary_id = ${f.subsidiaryId}` : sql``}
        ${f.vendor ? sql`and h.vendor = ${f.vendor}` : sql``}
        ${f.includeQa ? sql`` : sql`and h.is_qa = false`}
    ) h group by 1, 2`);
  const aging = AGE_BUCKETS.map((bucket, i) => ({
    bucket,
    values: Object.fromEntries(agingRows.filter((r) => Number(r.bucket) === i).map((r) => [r.status, Number(r.count)])),
  }));

  const [corrRows, corrTotals, fallbackRows, fallbackMonths, mappingWeeks, newMappings, dupRows, poRows, erpRows, approverRows, subRows] = await Promise.all([
    rows<{ field: string; value: number }>(sql`
      select k as field, sum(v::int)::int as value
      from history_documents h, jsonb_each_text(h.metrics_json->'corrections'->'fields') as x(k, v)
      where ${scope} group by k order by value desc`),
    rows<{ reviewed: number; corrected: number }>(sql`
      select count(*) filter (where h.metrics_json ? 'corrections')::int as reviewed,
        count(*) filter (where h.metrics_json->'corrections'->'fields' <> '{}'::jsonb)::int as corrected
      from history_documents h where ${scope}`),
    rows<{ reason: string | null; count: number; total: number }>(sql`
      select l.meta_json->>'fallbackReason' as reason, count(*)::int as count, sum(count(*)) over ()::int as total
      from workflow_runtime_logs l
      where l.organization_id = ${f.organizationId} and l.step = 'extract' and l.status = 'SUCCESS' and l.created_at >= ${from} and l.created_at < ${to}
      group by 1`),
    rows<{ month: string; pct: number }>(sql`
      select date_trunc('month', l.created_at) as month, round(100.0 * count(*) filter (where l.fallback_used) / count(*))::int as pct
      from workflow_runtime_logs l
      where l.organization_id = ${f.organizationId} and l.step = 'extract' and l.status = 'SUCCESS' and l.created_at >= now() - interval '6 months'
      group by 1 order by 1`),
    rows<{ week: string; lines: number; memory: number }>(sql`
      select date_trunc('week', h.created_at) as week, sum((h.metrics_json->'mapping'->>'lines')::int)::int as lines,
        sum((h.metrics_json->'mapping'->>'fromMemory')::int)::int as memory
      from history_documents h where ${docScope(f, trendFrom, to)} and h.metrics_json ? 'mapping' group by 1 order by 1`),
    rows<{ week: string; count: number }>(sql`
      select date_trunc('week', m.created_at) as week, count(*)::int as count
      from item_mappings m join subsidiaries s on s.id = m.subsidiary_id
      where s.organization_id = ${f.organizationId} and m.created_at >= ${trendFrom}
        ${f.subsidiaryId ? sql`and m.subsidiary_id = ${f.subsidiaryId}` : sql``}
      group by 1 order by 1`),
    rows<{ id: number; of: number; amount: string | null; currency: string | null; at: string; vendor: string | null; number: string | null }>(sql`
      select h.id, (h.metrics_json->'duplicate'->>'of')::bigint as of, h.metrics_json->'duplicate'->>'amount' as amount,
        h.metrics_json->'duplicate'->>'currency' as currency, h.created_at as at, o.vendor, o.num_doc as number
      from history_documents h left join history_documents o on o.id = (h.metrics_json->'duplicate'->>'of')::bigint
      where h.organization_id = ${f.organizationId} and h.created_at >= ${from} and h.created_at < ${to} and h.metrics_json ? 'duplicate'
        ${f.subsidiaryId ? sql`and h.subsidiary_id = ${f.subsidiaryId}` : sql``}
      order by h.created_at desc`),
    rows<{ vendor: string | null; invoices: number; tolerance: number; approval: number; difference: number }>(sql`
      select coalesce(h.vendor, 'Sin proveedor') as vendor, count(*)::int as invoices,
        count(*) filter (where h.metrics_json->'po'->>'accepted' = 'tolerance')::int as tolerance,
        count(*) filter (where h.metrics_json->'po'->>'accepted' = 'approval')::int as approval,
        coalesce(sum(abs((h.metrics_json->'po'->>'difference')::numeric)) filter (where h.metrics_json->'po'->>'accepted' <> 'match'), 0)::float as difference
      from history_documents h where ${scope} and h.metrics_json ? 'po'
      group by 1 having count(*) filter (where h.metrics_json->'po'->>'accepted' <> 'match') > 0
      order by difference desc limit 12`),
    rows<{ reason: string | null; code: string | null }>(sql`
      select x.failure_reason as reason, x.error_code as code from exception_queue x
      where x.organization_id = ${f.organizationId} and x.failure_stage = 'process' and x.created_at >= ${from} and x.created_at < ${to}
        ${f.subsidiaryId ? sql`and x.subsidiary_id = ${f.subsidiaryId}` : sql``}`),
    rows<{ name: string | null; count: number; median: number | null }>(sql`
      with ev as (
        select e.entity_id, e.to_status, e.changed_at,
          lead(e.changed_at) over (partition by e.entity_id order by e.changed_at, e.id) as next_at
        from status_events e where e.organization_id = ${f.organizationId} and e.entity = 'document' and e.changed_at >= ${from}
      )
      select coalesce(u.full_name, u.email) as name, count(*)::int as count,
        percentile_cont(0.5) within group (order by extract(epoch from (ev.next_at - ev.changed_at)) / 3600.0) as median
      from ev join history_documents h on h.id::text = ev.entity_id
      join org_users u on u.id = h.approved_by
      where ev.to_status = 'pending_approval' and ev.next_at is not null and ${docScope(f, new Date(0), to)}
      group by 1 order by count desc limit 15`),
    rows<{ name: string; currency: string; amount: number; count: number }>(sql`
      select s.name, s.currency, coalesce(sum(h.total), 0)::float as amount, count(*)::int as count
      from history_documents h join subsidiaries s on s.id = h.subsidiary_id
      where ${scope} and h.status = 'completed' group by s.name, s.currency order by amount desc`),
  ]);

  const extractions = Number(fallbackRows[0]?.total ?? 0);
  const fbBuckets = new Map<string, number>();
  for (const r of fallbackRows) if (r.reason) fbBuckets.set(fallbackBucket(r.reason), (fbBuckets.get(fallbackBucket(r.reason)) ?? 0) + Number(r.count));
  const erpBuckets = new Map<string, number>();
  for (const r of erpRows) { const b = erpRejectionBucket(r.reason, r.code); erpBuckets.set(b, (erpBuckets.get(b) ?? 0) + 1); }
  const byCurrency = new Map<string, number>();
  for (const d of dupRows) if (d.amount !== null) byCurrency.set(d.currency ?? "", (byCurrency.get(d.currency ?? "") ?? 0) + Number(d.amount));
  const desc = (m: Map<string, number>) => [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  return {
    since: first?.since ? new Date(String(first.since)).toISOString() : null,
    stageTimes,
    stageWeeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, values]) => ({ week, values })),
    aging,
    corrections: {
      reviewed: Number(corrTotals[0]?.reviewed ?? 0), corrected: Number(corrTotals[0]?.corrected ?? 0),
      fields: corrRows.map((r) => ({ label: CORRECTION_LABEL[r.field] ?? r.field, value: Number(r.value) })),
    },
    fallback: {
      extractions, fallback: [...fbBuckets.values()].reduce((a, b) => a + b, 0), reasons: desc(fbBuckets),
      months: fallbackMonths.map((r) => ({ label: new Date(String(r.month)).toLocaleDateString("es-MX", { month: "short", timeZone: "UTC" }).replace(".", ""), value: Number(r.pct) })),
    },
    mapping: {
      weeks: mappingWeeks.filter((r) => Number(r.lines) > 0).map((r) => ({ label: weekLabel(r.week), value: Math.round((100 * Number(r.memory)) / Number(r.lines)) })),
      newMappings: newMappings.map((r) => ({ label: weekLabel(r.week), value: Number(r.count) })),
      lines: mappingWeeks.reduce((a, r) => a + Number(r.lines), 0), fromMemory: mappingWeeks.reduce((a, r) => a + Number(r.memory), 0),
    },
    duplicates: {
      count: dupRows.length,
      byCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
      list: dupRows.slice(0, 10).map((d) => ({ id: Number(d.id), of: Number(d.of), vendor: d.vendor, number: d.number, amount: d.amount === null ? null : Number(d.amount), currency: d.currency, at: new Date(String(d.at)).toISOString() })),
    },
    poDiffs: poRows.map((r) => ({ vendor: r.vendor ?? "Sin proveedor", invoices: Number(r.invoices), tolerance: Number(r.tolerance), approval: Number(r.approval), difference: Number(r.difference) })),
    erpRejections: desc(erpBuckets),
    approvers: approverRows.map((r) => ({ name: r.name ?? "—", count: Number(r.count), median: n(r.median) })),
    bySubsidiary: subRows.map((r) => ({ name: r.name, currency: r.currency, amount: Number(r.amount), count: Number(r.count) })),
  };
}
