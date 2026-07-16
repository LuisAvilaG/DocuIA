"use client";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, PieChart, Pie, LabelList,
} from "recharts";

const INK = "var(--color-muted-foreground)";
const GRID = "var(--color-border)";
const PRIMARY = "var(--color-primary)";

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 11,
  color: "var(--color-foreground)",
  boxShadow: "0 8px 32px oklch(0.18 0.015 258 / 0.12)",
  padding: "6px 10px",
};
const axisTick = { fontSize: 10, fill: INK };

// ── Throughput over time (single series → no legend, title names it) ──
export function ThroughputArea({ data }: { data: Array<{ label: string; n: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="thr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.22} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={28} />
        <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: PRIMARY, strokeWidth: 1, strokeDasharray: "3 3" }} labelStyle={{ color: "var(--color-muted-foreground)" }} formatter={(v) => [`${v} caso(s)`, ""]} />
        <Area type="monotone" dataKey="n" stroke={PRIMARY} strokeWidth={2} fill="url(#thr)" dot={false} activeDot={{ r: 4, fill: PRIMARY, stroke: "var(--color-card)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Signer outcome (status palette, labels carry identity not color) ──
const TONE_COLOR: Record<string, string> = {
  ok: "var(--color-success)", warn: "var(--color-warning)", bad: "var(--color-destructive)",
};
export function SignerDonut({ data }: { data: Array<{ name: string; value: number; tone: "ok" | "warn" | "bad" }> }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">Sin validaciones todavía.</p>;
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={132} height={132}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="var(--color-card)" strokeWidth={2}>
            {data.map((d) => <Cell key={d.name} fill={TONE_COLOR[d.tone]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v}`, n]} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="space-y-1.5 flex-1 min-w-0">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONE_COLOR[d.tone] }} />
            <span className="text-muted-foreground truncate flex-1">{d.name}</span>
            <span className="text-foreground font-medium tabular-nums">{d.value}</span>
            <span className="text-muted-foreground tabular-nums w-9 text-right">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Cases per flow (magnitude across categories → single hue) ─────────
export function FlowBars({ data }: { data: Array<{ name: string; n: number }> }) {
  if (data.length === 0) return <p className="text-xs text-muted-foreground">Sin casos.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }} barCategoryGap={10}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} width={130} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} formatter={(v) => [`${v} caso(s)`, ""]} />
        <Bar dataKey="n" fill={PRIMARY} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: INK }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
