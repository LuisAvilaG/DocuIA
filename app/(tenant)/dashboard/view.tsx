import Link from "next/link";
import { Upload } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard/ap-dashboard";
import { reasonBucket } from "@/lib/stats/ap-stats";
import { ActionLink, ApStatusPill, PageFrame, SectionTitle } from "@/components/kit";
import { friendlyError } from "@/lib/ap/friendly-error";

const DAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function ago(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 día" : `${d} días`;
}

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
/** An amount in its own currency («$1,740.00» for pesos, «USD 45.00» for the rest). */
const moneyIn = (n: number, currency: string) => {
  if (!currency || currency === "MXN") return `${money(n)}${currency ? " MXN" : ""}`;
  try { return n.toLocaleString("es-MX", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2 }); }
  catch { return `${currency} ${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`; }
};
const short = (s: string | null, max = 40) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;

/** «Ítem sin mapear (2), proveedor no identificado (1) y otros motivos (1).» */
function reasonSentence(reasons: { reason: string | null; count: number }[]): string {
  const m = new Map<string, number>();
  for (const r of reasons) m.set(reasonBucket(r.reason), (m.get(reasonBucket(r.reason)) ?? 0) + r.count);
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n], i) => `${i ? k.charAt(0).toLowerCase() + k.slice(1) : k} (${n})`);
  if (parts.length <= 1) return parts[0] ? `${parts[0]}.` : "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}.`;
}

type Recent = DashboardData["recent"][number];

function recentDetail(d: Recent): string | null {
  if (d.status === "completed") return d.approvedBy ? null : "automática";
  if (d.status === "review" || d.status === "failed") return short(friendlyError(d.errorMessage), 36);
  return null;
}

/** Documentos por día de la semana: una serie, valor encima de cada barra con datos. */
function WeekBars({ days, todayIdx }: { days: number[]; todayIdx: number }) {
  const shown = days.slice(0, Math.max(5, todayIdx + 1)); // fin de semana solo si ya llegó
  const W = 320, base = 104, top = 24, slot = W / shown.length, bw = Math.min(28, slot * 0.5);
  const max = Math.max(1, ...shown);
  const said = shown.map((n, i) => `${DAY_NAMES[i]} ${i > todayIdx ? "sin datos todavía" : n}`).join(", ");
  return (
    <svg viewBox={`0 0 ${W} 130`} className="mt-3.5 block h-auto w-full" role="img" aria-label={`Documentos por día esta semana: ${said}.`}>
      <line x1={0} x2={W} y1={base} y2={base} stroke="#D6D2C8" />
      {shown.map((n, i) => {
        const x = slot * i + (slot - bw) / 2;
        const h = (n / max) * (base - top);
        const future = i > todayIdx;
        return (
          <g key={i}>
            {n > 0 ? (
              <path d={`M${x} ${base}V${base - h + 4}a4 4 0 0 1 4-4h${bw - 8}a4 4 0 0 1 4 4V${base}z`} className={i === todayIdx ? "fill-primary" : "fill-primary/80"}>
                <title>{`${DAY_NAMES[i]}: ${plural(n, "documento", "documentos")}`}</title>
              </path>
            ) : (
              <rect x={x} y={base - 4} width={bw} height={4} rx={2} fill="#E2DFD8" />
            )}
            {n > 0 && !future && <text x={x + bw / 2} y={base - h - 6} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-foreground">{n.toLocaleString("es-MX")}</text>}
            <text x={x + bw / 2} y={122} textAnchor="middle" fontSize={11} className="fill-muted-foreground">{DAY_LABELS[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Todo({ count, title, detail, href, cta }: { count: number; title: string; detail: string; href: string; cta: string }) {
  return (
    <li className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft py-4">
      <span className="text-center text-[26px] font-semibold tracking-[-0.03em] tabular-nums">{count.toLocaleString("es-MX")}</span>
      <div className="min-w-0">
        <h3 className="text-[14.5px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[13.5px] text-foreground/80">{detail}</p>
      </div>
      <ActionLink href={href} variant="secondary" size="sm">{cta}</ActionLink>
    </li>
  );
}

export function DashboardView({ data, statsEnabled, exceptionsEnabled, canUpload }: { data: DashboardData | null; statsEnabled: boolean; exceptionsEnabled: boolean; canUpload: boolean }) {
  // Rendered on the server: dates and times need the client's zone.
  const timeZone = data?.timeZone;
  const dateLabel = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone });

  const tasks = data ? [
    data.review && {
      key: "review", count: data.review.count, title: "Por revisar", href: "/documents?status=review", cta: "Revisar",
      detail: reasonSentence(data.reviewReasons) || "Ítems, proveedor u orden de compra por confirmar.",
    },
    data.exceptions.count > 0 && {
      key: "exceptions", count: data.exceptions.count, title: "Excepciones", href: exceptionsEnabled ? "/exceptions" : "/documents?status=failed", cta: exceptionsEnabled ? "Resolver" : "Ver",
      detail: reasonSentence(data.exceptions.reasons) || "Documentos que no pudieron procesarse.",
    },
    data.approval && {
      key: "approval", count: data.approval.count, title: "Por aprobar", href: "/documents?status=pending_approval", cta: "Aprobar",
      detail: data.approvalAmounts.length ? `${data.approvalAmounts.map((a) => moneyIn(a.amount, a.currency)).join(" · ")} en total.` : `${money(data.approval.amount)} en total.`,
    },
    data.receipt && {
      key: "receipt", count: data.receipt.count, title: "Esperando recepción", href: "/documents?status=awaiting_receipt", cta: "Ver",
      detail: `Se envían solas cuando almacén registre la entrada.${data.receipt.nextCheck ? ` Se revisa de nuevo a las ${new Date(data.receipt.nextCheck).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone })}.` : ""}`,
    },
  ].filter((t): t is Exclude<typeof t, false | undefined | null> => Boolean(t)) : [];
  const attentionTotal = tasks.reduce((s, t) => s + t.count, 0);

  const headline = !data
    ? "Resumen del día"
    : data.today.total === 0
      ? "Hoy todavía no llegan documentos."
      : `Hoy ${data.today.total === 1 ? "llegó 1 documento" : `llegaron ${plural(data.today.total, "", "documentos").trim()}`}; ${data.today.auto === 0 ? "ninguno está en el ERP todavía" : `${data.today.auto.toLocaleString("es-MX")} ya ${data.today.auto === 1 ? "está" : "están"} en el ERP sin intervención`}.`;

  return (
    <PageFrame>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link first-letter:uppercase">{dateLabel}</p>
          <h1 className="mt-1 max-w-3xl text-[26px] font-semibold leading-tight tracking-[-0.025em]">{headline}</h1>
        </div>
        {canUpload && <ActionLink href="/documents?upload=1"><Upload />Subir documentos</ActionLink>}
      </header>

      {!data ? (
        <p className="mt-8 text-sm text-muted-foreground">No se pudo cargar el resumen. Intenta recargar la página.</p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 items-start gap-11 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
            <section>
              <SectionTitle title="Necesita tu atención" aside={plural(attentionTotal, "documento", "documentos")} />
              {tasks.length === 0
                ? <p className="py-6 text-sm text-muted-foreground">Nada pendiente. Todo lo que llegó ya se procesó.</p>
                : <ul>{tasks.map(({ key, ...t }) => <Todo key={key} {...t} />)}</ul>}
            </section>

            <aside>
              <SectionTitle title="Esta semana" aside={statsEnabled ? <Link href="/metrics" className="text-link hover:underline">Métricas →</Link> : undefined} />
              <WeekBars days={data.week.days} todayIdx={data.todayIdx} />
              <dl className="mt-3 text-[13.5px]">
                {[
                  ["Documentos", data.week.total.toLocaleString("es-MX")],
                  ["Sin intervención", data.week.autoPct === null ? "—" : `${data.week.autoPct} %`],
                  ["Mapeos nuevos", data.week.learned.toLocaleString("es-MX")],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line-soft py-2.5 last:border-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>

          <section className="mt-10">
            <SectionTitle title="Recientes" aside={<Link href="/documents" className="text-link hover:underline">Ver todos los documentos</Link>} />
            {data.recent.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                Todavía no hay documentos.{canUpload && <> Empieza con <Link href="/documents?upload=1" className="text-link hover:underline">Subir documentos</Link>.</>}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border">
                      {["Documento", "Proveedor", "OC", "Total", "Estado", "Hace"].map((h) => (
                        <th key={h} scope="col" className={`whitespace-nowrap px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground ${h === "Total" ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((d) => (
                      <tr key={d.id} className="border-b border-line-soft last:border-0">
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <Link href={`/history/${d.id}`} className="font-medium text-link hover:underline">{d.numDoc ?? `#${d.id}`}</Link>
                          {d.documentType === "purchase_order" && <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">OC</span>}
                        </td>
                        <td className="max-w-[240px] truncate px-3.5 py-3">{d.vendor ?? "—"}</td>
                        <td className="px-3.5 py-3 whitespace-nowrap">{d.poLabel ?? <span className="text-muted-foreground">Sin OC</span>}</td>
                        <td className="px-3.5 py-3 text-right tabular-nums whitespace-nowrap">{d.total ? Number(d.total).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "—"}</td>
                        <td className="max-w-[300px] px-3.5 py-3"><ApStatusPill status={d.status} detail={recentDetail(d)} dot /></td>
                        <td className="px-3.5 py-3 text-muted-foreground whitespace-nowrap">{ago(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PageFrame>
  );
}
