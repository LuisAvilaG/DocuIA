import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard/ap-dashboard";
import { reasonBucket } from "@/lib/stats/ap-stats";
import { FileText } from "lucide-react";

function groupReasons(reasons: { reason: string | null; count: number }[]): string {
  const m = new Map<string, number>();
  for (const r of reasons) m.set(reasonBucket(r.reason), (m.get(reasonBucket(r.reason)) ?? 0) + r.count);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.charAt(0).toLowerCase()}${k.slice(1)}`).join(" · ");
}

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

type Recent = DashboardData["recent"][number];

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

const TASK_TONE = {
  warn: "bg-warning/10 text-warning",
  err: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  wait: "bg-[oklch(0.95_0.03_250)] text-[oklch(0.45_0.14_255)]",
} as const;

function Task({ count, title, detail, href, cta, tone }: { count: number; title: string; detail: string; href: string; cta: string; tone: keyof typeof TASK_TONE }) {
  return (
    <Link href={href} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-accent/40 transition-colors">
      <span className={`w-11 h-11 shrink-0 rounded-lg flex items-center justify-center text-base font-semibold tabular-nums ${TASK_TONE[tone]}`}>{count.toLocaleString("es-MX")}</span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[0.8125rem] font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground truncate">{detail}</span>
      </span>
      <span className="ml-auto text-xs font-semibold text-primary group-hover:underline shrink-0">{cta} →</span>
    </Link>
  );
}

export function DashboardView({ data, statsEnabled }: { data: DashboardData | null; statsEnabled: boolean }) {
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const dateLabel = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  const tasks = data ? [
    data.review && {
      key: "review", count: data.review.count, title: "En revisión", href: "/history?status=review", cta: "Revisar", tone: "warn" as const,
      detail: `Ítems, proveedor u OC por confirmar.${data.review.oldest ? ` La más antigua tiene ${ago(new Date(data.review.oldest))}.` : ""}`,
    },
    data.exceptions.count > 0 && {
      key: "exceptions", count: data.exceptions.count, title: "Excepciones", href: "/exceptions", cta: "Resolver",
      detail: groupReasons(data.exceptions.reasons) || "Documentos que no pudieron procesarse.", tone: "err" as const,
    },
    data.approval && {
      key: "approval", count: data.approval.count, title: "Por aprobar", href: "/history?status=pending_approval", cta: "Aprobar", tone: "info" as const,
      detail: `Esperan a un aprobador. $${money(data.approval.amount)} en total.`,
    },
    data.receipt && {
      key: "receipt", count: data.receipt.count, title: "Esperando recepción", href: "/history?status=awaiting_receipt", cta: "Ver", tone: "wait" as const,
      detail: `Se envían solas cuando almacén registre la entrada.${data.receipt.nextCheck ? ` Próxima revisión ${new Date(data.receipt.nextCheck).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}.` : ""}`,
    },
  ].filter((t): t is Exclude<typeof t, false | undefined | null> => Boolean(t)) : [];
  const attentionTotal = tasks.reduce((s, t) => s + t.count, 0);

  const firstName = data?.firstName ? `, ${data.firstName}` : "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar — same shell as every other screen */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">{greeting}{firstName}</h1>
          <p className="text-xs text-muted-foreground first-letter:uppercase">{dateLabel}</p>
        </div>
        <Link
          href="/workflow"
          className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium px-3 py-[7px] rounded-md transition-colors shrink-0"
        >
          <FileText className="w-3 h-3" />
          Subir documentos
        </Link>
      </div>

      <div className="flex-1 overflow-auto">
        {!data ? (
          <p className="p-6 text-sm text-muted-foreground">No se pudo cargar el resumen. Intenta recargar la página.</p>
        ) : (
          <div className="p-6 space-y-5 max-w-[1400px]">
            <p className="text-sm text-foreground/80">
              {data.today.total === 0
                ? "Hoy todavía no llegan documentos."
                : <>Hoy llegaron <strong className="text-foreground">{data.today.total.toLocaleString("es-MX")} documento{data.today.total === 1 ? "" : "s"}</strong>; <strong className="text-foreground">{data.today.auto.toLocaleString("es-MX")}</strong> ya {data.today.auto === 1 ? "está" : "están"} en el ERP sin intervención.</>}
            </p>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
              {/* Needs attention */}
              <section className="xl:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-baseline gap-2.5">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Necesita tu atención</h2>
                  <span className="text-xs text-muted-foreground">{attentionTotal.toLocaleString("es-MX")} documento{attentionTotal === 1 ? "" : "s"}</span>
                </div>
                {tasks.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-muted-foreground">Nada pendiente. Todo lo que llegó ya se procesó.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {tasks.map(({ key, ...t }) => <Task key={key} {...t} />)}
                  </div>
                )}
              </section>

              {/* This week */}
              <section className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-baseline gap-2.5">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Esta semana</h2>
                  {statsEnabled && <Link href="/statistics" className="ml-auto text-xs text-muted-foreground hover:text-foreground">Estadísticas →</Link>}
                </div>
                <div className="px-5 pt-4 pb-5 flex flex-col gap-4">
                  <WeekBars days={data.week.days} />
                  <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                    <div><p className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">Documentos</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.week.total.toLocaleString("es-MX")}</p></div>
                    <div><p className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">Sin intervención</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.week.autoPct === null ? "—" : `${data.week.autoPct}%`}</p></div>
                    <div><p className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">Mapeos nuevos</p><p className="mt-1 text-xl font-semibold tabular-nums">+{data.week.learned.toLocaleString("es-MX")}</p></div>
                  </div>
                </div>
              </section>
            </div>

            {/* Recent */}
            <section className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Recientes</h2>
                <Link href="/history" className="text-xs text-muted-foreground hover:text-foreground">Ver historial →</Link>
              </div>
              {data.recent.length === 0 ? (
                <p className="px-5 py-8 text-sm text-muted-foreground">Sube tu primer documento desde <Link href="/workflow" className="text-primary hover:underline">Workflow</Link>.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {["Documento", "Proveedor", "OC", "Total", "Estado", "Hace"].map((h) => (
                          <th key={h} className={`px-5 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground ${h === "Total" || h === "Hace" ? "text-right" : "text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.recent.map((d) => {
                        const st = recentState(d);
                        return (
                          <tr key={d.id} className="hover:bg-accent/40 transition-colors">
                            <td className="px-5 py-3 whitespace-nowrap">
                              <Link href={`/history/${d.id}`} className="text-xs font-semibold text-foreground hover:underline">{d.numDoc ?? `#${d.id}`}</Link>
                              <span className="ml-2 text-[0.6875rem] font-medium bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-sm">{DOC_TYPE_LABELS[d.documentType] ?? d.documentType}</span>
                            </td>
                            <td className="px-5 py-3 text-xs text-foreground max-w-[260px] truncate">{d.vendor ?? "—"}</td>
                            <td className="px-5 py-3 text-xs text-muted-foreground">{d.poLabel ?? "—"}</td>
                            <td className="px-5 py-3 text-xs text-right tabular-nums text-foreground">{d.total ? `$${money(Number(d.total))}` : "—"}</td>
                            <td className="px-5 py-3 max-w-[280px]"><span className="inline-flex items-center gap-1.5 text-xs text-foreground/85 truncate max-w-full"><span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} /><span className="truncate">{st.label}</span></span></td>
                            <td className="px-5 py-3 text-[0.6875rem] text-right tabular-nums text-muted-foreground whitespace-nowrap">{ago(d.createdAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
