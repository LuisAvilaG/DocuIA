import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { getAllFeatures } from "@/lib/features";
import { FEATURE_CATALOG } from "@/lib/features/catalog";
import { tenantCanToggle, tenantEditableKeys, TENANT_OFF_KEY } from "@/lib/features/tenant-editable";
import { qaModeActive } from "@/lib/features/qa-mode";
import { INVOICE_FORMAT_LABEL, isInvoiceFormat } from "@/lib/subsidiaries/invoice-format";
import { db } from "@/lib/db";
import { organizations, subsidiaries } from "@/db/schema";
import { listVendorRules } from "@/lib/workflow/vendor-rules-store";
import { PageFrame, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";
import { SettingRows, ThresholdRow, type SettingRow } from "./rows";
import { TENANT_COPY } from "./copy";

const TOPICS = [
  { key: "lectura",  label: "Lectura",                 title: "Lectura del documento",        sub: "Cómo lee DocuIA la factura y cuándo la envía sola al ERP.", features: ["ai_validation_thresholds", "ai_tiered_fallback", "ai_force_secondary", "ai_model_selection"] },
  { key: "oc",       label: "Orden de compra",         title: "Orden de compra y recepción",  sub: "Cómo se cruza la factura con la OC y con lo que llegó al almacén.", features: ["po_processing", "po_matching", "three_way_match", "vendor_rules"] },
  { key: "fiscal",   label: "Fiscal (CFDI)",           title: "Validación fiscal",            sub: "Consulta del CFDI ante el SAT antes de enviarlo.", features: ["sat_cfdi_validation"] },
  { key: "erp",      label: "Envío al ERP",            title: "Envío al ERP",                 sub: "Qué pasa al crear la factura en el ERP.", features: ["approval_workflow", "duplicate_detection", "erp_attachments", "netsuite_dry_run", "sandbox_test_send", "qa_mode", "custom_netsuite_forms", "auto_sync", "sync_advanced"] },
  { key: "carga",    label: "Carga y catálogos",       title: "Carga y catálogos",            sub: "Cómo llegan los documentos y cómo se aprenden los ítems.", features: ["manual_upload", "bulk_upload", "auto_mapping", "exception_queue", "document_storage"] },
  { key: "reportes", label: "Reportes e integraciones", title: "Reportes e integraciones",    sub: "Resúmenes por correo, métricas y conexiones con otros sistemas.", features: ["scheduled_reports", "advanced_analytics", "ap_advanced_stats", "data_export", "webhook_system", "api_keys"] },
  { key: "subs",     label: "Subsidiarias",            title: "Subsidiarias",                 sub: "Las empresas del ERP que DocuIA atiende y cómo llegan sus facturas.", features: [] },
] as const;
type TopicKey = (typeof TOPICS)[number]["key"];

type CatalogParam = { key: string; label: string; type: string; min?: number; max?: number; options?: readonly string[]; optionLabels?: Record<string, string>; description?: string };

function fmtValue(p: CatalogParam, v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (p.type === "boolean") return v ? "sí" : "no";
  if (p.type === "select") return p.optionLabels?.[String(v)] ?? String(v);
  return String(v);
}

export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<{ tema?: string }> }) {
  const session = await getTenantSession({ area: "settings" });
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");
  await requireApAutomation(session.orgId);

  const { tema } = await searchParams;
  const topic = TOPICS.find((t) => t.key === tema) ?? TOPICS[0];

  const [resolved, org, subs, rules] = await Promise.all([
    getAllFeatures(session.orgId),
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId), columns: { autoProcessThreshold: true, activeNsEnvironment: true } }),
    db.query.subsidiaries.findMany({ where: eq(subsidiaries.organizationId, session.orgId), columns: { id: true, name: true, nsSubsidiaryId: true, currency: true, invoiceFormat: true, isActive: true }, orderBy: [subsidiaries.name] }),
    listVendorRules(session.orgId).catch(() => []),
  ]);
  const byId = new Map(resolved.map((f) => [f.id, f]));
  const catalog = new Map(FEATURE_CATALOG.map((f) => [f.id as string, f]));

  const row = (id: string): SettingRow | null => {
    const def = catalog.get(id);
    const f = byId.get(id);
    if (!def || !f) return null;
    const schema = ((def.configSchema ?? []) as readonly CatalogParam[]);
    const editable = new Set(tenantEditableKeys(id));
    const summary = schema
      .filter((p) => editable.has(p.key))
      .map((p) => { const v = fmtValue(p, f.config[p.key]); return v ? `${p.label.toLowerCase()}: ${v}` : null; })
      .filter(Boolean).slice(0, 4).join(" · ");
    let extra: string | null = null;
    if (id === "vendor_rules") extra = `${rules.length} regla${rules.length === 1 ? "" : "s"}`;
    if (id === "qa_mode" && qaModeActive(f.isEnabled, f.config, org?.activeNsEnvironment)) extra = `Activo hasta ${String(f.config.expires_on)}`;
    if (id === "sandbox_test_send" || id === "qa_mode") extra = [extra, org?.activeNsEnvironment === "sandbox" ? "ERP en sandbox" : "Solo con el ERP en sandbox"].filter(Boolean).join(" · ");
    return {
      id,
      name: TENANT_COPY[id]?.name ?? def.name,
      description: TENANT_COPY[id]?.description ?? def.description,
      granted: f.adminGranted,
      enabled: f.isEnabled,
      control: id === "netsuite_dry_run" ? "dry_run" : tenantCanToggle(id) ? "toggle" : "none",
      tenantOff: f.config[TENANT_OFF_KEY] === true,
      fields: schema.filter((p) => editable.has(p.key)).map((p) => ({ key: p.key, label: p.label, type: p.type as SettingRow["fields"][number]["type"], min: p.min, max: p.max, options: p.options ? [...p.options] : undefined, optionLabels: p.optionLabels, hint: p.description })),
      values: Object.fromEntries(schema.filter((p) => editable.has(p.key)).map((p) => [p.key, f.config[p.key] ?? null])),
      summary: f.adminGranted ? [summary, extra].filter(Boolean).join(" · ") || null : null,
      technical: schema.length > editable.size,
      link: id === "vendor_rules" ? { href: "/vendor-rules", label: "Ver reglas" } : null,
    };
  };

  const counts = Object.fromEntries(TOPICS.map((t) => [t.key, t.key === "subs" ? subs.length : t.features.filter((id) => byId.get(id)?.isEnabled).length]));
  const rows = topic.features.map(row).filter((r): r is SettingRow => r !== null);

  return (
    <PageFrame>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Configuración</p>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Ajustes de Facturas</h1>
      <p className="mt-1.5 max-w-[760px] text-sm text-muted-foreground">Todo lo que DocuIA hace con tus facturas, por tema. Lo marcado como «Lo ajusta DocuIA» lo cambia nuestro equipo; pídelo a soporte si lo necesitas.</p>

      <div className="mt-5.5 grid items-start gap-9 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Temas" className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 text-[13.5px]">
          {TOPICS.map((t) => (
            <Link key={t.key} href={`?tema=${t.key}`} scroll={false} aria-current={t.key === topic.key ? "page" : undefined}
              className={cn("flex justify-between gap-2 rounded-[7px] px-2.5 py-[7px]", t.key === topic.key ? "bg-tone-info-bg font-semibold text-tone-info" : "text-foreground/75 hover:bg-secondary/60 hover:text-foreground")}>
              {t.label}<em className="text-xs not-italic text-muted-foreground tabular-nums">{counts[t.key as TopicKey]}</em>
            </Link>
          ))}
        </nav>

        <section aria-labelledby="topic-title">
          <h2 id="topic-title" className="text-[17px] font-semibold tracking-[-0.01em]">{topic.title}</h2>
          <p className="mb-3 mt-1 text-[13px] text-muted-foreground">{topic.sub}</p>
          {topic.key === "subs" ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {subs.length === 0 && <p className="px-4.5 py-4 text-sm text-muted-foreground">Sin subsidiarias. DocuIA las configura al conectar tu ERP.</p>}
              {subs.map((s) => (
                <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft px-4.5 py-3.5 last:border-0">
                  <span className="min-w-0">
                    <b className="block text-sm font-semibold">{s.name}{!s.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">inactiva</span>}</b>
                    <span className="text-[12.5px] text-muted-foreground">ID en el ERP {s.nsSubsidiaryId} · {s.currency} · facturas {isInvoiceFormat(s.invoiceFormat) ? INVOICE_FORMAT_LABEL[s.invoiceFormat] : s.invoiceFormat}</span>
                  </span>
                  <StatusPill tone="mute">Lo ajusta DocuIA</StatusPill>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {topic.key === "lectura" && <ThresholdRow initialPct={Math.round((org?.autoProcessThreshold ?? 0.85) * 100)} />}
              <SettingRows rows={rows} />
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
