import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { canAccessTenantArea } from "@/lib/auth/permissions";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { getContractsHome, fmtDuration } from "@/lib/contracts/home";
import { ActionLink, EmptyState, PageFrame, SectionTitle, StatusPill } from "@/components/kit";

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;

export default async function ContractsHomePage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");

  const [extraction, data] = await Promise.all([
    isFeatureEnabled(session.orgId, "contract_ai_extraction"),
    getContractsHome(session.orgId),
  ]);
  const canCreate = extraction && canAccessTenantArea(session.role, { area: "contracts", permission: "write" });
  const dateLabel = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  const parts = [
    data.waiting ? plural(data.waiting, "caso espera tu decisión", "casos esperan tu decisión") : null,
    data.analyzing ? plural(data.analyzing, "se está analizando", "se están analizando") : null,
  ].filter(Boolean);
  const fullHeadline = parts.length ? `${parts.join(" y ")}.` : "Nada espera tu decisión.";
  const maxCases = Math.max(1, ...data.byFlow.map((f) => f.cases));

  if (data.last30.created === 0 && data.attention.length === 0 && data.analyzing === 0) {
    return (
      <PageFrame>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Todavía no hay casos.</h1>
        <EmptyState className="mt-8" title="Empieza con tu primer caso"
          actions={canCreate ? <ActionLink href="/cases?new=1">Nuevo caso</ActionLink> : undefined}>
          Elige un flujo, sube los documentos que pide y DocuIA los lee, calcula y valida por ti.
        </EmptyState>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-[720px]">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link first-letter:uppercase">{dateLabel}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] first-letter:uppercase">{fullHeadline}</h1>
        </div>
        {canCreate && <ActionLink href="/cases?new=1">Nuevo caso</ActionLink>}
      </header>

      <div className="mt-9 grid items-start gap-12 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        <section>
          <SectionTitle title="Para atender" aside="de lo más urgente a lo menos" />
          {data.attention.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Nada pendiente de decisión.</p>
          ) : (
            <ul>
              {data.attention.map((a) => (
                <li key={a.id} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-4 border-b border-line-soft py-4">
                  <span><StatusPill tone={a.tone}>{a.label}</StatusPill></span>
                  <div className="min-w-0">
                    <h3 className="truncate text-[14.5px] font-semibold">{a.title}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[13.5px] text-foreground/80">{a.detail}</p>
                    <small className="mt-1 block text-xs text-muted-foreground">{a.flowName} · esperando desde {ago(a.since)}</small>
                  </div>
                  <ActionLink href={`/contracts/${a.id}`} variant="secondary" size="sm">{a.cta}</ActionLink>
                </li>
              ))}
            </ul>
          )}
          {data.analyzing > 0 && (
            <p className="mt-3.5 text-[13px] text-muted-foreground">
              Además, {plural(data.analyzing, "caso se está", "casos se están")} analizando ahora. <Link href="/cases?view=analyzing" className="text-link hover:underline">Verlos en Casos</Link>
            </p>
          )}
        </section>

        <aside>
          <SectionTitle title="Últimos 30 días" aside="todos los flujos" />
          <dl className="mt-1 text-[13.5px]">
            {[
              ["Casos creados", data.last30.created.toLocaleString("es-MX")],
              ["Terminados", `${data.last30.done.toLocaleString("es-MX")}${data.last30.created ? ` · ${Math.round((data.last30.done / data.last30.created) * 100)} %` : ""}`],
              ["Tiempo de análisis (mediana)", fmtDuration(data.last30.medianSec)],
              ["Con hallazgos", data.last30.findings.toLocaleString("es-MX")],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
                <dt className="text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      {data.byFlow.length > 0 && (
        <section className="mt-12">
          <SectionTitle title="Por flujo" aside="últimos 30 días" />
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] tabular-nums">
              <thead>
                <tr className="border-b border-border">
                  {["Flujo", "Casos", "Terminados", "Con hallazgos", "Análisis (mediana)", "Volumen"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.byFlow.map((f) => (
                  <tr key={f.flowId ?? "none"} className="border-b border-line-soft last:border-0">
                    <td className="px-3.5 py-3 font-semibold">{f.name}</td>
                    <td className="px-3.5 py-3">{f.cases}</td>
                    <td className="px-3.5 py-3">{f.done}</td>
                    <td className="px-3.5 py-3">{f.findings}</td>
                    <td className="px-3.5 py-3">{fmtDuration(f.medianSec)}</td>
                    <td className="w-[22%] px-3.5 py-3"><div className="h-2 rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${(f.cases / maxCases) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PageFrame>
  );
}
