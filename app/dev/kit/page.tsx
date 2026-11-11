import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { FeatureProvider } from "@/components/providers/feature-provider";
import { TenantSidebar } from "@/components/tenant/tenant-sidebar";
import {
  PageHeader, SectionTitle, StageNav, Notice, EmptyState, StatusPill, ApStatusPill, CaseStatusPill,
  TrendLine, StackedBars, Donut, BarList, Legend, SERIES,
} from "@/components/kit";
import { AP_STATUS, CASE_STATUS } from "@/lib/status-vocabulary";

// Muestrario del rediseño (fase 0). Solo existe en desarrollo: sirve para revisar
// los componentes compartidos contra el lienzo sin base de datos ni sesión.
export default function KitPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const features = { exception_queue: true, advanced_analytics: true, vendor_rules: true, auto_mapping: true, contract_ai_extraction: true, contract_metrics: true, contract_flow_builder: true, contract_reference_archive: true, contract_approval_workflow: true };
  const weeks = ["sem 1", "sem 2", "sem 3", "sem 4", "sem 5", "sem 6", "sem 7", "sem 8"];

  return (
    <FeatureProvider features={features}>
      <TenantSidebar orgName="Grupo Trimontez" plan="growth" userEmail="marcela@trimontez.co" userRole="admin" activeProducts={["ap_automation", "contract_intelligence"]} />
      <main className="ml-56 min-h-screen space-y-10 px-11 py-8">
        <PageHeader
          eyebrow="Fase 0"
          title="Componentes compartidos"
          description="Muestrario para revisar contra el lienzo de diseño."
          crumbs={[{ href: "/dev/kit", label: "Desarrollo" }]}
          actions={<button className="rounded-lg bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground">Acción principal</button>}
        />

        <section className="space-y-3">
          <SectionTitle title="Estados de Facturas" aside={`${Object.keys(AP_STATUS).length} estados`} />
          <div className="flex flex-wrap gap-2">{Object.keys(AP_STATUS).map((s) => <ApStatusPill key={s} status={s} />)}</div>
          <div className="flex flex-wrap gap-5"><ApStatusPill status="review" detail="2 líneas sin ítem" dot /><ApStatusPill status="failed" detail="el ERP rechazó la ubicación" dot /></div>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Estados de Contratos" aside={`${Object.keys(CASE_STATUS).length} estados`} />
          <div className="flex flex-wrap gap-2">{Object.keys(CASE_STATUS).map((s) => <CaseStatusPill key={s} status={s} />)}</div>
          <div className="flex flex-wrap gap-2"><StatusPill tone="info">Información</StatusPill><StatusPill tone="blue">Azul</StatusPill></div>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Etapas como navegación" />
          <StageNav
            current="lines"
            stages={[
              { key: "lines", label: "Datos y líneas", detail: "2 líneas sin ítem", state: "warn", href: "/dev/kit" },
              { key: "po", label: "Orden de compra", detail: "OC-2291 · cuadra", state: "ok", href: "/dev/kit" },
              { key: "fis", label: "Validación fiscal", detail: "CFDI válido", state: "ok", href: "/dev/kit" },
              { key: "erp", label: "Envío al ERP", detail: "Al aprobar", state: "off" },
            ]}
            aux={[{ key: "act", label: "Actividad", href: "/dev/kit" }]}
          />
        </section>

        <section className="space-y-3">
          <SectionTitle title="Avisos y vacíos" />
          <Notice tone="warn" title="2 líneas no tienen ítem del ERP.">Cuando las asignes se puede enviar.</Notice>
          <Notice tone="err" title="El ERP rechazó la factura">La ubicación no está activa en la subsidiaria.</Notice>
          <EmptyState icon={FileText} title="Sin documentos todavía" actions={<button className="rounded-lg border border-border bg-card px-4 py-2 text-[13.5px] font-semibold">Subir documentos</button>}>
            Sube tu primera factura y DocuIA la lee, la cruza con tus catálogos y la envía al ERP.
          </EmptyState>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="rounded-[14px] border border-border bg-card p-5">
            <div className="mb-3 flex items-baseline justify-between"><h2 className="text-[15px] font-semibold">Facturas por semana</h2>
              <Legend items={[{ label: "Automáticas", color: SERIES.aqua }, { label: "Con revisión", color: SERIES.yellow }]} /></div>
            <StackedBars label="Facturas por semana" categories={weeks}
              series={[{ key: "auto", label: "Automáticas", color: SERIES.aqua }, { key: "rev", label: "Con revisión", color: SERIES.yellow }]}
              values={[52, 58, 61, 55, 66, 70, 64, 72].map((a, i) => ({ auto: a, rev: [21, 19, 22, 18, 17, 19, 15, 16][i] }))} />
          </div>
          <div className="rounded-[14px] border border-border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Estado de los casos</h2>
            <Donut center="46" sub="casos" parts={[
              { label: "Aprobados", value: 28, color: SERIES.aqua }, { label: "Por decidir", value: 9, color: SERIES.yellow },
              { label: "Rechazados", value: 5, color: SERIES.violet }, { label: "Con error", value: 2, color: SERIES.red },
              { label: "Analizando", value: 2, color: SERIES.blue },
            ]} />
          </div>
          <div className="rounded-[14px] border border-border bg-card p-5">
            <h2 className="mb-1 text-[15px] font-semibold">Tiempo al ERP</h2>
            <TrendLine label="Tiempo al ERP" fmt={{ unit: " min" }} points={[22, 19, 17, 15, 14, 12, 11, 9].map((v, i) => ({ label: weeks[i], value: v }))} />
          </div>
          <div className="rounded-[14px] border border-border bg-card p-5">
            <h2 className="mb-2 text-[15px] font-semibold">Del ingreso al ERP</h2>
            <BarList items={[{ label: "Recibidas", value: 980 }, { label: "Leídas sin error", value: 961 }, { label: "Cuadran con la OC", value: 902 }, { label: "En el ERP", value: 884 }]} />
          </div>
        </section>
      </main>
    </FeatureProvider>
  );
}
