import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments, itemMappings, orgUsers, subsidiaries } from "@/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";

const DOC_TYPE_LABELS: Record<string, string> = { invoice: "Factura", purchase_order: "OC", xml_cfdi: "CFDI" };
const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function ago(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 día" : `${d} días`;
}

const money = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s: string | null, max = 42) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek() {
  const x = startOfDay();
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

async function getDashboardData(orgId: string, userId: string) {
  const today = startOfDay();
  const week = startOfWeek();
  const org = eq(historyDocuments.organizationId, orgId);

  const [user, todayRow, waiting, exceptions, exceptionReasons, weekDays, weekRow, learned, recent] = await Promise.all([
    db.query.orgUsers.findFirst({ where: eq(orgUsers.id, userId), columns: { fullName: true } }),
    db.select({
      total: sql<number>`count(*)::int`,
      auto:  sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is null)::int`,
    }).from(historyDocuments).where(and(org, gte(historyDocuments.createdAt, today))),
    db.select({
      status: historyDocuments.status,
      count:  sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${historyDocuments.total}), 0)::float`,
      oldest: sql<Date | null>`min(${historyDocuments.createdAt})`,
      nextCheck: sql<Date | null>`min(${historyDocuments.nextReceiptCheckAt})`,
    }).from(historyDocuments)
      .where(and(org, inArray(historyDocuments.status, ["review", "pending_approval", "awaiting_receipt"])))
      .groupBy(historyDocuments.status),
    db.select({ count: sql<number>`count(*)::int` }).from(exceptionQueue)
      .where(and(eq(exceptionQueue.organizationId, orgId), eq(exceptionQueue.status, "pending"))),
    db.select({ reason: exceptionQueue.failureReason, count: sql<number>`count(*)::int` }).from(exceptionQueue)
      .where(and(eq(exceptionQueue.organizationId, orgId), eq(exceptionQueue.status, "pending")))
      .groupBy(exceptionQueue.failureReason)
      .orderBy(desc(sql`count(*)`))
      .limit(3),
    db.select({
      day:   sql<number>`((extract(isodow from ${historyDocuments.createdAt}))::int - 1)`,
      count: sql<number>`count(*)::int`,
    }).from(historyDocuments)
      .where(and(org, gte(historyDocuments.createdAt, week)))
      .groupBy(sql`1`),
    db.select({
      completed: sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed')::int`,
      auto:      sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is null)::int`,
    }).from(historyDocuments).where(and(org, gte(historyDocuments.createdAt, week))),
    db.select({ count: sql<number>`count(*)::int` }).from(itemMappings)
      .innerJoin(subsidiaries, eq(subsidiaries.id, itemMappings.subsidiaryId))
      .where(and(eq(subsidiaries.organizationId, orgId), gte(itemMappings.createdAt, week))),
    // PO number read straight from the JSON so the heavy products column is not loaded.
    db.select({
      id: historyDocuments.id, documentType: historyDocuments.documentType, status: historyDocuments.status,
      vendor: historyDocuments.vendor, numDoc: historyDocuments.numDoc, total: historyDocuments.total,
      createdAt: historyDocuments.createdAt, approvedBy: historyDocuments.approvedBy,
      poInternalId: historyDocuments.poInternalId, errorMessage: historyDocuments.errorMessage,
      poTranid: sql<string | null>`(${historyDocuments.products}->'ap_checks'->'po'->'comparison'->>'poTranid')`,
    }).from(historyDocuments).where(org).orderBy(desc(historyDocuments.createdAt)).limit(6),
  ]);

  const byStatus = new Map(waiting.map((w) => [w.status, w]));
  const days = Array.from({ length: 7 }, (_, i) => weekDays.find((d) => Number(d.day) === i)?.count ?? 0);
  const weekTotal = days.reduce((s, n) => s + n, 0);
  const w = weekRow[0];

  return {
    firstName: user?.fullName?.trim().split(/\s+/)[0] ?? null,
    today: { total: todayRow[0]?.total ?? 0, auto: todayRow[0]?.auto ?? 0 },
    review: byStatus.get("review"),
    approval: byStatus.get("pending_approval"),
    receipt: byStatus.get("awaiting_receipt"),
    exceptions: { count: exceptions[0]?.count ?? 0, reasons: exceptionReasons },
    week: { days, total: weekTotal, autoPct: w?.completed ? Math.round((w.auto / w.completed) * 100) : null, learned: learned[0]?.count ?? 0 },
    recent: recent.map((d) => ({ ...d, poLabel: d.poTranid ?? (d.poInternalId ? `#${d.poInternalId}` : null) })),
  };
}

type Recent = Awaited<ReturnType<typeof getDashboardData>>["recent"][number];

function recentState(d: Recent): { dot: string; label: string } {
  switch (d.status) {
    case "completed": return { dot: "bg-success", label: d.approvedBy ? "En el ERP" : "En el ERP · automática" };
    case "review": return { dot: "bg-warning", label: `En revisión${d.errorMessage ? ` · ${short(d.errorMessage, 34)}` : ""}` };
    case "pending_approval": return { dot: "bg-warning", label: "Por aprobar" };
    case "awaiting_receipt": return { dot: "bg-[oklch(0.50_0.14_255)]", label: "Esperando recepción" };
    case "failed": return { dot: "bg-destructive", label: `Excepción${d.errorMessage ? ` · ${short(d.errorMessage, 34)}` : ""}` };
    case "processing": case "extracting": case "uploaded": return { dot: "bg-muted-foreground/50", label: "Procesando" };
    default: return { dot: "bg-muted-foreground/50", label: d.status };
  }
}

// Documents per day this week: one series, today emphasized, direct label on today only.
function WeekBars({ days }: { days: number[] }) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const W = 380, H = 170, left = 30, base = 136, top = 18;
  const max = Math.max(4, ...days);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = Math.ceil(max / step / 2) * step * 2;
  const ticks = [0, nice / 2, nice];
  const y = (v: number) => base - (v / nice) * (base - top);
  const slot = (W - left) / 7;
  const bw = 20;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[380px] h-auto" role="img" aria-label={`Documentos por día esta semana: ${days.map((n, i) => `${DAY_LABELS[i]} ${n}`).join(", ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 2} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={10.5} className="fill-muted-foreground">{t.toLocaleString("es-MX")}</text>
        </g>
      ))}
      {days.map((n, i) => {
        const x = left + slot * i + (slot - bw) / 2;
        const isToday = i === todayIdx;
        const future = i > todayIdx;
        const h = base - y(n);
        return (
          <g key={i}>
            <title>{`${DAY_LABELS[i]}: ${n.toLocaleString("es-MX")} documento${n === 1 ? "" : "s"}`}</title>
            {/* hit target larger than the bar */}
            <rect x={left + slot * i} y={top} width={slot} height={base - top} fill="transparent" />
            {n > 0 && (
              <path
                d={`M${x} ${base}V${base - h + Math.min(4, h)}Q${x} ${base - h} ${x + Math.min(4, h)} ${base - h}H${x + bw - Math.min(4, h)}Q${x + bw} ${base - h} ${x + bw} ${base - h + Math.min(4, h)}V${base}Z`}
                className={isToday ? "fill-primary" : "fill-primary/35"}
              />
            )}
            {isToday && (
              <text x={x + bw / 2} y={base - h - 7} textAnchor="middle" fontSize={11.5} fontWeight={600} className="fill-foreground">{n.toLocaleString("es-MX")} hoy</text>
            )}
            <text x={x + bw / 2} y={160} textAnchor="middle" fontSize={10.5} fontWeight={isToday ? 600 : 400} className={isToday ? "fill-foreground" : future ? "fill-muted-foreground/60" : "fill-muted-foreground"}>{DAY_LABELS[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Task({ count, title, detail, href, cta, muted }: { count: number; title: string; detail: string; href: string; cta: string; muted?: boolean }) {
  return (
    <Link href={href} className="group flex items-center gap-5 py-4 border-b border-border last:border-0">
      <span className={`w-14 shrink-0 text-[1.75rem] font-semibold tracking-[-0.02em] tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}>{count}</span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className="ml-auto text-[0.8125rem] font-semibold text-primary group-hover:underline shrink-0">{cta}</span>
    </Link>
  );
}

export default async function TenantDashboardPage() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);

  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  try {
    data = await getDashboardData(session.orgId, session.sub);
  } catch (err) {
    console.error("[tenant-dashboard]", err);
  }
  const statsEnabled = await isFeatureEnabled(session.orgId, "advanced_analytics");

  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const dateLabel = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  const tasks = data ? [
    data.review && {
      key: "review", count: data.review.count, title: "En revisión", href: "/history?status=review", cta: "Revisar",
      detail: `Ítems, proveedor u OC por confirmar.${data.review.oldest ? ` La más antigua tiene ${ago(new Date(data.review.oldest))}.` : ""}`,
    },
    data.exceptions.count > 0 && {
      key: "exceptions", count: data.exceptions.count, title: "Excepciones", href: "/exceptions", cta: "Resolver",
      detail: data.exceptions.reasons.map((r) => `${r.count} ${short(r.reason, 48) ?? "sin motivo"}`).join(" · ") || "Documentos que no pudieron procesarse.",
    },
    data.approval && {
      key: "approval", count: data.approval.count, title: "Por aprobar", href: "/history?status=pending_approval", cta: "Aprobar",
      detail: `Esperan a un aprobador. $${money(data.approval.amount)} en total.`,
    },
    data.receipt && {
      key: "receipt", count: data.receipt.count, title: "Esperando recepción", href: "/history?status=awaiting_receipt", cta: "Ver", muted: true,
      detail: `Se envían solas cuando almacén registre la entrada.${data.receipt.nextCheck ? ` Próxima revisión ${new Date(data.receipt.nextCheck).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}.` : ""}`,
    },
  ].filter((t): t is Exclude<typeof t, false | undefined | null> => Boolean(t)) : [];
  const attentionTotal = tasks.reduce((s, t) => s + t.count, 0);

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 md:px-12 py-9 flex flex-col gap-8 max-w-[1280px]">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground first-letter:uppercase">{dateLabel}</span>
            <h1 className="text-[1.625rem] font-semibold tracking-[-0.02em] text-foreground">{greeting}{data?.firstName ? `, ${data.firstName}` : ""}</h1>
            {data && (
              <p className="text-[0.9375rem] text-foreground/80">
                {data.today.total === 0
                  ? "Hoy todavía no llegan documentos."
                  : <>Hoy llegaron <strong>{data.today.total.toLocaleString("es-MX")} documento{data.today.total === 1 ? "" : "s"}</strong>; <strong>{data.today.auto.toLocaleString("es-MX")}</strong> ya {data.today.auto === 1 ? "está" : "están"} en el ERP sin que nadie {data.today.auto === 1 ? "la" : "las"} tocara.</>}
              </p>
            )}
          </div>
          <Link href="/workflow" className="ml-auto inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[0.8125rem] font-semibold text-primary-foreground hover:bg-primary/90">
            Subir documentos
          </Link>
        </div>

        {!data ? (
          <p className="text-sm text-muted-foreground">No se pudo cargar el resumen. Intenta recargar la página.</p>
        ) : (
          <>
            <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-start">
              <section className="flex-1 min-w-0 w-full flex flex-col">
                <div className="flex items-baseline gap-2.5 pb-1">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">Necesita tu atención</h2>
                  <span className="text-xs text-muted-foreground">{attentionTotal.toLocaleString("es-MX")} documento{attentionTotal === 1 ? "" : "s"}</span>
                </div>
                {tasks.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">Nada pendiente. Todo lo que llegó ya se procesó.</p>
                ) : (
                  tasks.map(({ key, ...t }) => <Task key={key} {...t} />)
                )}
              </section>

              <section className="w-full lg:w-[400px] shrink-0 flex flex-col gap-3">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">Esta semana</h2>
                  {statsEnabled && <Link href="/statistics" className="ml-auto text-[0.8125rem] text-primary hover:underline">Estadísticas</Link>}
                </div>
                <WeekBars days={data.week.days} />
                <div className="flex gap-7">
                  <div className="flex flex-col gap-0.5"><span className="text-xs font-semibold text-muted-foreground">Documentos</span><span className="text-[1.375rem] font-semibold tabular-nums">{data.week.total.toLocaleString("es-MX")}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-xs font-semibold text-muted-foreground">Sin intervención</span><span className="text-[1.375rem] font-semibold tabular-nums">{data.week.autoPct === null ? "—" : `${data.week.autoPct}%`}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-xs font-semibold text-muted-foreground">Mapeos aprendidos</span><span className="text-[1.375rem] font-semibold tabular-nums">+{data.week.learned.toLocaleString("es-MX")}</span></div>
                </div>
              </section>
            </div>

            <div className="h-px bg-border" />

            <section className="flex flex-col gap-3.5">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground">Recientes</h2>
                <Link href="/history" className="ml-auto text-[0.8125rem] text-primary hover:underline">Ver historial</Link>
              </div>
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sube tu primer documento desde <Link href="/workflow" className="text-primary hover:underline">Workflow</Link>.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead>
                      <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                        <th className="pb-2.5 font-medium">Documento</th>
                        <th className="pb-2.5 font-medium">Proveedor</th>
                        <th className="pb-2.5 font-medium">OC</th>
                        <th className="pb-2.5 font-medium text-right">Total</th>
                        <th className="pb-2.5 pl-8 font-medium">Estado</th>
                        <th className="pb-2.5 font-medium text-right">Hace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((d) => {
                        const s = recentState(d);
                        return (
                          <tr key={d.id} className="border-b border-border/60 hover:bg-accent/30 transition-colors">
                            <td className="py-3 pr-4 whitespace-nowrap">
                              <Link href={`/history/${d.id}`} className="font-semibold text-foreground hover:underline">{d.numDoc ?? `#${d.id}`}</Link>{" "}
                              <span className="text-xs text-muted-foreground">{DOC_TYPE_LABELS[d.documentType] ?? d.documentType}</span>
                            </td>
                            <td className="py-3 pr-4 text-foreground">{d.vendor ?? "—"}</td>
                            <td className="py-3 pr-4 text-foreground">{d.poLabel ?? "—"}</td>
                            <td className="py-3 text-right tabular-nums text-foreground">{d.total ? `$${money(Number(d.total))}` : "—"}</td>
                            <td className="py-3 pl-8"><span className="inline-flex items-center gap-1.5 text-xs text-foreground/85"><span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />{s.label}</span></td>
                            <td className="py-3 text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">{ago(d.createdAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
