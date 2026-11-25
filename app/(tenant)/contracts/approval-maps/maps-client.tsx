"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search } from "lucide-react";
import { ActionLink, Drawer, EmptyState, Notice, PageFrame, PageHeader, SectionTitle, StatusPill, btn } from "@/components/kit";
import { cn } from "@/lib/utils";
import { ApprovalMapTabs } from "./tabs";
import { FlowChip, FlowPicker, type PickerScope } from "./flow-picker";

type NodeType = "start" | "question" | "sign" | "notify" | "end";

export interface MapRow {
  id: string;
  name: string;
  version: number;
  /** Publicado, pero el borrador ya no es igual. */
  unpublished: boolean;
  flowIds: string[];
  flowNames: string[];
  /** Lo que preguntan sus preguntas: «tipo de contrato», «valor del contrato»… */
  asks: string[];
  issue: { level: "error" | "warn"; message: string } | null;
  moreIssues: number;
  drawing: { nodes: { id: string; type: NodeType; x: number; y: number }[]; edges: { source: string; target: string }[] };
}

export interface FlowOption { id: string; name: string; isActive: boolean; mapId: string | null; mapName: string | null; /** Casos de los últimos 30 días. */ recentCases: number }

type Start = "single" | "flow" | "field" | "blank";

const OFFLINE = "No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.";

/** Envía JSON y devuelve el texto de error de la API, o uno en español si la respuesta no se pudo leer. */
async function send(url: string, method: string, body: unknown, fallback: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) return { ok: false, error: typeof data?.error === "string" && data.error ? data.error : fallback };
  return { ok: true, data: data ?? {} };
}

// ── Dibujo del mapa ───────────────────────────────────────────────────
// Tamaños aproximados de cada pieza en el lienzo del editor, para escalar el dibujo.
const SIZE: Record<NodeType, { w: number; h: number }> = {
  start: { w: 160, h: 44 }, end: { w: 160, h: 44 }, question: { w: 240, h: 64 }, sign: { w: 220, h: 56 }, notify: { w: 220, h: 56 },
};
const FILL: Record<NodeType, { fill: string; stroke: string }> = {
  start: { fill: "#0F2A4A", stroke: "#0F2A4A" },
  end: { fill: "#BFE3CF", stroke: "#8FC9A9" },
  question: { fill: "#F3DFAE", stroke: "#E0C27E" },
  sign: { fill: "#FFFFFF", stroke: "#0B5F56" },
  notify: { fill: "#FFFFFF", stroke: "#0B5F56" },
};

function MapDrawing({ drawing }: { drawing: MapRow["drawing"] }) {
  const W = 200, H = 110, PAD = 8;
  const { nodes, edges } = drawing;
  if (!nodes.length) return <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 rounded-md bg-secondary/40" />;
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + SIZE[n.type].w)), maxY = Math.max(...nodes.map((n) => n.y + SIZE[n.type].h));
  const scale = Math.min((W - PAD * 2) / Math.max(1, maxX - minX), (H - PAD * 2) / Math.max(1, maxY - minY), 0.4);
  const offX = (W - (maxX - minX) * scale) / 2, offY = (H - (maxY - minY) * scale) / 2;
  const box = new Map(nodes.map((n) => {
    const w = Math.max(10, SIZE[n.type].w * scale), h = Math.max(6, SIZE[n.type].h * scale);
    const cx = offX + (n.x - minX + SIZE[n.type].w / 2) * scale, cy = offY + (n.y - minY + SIZE[n.type].h / 2) * scale;
    return [n.id, { ...n, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy }];
  }));
  return (
    <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 rounded-md bg-secondary/40">
      {edges.map((e, i) => {
        const a = box.get(e.source), b = box.get(e.target);
        if (!a || !b) return null;
        return <line key={i} x1={a.cx} y1={a.y + a.h} x2={b.cx} y2={b.y} stroke="#B9B4A9" strokeWidth={1} />;
      })}
      {[...box.values()].map((n) => (
        <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.type === "start" || n.type === "end" ? n.h / 2 : 2.5}
          fill={FILL[n.type].fill} stroke={FILL[n.type].stroke} strokeWidth={1} />
      ))}
    </svg>
  );
}

// ── Pantalla ──────────────────────────────────────────────────────────
export function MapsClient({ maps, flows }: { maps: MapRow[]; flows: FlowOption[] }) {
  const [creating, setCreating] = useState(false);
  // Los desactivados no se muestran: no reciben casos.
  const unassigned = flows.filter((f) => f.isActive && !f.mapId)
    .sort((a, b) => b.recentCases - a.recentCases || a.name.localeCompare(b.name, "es"));
  const hiddenWithoutMap = flows.filter((f) => !f.isActive && !f.mapId).length;

  const newButton = (
    <button type="button" onClick={() => setCreating(true)} className={btn("primary")}><Plus /> Mapa nuevo</button>
  );

  return (
    <PageFrame>
      <PageHeader eyebrow="Contratos" title="Mapas de aprobación"
        description="Cada flujo usa un mapa para saber quién aprueba sus casos. Un mapa sirve para varios flujos."
        actions={maps.length ? newButton : undefined} />
      <ApprovalMapTabs active="maps" className="mt-6" />

      {maps.length === 0 ? (
        <EmptyState className="mt-5" title="Todavía no hay mapas" actions={newButton}>
          Un mapa dice quién firma cada caso: puede ser un solo rol o caminos distintos según el tipo de contrato o un dato del documento.
        </EmptyState>
      ) : (
        <ul className="mt-1" aria-label="Mapas">
          {maps.map((m) => (
            <li key={m.id} className="flex flex-col gap-4 border-b border-border py-5 sm:flex-row sm:items-start">
              <MapDrawing drawing={m.drawing} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{m.name}</h2>
                  {m.version > 0 ? <StatusPill tone="ok">Publicado · v{m.version}</StatusPill> : <StatusPill tone="mute">Borrador</StatusPill>}
                  {m.unpublished && <StatusPill tone="warn">Cambios sin publicar</StatusPill>}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {m.flowNames.length ? <>Lo usa{m.flowNames.length === 1 ? "" : "n"}: <span className="text-foreground">{m.flowNames.slice(0, 3).join(", ")}</span>{m.flowNames.length > 3 && ` y ${m.flowNames.length - 3} más`}</> : "Todavía no lo usa ningún flujo."}
                </p>
                {m.asks.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <span>Pregunta por:</span>
                    {m.asks.map((a) => <span key={a} className="rounded-full border border-border bg-card px-2 py-px text-foreground/85">{a}</span>)}
                  </p>
                )}
                {m.issue && (
                  <p className="text-[12.5px] text-tone-warn">
                    {m.issue.message}{m.moreIssues > 0 && <span className="text-muted-foreground"> y {m.moreIssues} más</span>}
                  </p>
                )}
              </div>
              <ActionLink href={`/contracts/approval-maps/${m.id}`} variant="secondary" size="sm" className="self-start" aria-label={`Abrir el mapa ${m.name}`}>Abrir</ActionLink>
            </li>
          ))}
        </ul>
      )}

      {unassigned.length > 0 && <FlowsWithoutMap flows={unassigned} hidden={hiddenWithoutMap} maps={maps} />}

      {creating && <NewMapDrawer flows={flows} onClose={() => setCreating(false)} />}
    </PageFrame>
  );
}

// ── Flujos sin mapa ───────────────────────────────────────────────────
const FIRST_ROWS = 8;

function FlowsWithoutMap({ flows, hidden, maps }: { flows: FlowOption[]; hidden: number; maps: MapRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [mapId, setMapId] = useState(maps[0]?.id ?? "");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLocaleLowerCase("es");
  const matching = needle ? flows.filter((f) => f.name.toLocaleLowerCase("es").includes(needle)) : flows;
  const shown = showAll || needle ? matching : matching.slice(0, FIRST_ROWS);
  const canAssign = maps.length > 0;
  const toggle = (id: string) => setPicked((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  async function assign() {
    const map = maps.find((m) => m.id === mapId);
    if (!map || !picked.length) return;
    setBusy(true); setError(null);
    const result = await send(`/api/v1/contracts/approval-maps/${map.id}/flows`, "PUT", { flowIds: [...new Set([...map.flowIds, ...picked])] }, "No se pudo asignar el mapa.");
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setPicked([]);
    router.refresh();
  }

  return (
    <section aria-labelledby="flows-without-map" className="mt-10">
      <SectionTitle title={<span id="flows-without-map">Flujos sin mapa</span>} aside={`${flows.length} flujo${flows.length === 1 ? "" : "s"} activo${flows.length === 1 ? "" : "s"}`} />
      <p className="mt-2.5 text-[13px] text-muted-foreground">
        Se siguen aprobando como hoy (la etapa Aprobación del flujo, o cualquier aprobador).
        {hidden > 0 && <> Los {hidden === 1 ? "flujos desactivados" : `${hidden} flujos desactivados`} no se muestran.</>}
      </p>

      {flows.length > FIRST_ROWS && (
        <label className="mt-3.5 flex min-h-[38px] w-full max-w-[320px] items-center gap-2 rounded-lg border border-[#D6D2C8] bg-white px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Buscar flujo</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar flujo" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
        </label>
      )}


      <ul className="mt-3 border-t border-border">
        {shown.map((f) => {
          const cases = f.recentCases === 0 ? "Sin casos en 30 días" : `${f.recentCases} caso${f.recentCases === 1 ? "" : "s"} en 30 días`;
          const row = (
            <>
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">{f.name}</span>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">{cases}</span>
            </>
          );
          return (
            <li key={f.id} className={cn("border-b border-line-soft", picked.includes(f.id) && "bg-tone-info-bg/50")}>
              {canAssign ? (
                <label className="flex min-h-[42px] cursor-pointer items-center gap-3 px-1 py-1.5">
                  <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} aria-label={`Elegir ${f.name}`} className="size-4 shrink-0 accent-[var(--color-primary)]" />
                  {row}
                </label>
              ) : <div className="flex min-h-[42px] items-center gap-3 px-1 py-1.5">{row}</div>}
            </li>
          );
        })}
        {needle && matching.length === 0 && <li className="py-3 text-[13px] text-muted-foreground">Ningún flujo sin mapa tiene «{query.trim()}».</li>}
      </ul>

      {!needle && matching.length > FIRST_ROWS && (
        <div className="mt-2.5 flex items-center justify-between gap-3 text-[13px]">
          <button type="button" onClick={() => setShowAll(!showAll)} className={btn("secondary", "sm")}>{showAll ? "Ver menos" : `Ver los ${matching.length}`}</button>
          {!showAll && <span className="text-muted-foreground">Mostrando {FIRST_ROWS} de {matching.length}</span>}
        </div>
      )}
      {!canAssign && <p className="mt-2.5 text-[13px] text-muted-foreground">Crea un mapa para asignárselo a estos flujos.</p>}
      {/* Abajo y fijo: al aparecer no mueve las filas que se están marcando. */}
      {canAssign && picked.length > 0 && (
        <div role="region" aria-label="Asignar los elegidos" className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-[10px] bg-[#0F2A4A] px-3.5 py-2.5 text-[13.5px] text-white shadow-[0_10px_28px_rgba(15,42,74,.25)]">
          <b className="font-semibold">{picked.length} elegido{picked.length === 1 ? "" : "s"}</b>
          <span className="text-white/80">Asignarles el mapa</span>
          <select aria-label="Mapa" value={mapId} onChange={(e) => setMapId(e.target.value)} disabled={busy}
            className="min-h-9 w-[260px] max-w-full rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px] text-foreground">
            {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" onClick={() => void assign()} disabled={busy}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#3DB8A8] px-3.5 text-[13px] font-semibold text-[#0F2A4A] hover:bg-[#52C4B5] disabled:opacity-60">
            {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}Asignar
          </button>
          <button type="button" onClick={() => setPicked([])} disabled={busy} className="px-1.5 text-[13px] font-semibold text-white/90 hover:text-white">Quitar selección</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-tone-err">{error}</p>}
    </section>
  );
}

// ── Mapa nuevo ────────────────────────────────────────────────────────
const STARTS: { key: Start; title: string; help: string }[] = [
  { key: "single", title: "Una sola firma", help: "Todos los casos los firma un rol. Lo más simple para empezar." },
  { key: "flow", title: "Según el tipo de contrato", help: "Una pregunta con un camino por cada tipo o flujo." },
  { key: "field", title: "Según un dato del documento", help: "Por ejemplo el valor o el plazo: más firmas cuanto más alto." },
  { key: "blank", title: "En blanco", help: "Dibujas todo desde cero." },
];

const inp = "w-full min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-[13.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

function NewMapDrawer({ flows, onClose }: { flows: FlowOption[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("single");
  const [flowIds, setFlowIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Escribe el nombre del mapa."); return; }
    setBusy(true); setError(null);
    const result = await send("/api/v1/contracts/approval-maps", "POST", { name: name.trim(), start, flowIds }, "No se pudo crear el mapa.");
    if (!result.ok) { setBusy(false); setError(result.error); return; }
    const id = typeof result.data.id === "string" ? result.data.id : null;
    if (!id) { setBusy(false); setError("Se creó el mapa, pero no se pudo abrir. Recarga la página."); return; }
    // Stays busy while the editor loads.
    router.push(`/contracts/approval-maps/${id}`);
  }

  const toggle = (id: string) => setFlowIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // Los desactivados no se ofrecen.
  const offered = flows.filter((f) => f.isActive);
  const hidden = flows.length - offered.length;
  const byId = new Map(flows.map((f) => [f.id, f]));
  const free = new Set(offered.filter((f) => !f.mapId).map((f) => f.id));
  const scopes: PickerScope[] = [
    { key: "free", label: `Sin mapa · ${free.size}`, ids: free },
    { key: "all", label: `Todos · ${offered.length}`, ids: null },
  ];

  return (
    <Drawer title="Mapa nuevo" description="Elige cómo empezar; después lo ajustas en el editor." onClose={onClose} locked={busy} width={540}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
        <button type="submit" form="new-map-form" disabled={busy} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />} Crear y abrir</button>
      </>}>
      <form id="new-map-form" onSubmit={submit} className="flex flex-col gap-5.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Nombre</span>
          <input required autoFocus maxLength={150} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: Contratos de obra" className={inp} />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-semibold">Punto de partida</legend>
          {STARTS.map((s) => (
            <label key={s.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
              start === s.key ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50")}>
              <input type="radio" name="map-start" value={s.key} checked={start === s.key} onChange={() => setStart(s.key)} className="mt-0.5" />
              <span><b className="font-semibold">{s.title}</b><span className="block text-xs text-muted-foreground">{s.help}</span></span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col">
          <legend className="mb-1.5 text-[13px] font-semibold">Para qué casos es este mapa</legend>
          <FlowPicker flows={offered.map((f) => ({ id: f.id, name: f.name, note: f.mapName ? `usa «${f.mapName}»` : null }))}
            selected={flowIds} onChange={setFlowIds} scopes={scopes}
            emptyText="Todavía no hay flujos activos. Puedes asignarlo después." />
          {flowIds.length > 0 && (
            <div aria-label="Flujos elegidos" className="mt-2.5 flex flex-wrap gap-1.5">
              {flowIds.map((id) => <FlowChip key={id} name={byId.get(id)?.name ?? "Flujo"} onRemove={() => toggle(id)} />)}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {hidden > 0 && <>Solo se muestran flujos activos (hay {hidden} desactivado{hidden === 1 ? "" : "s"}). </>}
            Un flujo usa un solo mapa: si marcas uno que ya tenía otro, pasa a este.
          </p>
        </fieldset>

        {error && <Notice tone="err" title={error} />}
      </form>
    </Drawer>
  );
}
