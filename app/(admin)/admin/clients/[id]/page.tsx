import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/db/schema";
import { loadOneOrgFacts, healthFromFacts, type OrgCheck } from "@/lib/admin/health";
import { describeAdminAction } from "@/lib/audit/admin";
import { Notice, fmtDate, relativeTime, num } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

interface Event { at: Date; title: string; detail: string; tone: "ok" | "now" | "info" }

const NEXT_STEP: Record<OrgCheck["key"], { title: string; href: string; cta: string }> = {
  users:     { title: "Siguiente paso: crear el primer usuario", href: "/users", cta: "Crear usuario" },
  erp:       { title: "Siguiente paso: probar y activar el ERP", href: "/erp", cta: "Ir a la conexión" },
  catalog:   { title: "Siguiente paso: sincronizar el catálogo", href: "/erp", cta: "Ir a subsidiarias" },
  first_run: { title: "Siguiente paso: procesar el primer documento", href: "/usage", cta: "Ver uso" },
};

export default async function ClientExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = await loadOneOrgFacts(id);
  if (!facts) notFound();
  const health = healthFromFacts(facts);
  const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetOrgId, id)).orderBy(desc(adminAuditLog.createdAt)).limit(6);

  const events: Event[] = [];
  const sandbox = facts.connections.find((c) => c.environment === "sandbox");
  const production = facts.connections.find((c) => c.environment === "production");
  if (health.pending) {
    const p = health.pending;
    events.push({ at: new Date(), tone: "now", title: p.label.replace(/ conectado$/, " sin activar"), detail: p.detail });
  }
  if (facts.subsidiaries.items > 0) events.push({ at: facts.lastActivityAt ?? facts.createdAt, tone: "ok", title: "Catálogo sincronizado", detail: `${facts.subsidiaries.active} subsidiaria${facts.subsidiaries.active === 1 ? "" : "s"} · ${num(facts.subsidiaries.items)} ítems` });
  if (facts.firstRun.caseAt) events.push({ at: facts.firstRun.caseAt, tone: "ok", title: "Primer caso de contratos analizado", detail: `hoy lleva ${num(facts.usage30.cases)} casos en 30 días` });
  if (facts.firstRun.reportAt) events.push({ at: facts.firstRun.reportAt, tone: "ok", title: "Primer informe de gastos", detail: `${num(facts.usage30.reports)} informes en 30 días` });
  if (facts.firstRun.docAt) events.push({ at: facts.firstRun.docAt, tone: "ok", title: "Primer documento AP procesado", detail: `hoy lleva ${num(facts.usage30.docs)} documentos en 30 días` });
  if (production?.status === "connected") events.push({ at: production.testedAt ?? facts.createdAt, tone: "ok", title: "ERP de producción conectado", detail: `cuenta ${production.accountId}` });
  if (sandbox?.status === "connected") events.push({ at: sandbox.testedAt ?? facts.createdAt, tone: "ok", title: "ERP sandbox conectado", detail: `cuenta ${sandbox.accountId}${sandbox.scriptsInstalled ? " · scripts instalados" : ""}` });
  if (facts.users.total > 0) events.push({ at: facts.createdAt, tone: "ok", title: "Usuarios creados", detail: `${facts.users.total} usuario${facts.users.total === 1 ? "" : "s"} · ${facts.users.admins} administrador${facts.users.admins === 1 ? "" : "es"}` });
  events.push({ at: facts.createdAt, tone: "info", title: "Alta de la organización", detail: `productos: ${facts.products.map((p) => p.key).join(", ") || "ninguno"}` });
  events.sort((a, b) => (a.tone === "now" ? -1 : b.tone === "now" ? 1 : b.at.getTime() - a.at.getTime()));

  const headline = health.pending
    ? facts.status === "suspended"
      ? <>Acceso suspendido.</>
      : <>Casi lista. <span className="text-[oklch(0.50_0.14_80)]">{health.pending.label.replace(/ conectado$/, " pendiente").replace(/^Primer /, "Falta el primer ").replace(/^Usuarios creados$/, "Faltan usuarios").replace(/^Catálogo sincronizado$/, "Catálogo sin sincronizar")}.</span></>
    : <>En marcha. <span className="text-primary">Todo lo necesario está activo.</span></>;

  return (
    <>
      <section>
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{headline}</h2>
        <p className="text-[15px] text-muted-foreground mt-2.5 max-w-[56ch]">
          {facts.status === "suspended"
            ? `Nadie puede entrar al portal${facts.suspensionReason ? `: ${facts.suspensionReason}` : "."} Restablece el acceso desde el panel.`
            : health.pending ? health.pending.detail : `Última actividad ${relativeTime(facts.lastActivityAt)}.`}
        </p>
      </section>

      {health.pending && facts.status !== "suspended" && (
        <Notice tone="warn" title={NEXT_STEP[health.pending.key].title} action={<Button nativeButton={false} render={<Link href={`/admin/clients/${id}${NEXT_STEP[health.pending.key].href}`} />} size="sm">{NEXT_STEP[health.pending.key].cta}</Button>}>
          {health.pending.detail}
        </Notice>
      )}

      <section>
        <h3 className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground mb-5">Historia del cliente</h3>
        <ol className="relative pl-9 before:absolute before:left-[11px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-border">
          {events.map((e, i) => (
            <li key={i} className="relative pb-7 last:pb-0">
              <span className={`absolute -left-9 top-0.5 w-[22px] h-[22px] rounded-full border flex items-center justify-center text-[11px] font-semibold ${
                e.tone === "now" ? "bg-[oklch(0.62_0.16_85)] border-[oklch(0.62_0.16_85)] text-white" : e.tone === "ok" ? "bg-success/10 border-success/30 text-success" : "bg-card border-border text-muted-foreground"}`}>
                {e.tone === "now" ? "!" : e.tone === "ok" ? "✓" : "·"}
              </span>
              <div className="font-semibold text-[15px]">{e.title}</div>
              <div className="text-[13px] text-muted-foreground mt-0.5">{e.tone === "now" ? "" : `${fmtDate(e.at)} · `}{e.detail}</div>
            </li>
          ))}
        </ol>
      </section>

      {audit.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between border-b border-foreground pb-2">
            <h3 className="text-[13px] font-semibold">Últimas acciones de plataforma</h3>
            <Link href={`/admin/clients/${id}/activity`} className="text-xs text-primary">Ver toda la actividad</Link>
          </div>
          <ul className="divide-y divide-border/70">
            {audit.map((a) => (
              <li key={a.id} className="py-3 flex gap-4 text-[13px]">
                <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(a.createdAt)}</span>
                <span className="min-w-0"><span className="font-medium">{a.adminEmail}</span> · {describeAdminAction(a)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
