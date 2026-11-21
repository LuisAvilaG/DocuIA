"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ONE } from "./palette";


/** Formato serializable (las páginas de servidor no pueden pasar funciones a componentes cliente). */
export interface FmtSpec { unit?: string; currency?: string; decimals?: number }
type Fmt = (v: number) => string;
function toFmt(spec: FmtSpec = {}): Fmt {
  return (v) => {
    if (spec.currency) return v.toLocaleString("es-MX", { style: "currency", currency: spec.currency, maximumFractionDigits: spec.decimals ?? 0 });
    return `${v.toLocaleString("es-MX", { maximumFractionDigits: spec.decimals ?? 1 })}${spec.unit ?? ""}`;
  };
}

function Tip({ left, top, children }: { left: string; top: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
      style={{ left, top: `calc(${top} - 8px)` }}
    >
      {children}
    </div>
  );
}

/** Leyenda: siempre presente con 2+ series; la identidad nunca va solo por color. */
export function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />{i.label}</li>
      ))}
    </ul>
  );
}

/** Línea con área para una medida en el tiempo. */
export function TrendLine({ points, fmt, color = ONE, height = 120, label }: {
  points: { label: string; value: number }[];
  fmt?: FmtSpec;
  color?: string;
  height?: number;
  label: string;
}) {
  const format = toFmt(fmt);
  const [hovered, setHover] = useState<number | null>(null);
  // The point under the cursor may be gone after new data arrives.
  const hover = hovered != null && hovered < points.length ? hovered : null;
  const W = 320, H = height, padX = 6, top = 12, bottom = H - 22;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const x = (i: number) => padX + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - padX * 2));
  const y = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const first = points[0], last = points[points.length - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={first && last ? `${label}: de ${format(first.value)} a ${format(last.value)}` : label}
        onMouseLeave={() => setHover(null)}>
        <line x1={padX} x2={W - padX} y1={bottom} y2={bottom} stroke="var(--border)" />
        {points.length > 1 && <path d={`${d}L${x(points.length - 1)} ${bottom}L${x(0)} ${bottom}z`} fill={color} opacity={0.08} />}
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={10} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && <circle cx={x(hover)} cy={y(points[hover].value)} r={4.5} fill="#fff" stroke={color} strokeWidth={2} />}
        {last && <circle cx={x(points.length - 1)} cy={y(last.value)} r={4} fill={color} />}
        {first && <text x={x(0)} y={H - 4} fontSize={10.5} fill="var(--muted-foreground)">{first.label}</text>}
        {last && <text x={x(points.length - 1)} y={H - 4} fontSize={10.5} textAnchor="end" fill="var(--muted-foreground)">{last.label}</text>}
      </svg>
      {hover != null && (
        <Tip left={`${(x(hover) / W) * 100}%`} top={`${(y(points[hover].value) / H) * 100}%`}>
          {points[hover].label}: <b className="font-semibold">{format(points[hover].value)}</b>
        </Tip>
      )}
    </div>
  );
}

/** Barras apiladas: varias series que suman un total por categoría. */
export function StackedBars({ categories, series, values, fmt, height = 220, label }: {
  categories: string[];
  series: { key: string; label: string; color: string }[];
  /** values[i][serieKey] para la categoría i */
  values: Record<string, number>[];
  fmt?: FmtSpec;
  height?: number;
  label: string;
}) {
  const format = toFmt(fmt);
  const [hovered, setHover] = useState<number | null>(null);
  const hover = hovered != null && hovered < Math.min(categories.length, values.length) ? hovered : null;
  const W = 700, H = height, x0 = 34, base = H - 26, top = 10;
  const totals = values.map((v) => series.reduce((a, s) => a + (v[s.key] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const step = (W - x0 - 6) / Math.max(categories.length, 1);
  const bw = Math.min(30, step * 0.6);
  const scale = (v: number) => (v / max) * (base - top);
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const every = Math.ceil(categories.length / 6);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={W} y1={base - scale(t)} y2={base - scale(t)} stroke={t ? "var(--line-soft)" : "var(--border)"} />
            <text x={x0 - 8} y={base - scale(t) + 4} fontSize={11} textAnchor="end" fill="var(--muted-foreground)">{format(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = x0 + i * step + (step - bw) / 2;
          let acc = 0;
          const segs = series.filter((s) => (values[i]?.[s.key] ?? 0) > 0);
          return (
            <g key={c} onMouseEnter={() => setHover(i)} className="cursor-pointer">
              <rect x={cx - 3} y={top} width={bw + 6} height={base - top} fill="transparent" />
              {segs.map((s, j) => {
                const h = scale(values[i][s.key]);
                const yTop = base - acc - h;
                acc += h;
                const isTop = j === segs.length - 1;
                const gap = j > 0 ? 2 : 0;
                // The rounded cap never takes more than the segment has: a thin
                // top segment was drawn 4 px tall whatever its value, and a
                // narrow bar came out deformed.
                const tall = Math.max(h - gap, 0);
                const rr = Math.max(0, Math.min(4, tall, bw / 2));
                return isTop
                  ? <path key={s.key} d={`M${cx} ${yTop + tall}V${yTop + rr}a${rr} ${rr} 0 0 1 ${rr}-${rr}h${bw - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${yTop + tall}z`} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />
                  : <rect key={s.key} x={cx} y={yTop} width={bw} height={Math.max(h - gap, 0)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
              })}
              {(i % every === 0 || i === categories.length - 1) && (
                <text x={cx + bw / 2} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--muted-foreground)">{c}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tip left={`${((x0 + hover * step + step / 2) / W) * 100}%`} top={`${((base - scale(totals[hover])) / H) * 100}%`}>
          <b className="font-semibold">{categories[hover]} · {format(totals[hover])}</b>
          {series.map((s) => (values[hover]?.[s.key] ?? 0) > 0 && (
            <span key={s.key} className="block"><span className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: s.color }} />{s.label}: {format(values[hover][s.key])}</span>
          ))}
        </Tip>
      )}
    </div>
  );
}

/** Dona de partes de un todo, con total al centro y leyenda con cantidades. */
export function Donut({ parts, center, sub, size = 168, fmt }: {
  parts: { label: string; value: number; color: string }[];
  center: string;
  sub: string;
  size?: number;
  fmt?: FmtSpec;
}) {
  const format = toFmt(fmt);
  const [hovered, setHover] = useState<number | null>(null);
  const hover = hovered != null && hovered < parts.length ? hovered : null;
  const r = 62, c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const arcs = parts.map((p, i) => {
    const len = (p.value / total) * c;
    const off = parts.slice(0, i).reduce((a, q) => a + (q.value / total) * c, 0);
    return { len, off };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 168 168" width={size} height={size} role="img" aria-label={`${center} ${sub}`} className="shrink-0" onMouseLeave={() => setHover(null)}>
        <circle r={r} cx={84} cy={84} fill="none" stroke="var(--secondary)" strokeWidth={20} />
        {parts.map((p, i) => {
          const { len, off } = arcs[i];
          return (
            <circle key={p.label} r={r} cx={84} cy={84} fill="none" stroke={p.color}
              strokeWidth={hover === i ? 24 : 20} strokeDasharray={`${Math.max(len - 3, 0.1)} ${c}`} strokeDashoffset={-off}
              transform="rotate(-90 84 84)" className="cursor-pointer transition-[stroke-width]" onMouseEnter={() => setHover(i)}>
              <title>{`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)} %)`}</title>
            </circle>
          );
        })}
        <text x={84} y={82} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--foreground)">{hover != null ? format(parts[hover].value) : center}</text>
        <text x={84} y={102} textAnchor="middle" fontSize={11.5} fill="var(--muted-foreground)">{hover != null ? parts[hover].label : sub}</text>
      </svg>
      <ul className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-[13px]">
        {parts.map((p, i) => (
          <li key={p.label} className={cn("grid grid-cols-[12px_minmax(0,1fr)_auto_40px] items-center gap-2", hover === i && "font-semibold")}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            <span className="truncate">{p.label}</span>
            <b className="font-semibold tabular-nums">{format(p.value)}</b>
            <em className="text-right not-italic tabular-nums text-muted-foreground">{Math.round((p.value / total) * 100)} %</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras horizontales: una medida por elemento (también sirve de embudo). */
export function BarList({ items, fmt, color = ONE, labelWidth = 150 }: {
  items: { label: string; value: number; hint?: string }[];
  fmt?: FmtSpec;
  color?: string;
  labelWidth?: number;
}) {
  const format = toFmt(fmt);
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col">
      {items.map((i) => (
        <li key={i.label} title={i.hint ?? `${i.label}: ${format(i.value)}`} className="group grid items-center gap-2.5 py-1.5 text-[13px]" style={{ gridTemplateColumns: `minmax(72px, ${labelWidth}px) minmax(60px, 1fr) auto` }}>
          <span className="truncate">{i.label}</span>
          <span className="h-3 overflow-hidden rounded-r-md bg-secondary">
            <span className="block h-full rounded-r-md group-hover:brightness-110" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
          </span>
          <b className="text-right font-semibold tabular-nums">{format(i.value)}</b>
        </li>
      ))}
    </ul>
  );
}
