"use client";

// Editor del mapa de aprobaciones: paleta de piezas a la izquierda, el mapa
// dibujado al centro y el detalle de la pieza elegida a la derecha. Un caso
// entra por «Caso listo», las preguntas le abren caminos y cada firma es un
// paso que alguien de un rol (o una persona) aprueba, hasta «Aprobado».
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ReactFlow, Background, Controls, ReactFlowProvider, useReactFlow, useNodesState, useEdgesState,
  Handle, Position, MarkerType, type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, CircleHelp, FlaskConical, Loader2, Plus, Save, Trash2, User, Users, X } from "lucide-react";
import { btn, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  branchLabel, formatAmount, mapGraphSchema, questionLabel,
  type Branch, type MapGraph, type MapIssue, type MapNode, type QuestionSubject, type Who,
} from "@/lib/approval-map/engine";
import type { ApprovalEditorContext } from "@/lib/approval-map/admin";

type NodeType = MapNode["type"];
type AnyData = Record<string, unknown>;
type QuestionData = Extract<MapNode, { type: "question" }>["data"];
type FlowNode = Node<AnyData>;

const inp = "w-full min-h-9 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const lbl = "block text-[13px] font-semibold text-foreground";
const hlp = "block text-xs leading-relaxed text-muted-foreground";
const sectionTitle = "mb-2 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75";

// ── Lo que se ve dentro del lienzo ────────────────────────────────────
interface Display { label: string; sub?: string; branches?: Array<{ id: string; label: string }>; state?: "hit" | "dim"; badge?: number; issue?: boolean }
const DisplayContext = createContext<Map<string, Display>>(new Map());

const handleStyle = { width: 9, height: 9, background: "var(--color-primary)", border: "2px solid var(--color-card)" } as const;

function Box({ id, selected, className, children }: { id: string; selected: boolean; className: string; children: React.ReactNode }) {
  const d = useContext(DisplayContext).get(id);
  return (
    <div className={cn("relative rounded-[10px] border px-3 py-2 shadow-[0_1px_2px_rgba(30,32,41,.06)] transition-[opacity,box-shadow]", className,
      selected && "ring-4 ring-primary/15 border-primary border-2",
      d?.state === "hit" && "border-2 border-primary",
      d?.state === "dim" && "opacity-40",
      d?.issue && !selected && "border-tone-warn")}>
      {d?.badge !== undefined && <span className="absolute -right-2.5 -top-2.5 flex size-[22px] items-center justify-center rounded-full bg-primary text-[11.5px] font-bold text-primary-foreground">{d.badge}</span>}
      {children}
    </div>
  );
}

function StartNode({ id, selected }: NodeProps) {
  return (
    <Box id={id} selected={!!selected} className="w-[140px] border-[#0F2A4A] bg-[#0F2A4A] text-center">
      <b className="block text-[13px] font-semibold text-white">Caso listo</b>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </Box>
  );
}

function EndNode({ id, selected }: NodeProps) {
  return (
    <Box id={id} selected={!!selected} className="w-[140px] border-[#B8DCC9] bg-tone-ok-bg text-center">
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <b className="block text-[13px] font-semibold text-tone-ok">Aprobado</b>
    </Box>
  );
}

function QuestionNode({ id, selected }: NodeProps) {
  const d = useContext(DisplayContext).get(id);
  const branches = d?.branches ?? [];
  return (
    <Box id={id} selected={!!selected} className="min-w-[220px] max-w-[300px] border-[#E2C88E] bg-[#FFFBF2] pb-7">
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <small className="block truncate text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[#7A5606]">Pregunta · {d?.sub ?? ""}</small>
      <b className="block truncate text-[13px] font-semibold">{d?.label ?? "Pregunta"}</b>
      <div className="absolute inset-x-0 bottom-0 flex h-6">
        {branches.map((b, i) => {
          const left = `${((i + 0.5) / branches.length) * 100}%`;
          return (
            <span key={b.id} className="relative flex-1 truncate px-1 text-center text-[10.5px] font-semibold leading-6 text-[#5B4208]" title={b.label}>
              {b.label}
              <Handle id={b.id} type="source" position={Position.Bottom} style={{ ...handleStyle, left, background: "#B07C0E" }} />
            </span>
          );
        })}
      </div>
    </Box>
  );
}

function SignNode({ id, selected, data }: NodeProps) {
  const d = useContext(DisplayContext).get(id);
  const who = (data as AnyData).who as Who | null;
  return (
    <Box id={id} selected={!!selected} className="w-[190px] border-[#CFCAC0] bg-card">
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <small className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {who?.kind === "person" ? <User className="size-3" /> : <Users className="size-3" />}Firma · {who?.kind === "person" ? "persona" : "rol"}
      </small>
      <b className={cn("block truncate text-[13px] font-semibold", !who && "text-tone-warn")}>{d?.label ?? "Elige quién firma"}</b>
      {d?.sub && <span className="block truncate text-[11.5px] text-muted-foreground">{d.sub}</span>}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </Box>
  );
}

function NotifyNode({ id, selected }: NodeProps) {
  const d = useContext(DisplayContext).get(id);
  return (
    <Box id={id} selected={!!selected} className="w-[190px] border-dashed border-[#BDB8AE] bg-[#F6F4F0]">
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <small className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"><Bell className="size-3" />Aviso</small>
      <b className="block truncate text-[13px] font-semibold">{d?.label ?? "Elige a quién avisar"}</b>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </Box>
  );
}

const nodeTypes = { start: StartNode, end: EndNode, question: QuestionNode, sign: SignNode, notify: NotifyNode };

// ── Piezas de la paleta ───────────────────────────────────────────────
type PieceKey = "question" | "role" | "person" | "notify" | "end";
const PIECES: Array<{ key: PieceKey; title: string; hint: string; Icon: typeof CircleHelp; tone: string }> = [
  { key: "question", title: "Pregunta", hint: "Abre caminos según un dato", Icon: CircleHelp, tone: "bg-[#FBF1DC] text-[#7A5606]" },
  { key: "role", title: "Firma de un rol", hint: "Jurídica, Gerencia…", Icon: Users, tone: "bg-tone-info-bg text-tone-info" },
  { key: "person", title: "Firma de una persona", hint: "Alguien en particular", Icon: User, tone: "bg-[#EAE7F6] text-[#4B3F8F]" },
  { key: "notify", title: "Aviso", hint: "Informa sin pedir firma", Icon: Bell, tone: "bg-secondary text-foreground/75" },
  { key: "end", title: "Aprobado", hint: "Fin del camino", Icon: CheckCircle2, tone: "bg-tone-ok-bg text-tone-ok" },
];

const rid = () => crypto.randomUUID().slice(0, 8);

/** El mapa tal como se guarda, desde lo que hay en el lienzo. */
function toGraph(nodes: FlowNode[], edges: Edge[], settings: MapGraph["settings"]): MapGraph {
  return {
    nodes: nodes.map((n) => {
      const { _kind, ...data } = n.data as AnyData;
      void _kind;
      return { id: n.id, type: n.type as NodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data } as MapNode;
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
    settings,
  };
}

/** Misma forma y mismo orden de claves, para comparar dos versiones del mapa. */
function canonical(graph: unknown): unknown {
  const parsed = mapGraphSchema.safeParse(graph);
  return parsed.success ? parsed.data : graph;
}

function newNode(key: PieceKey, position: { x: number; y: number }): FlowNode {
  const id = `${key === "question" ? "q" : key === "end" ? "end" : key === "notify" ? "n" : "s"}-${rid()}`;
  if (key === "question") {
    const data: QuestionData = { label: "", subject: { kind: "field", docType: "", field: "", mode: "number" }, branches: [{ id: `b-${rid()}`, label: "", op: "lte", value: 0 }, { id: `b-${rid()}`, label: "", op: "gt", value: 0 }], missing: "first" };
    return { id, type: "question", position, data: data as unknown as AnyData };
  }
  if (key === "end") return { id, type: "end", position, data: {} };
  if (key === "notify") return { id, type: "notify", position, data: { who: null } };
  return { id, type: "sign", position, data: { who: null, _kind: key } };
}

// ── Subject helpers ───────────────────────────────────────────────────
type SubjectChoice = "flow" | "number" | "text" | "analysis";
const SUBJECTS: Array<{ key: SubjectChoice; title: string; hint: string }> = [
  { key: "flow", title: "Tipo de contrato o flujo", hint: "Obra, consultoría, pólizas…" },
  { key: "number", title: "Un monto o número del documento", hint: "El valor del contrato, el plazo en meses…" },
  { key: "text", title: "Área, proyecto o empresa", hint: "Un texto que se lee del documento" },
  { key: "analysis", title: "Lo que encontró el análisis", hint: "Hallazgos graves o advertencias" },
];
const subjectChoice = (s: QuestionSubject): SubjectChoice => s.kind === "field" ? s.mode : s.kind;
const SUBJECT_SHORT: Record<SubjectChoice, string> = { flow: "tipo", number: "dato", text: "texto", analysis: "análisis" };

/** Caminos nuevos para otro tipo de pregunta, con los mismos ids: las líneas siguen saliendo de ellos. */
function branchesFor(choice: SubjectChoice, previous: Branch[]): Branch[] {
  const ids = previous.map((b) => b.id);
  while (ids.length < 2) ids.push(`b-${rid()}`);
  if (choice === "flow") return ids.map((id, i) => i === ids.length - 1 ? { id, label: "", otherwise: true } : { id, label: "", flowIds: [] });
  if (choice === "analysis") return ids.slice(0, 3).map((id, i) => ({ id, label: "", level: (["block", "warn", "ok"] as const)[i] }));
  if (choice === "number") return ids.map((id, i) => ({ id, label: "", op: i === 0 ? "lte" as const : "gt" as const, value: 0 }));
  return ids.map((id, i) => i === ids.length - 1 ? { id, label: "", otherwise: true } : { id, label: "", op: "eq" as const, value: "" });
}

// ── El editor ─────────────────────────────────────────────────────────
interface TestStep { key: string; kind: "sign" | "notify" | "wait"; label: string; names: string[]; note: string | null; reason: string | null }
interface TestResult { steps: TestStep[]; answers: Array<{ nodeId: string; question: string; answer: string }>; problem: string | null; visited: string[] }

export function ApprovalMapEditorClient({ mapId }: { mapId: string }) {
  return <ReactFlowProvider><Editor mapId={mapId} /></ReactFlowProvider>;
}

function Editor({ mapId }: { mapId: string }) {
  const router = useRouter();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ctx, setCtx] = useState<ApprovalEditorContext | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0);
  const [published, setPublished] = useState<string | null>(null);
  const [settings, setSettings] = useState<MapGraph["settings"]>({ remindDays: 2, escalateDays: 4 });
  const [issues, setIssues] = useState<MapIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  // Lo último guardado, para saber si hay cambios sin guardar.
  const [saved, setSaved] = useState("");

  const currentGraph = useCallback(() => toGraph(nodes, edges, settings), [nodes, edges, settings]);
  const snapshot = JSON.stringify({ name, graph: canonical(currentGraph()) });
  const dirty = !loading && !loadError && snapshot !== saved;

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/contracts/approval-maps/${mapId}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.map?.draft) throw new Error(typeof d.error === "string" ? d.error : "No se pudo abrir el mapa.");
        if (!alive) return;
        const graph = d.map.draft as MapGraph;
        setCtx(d.context);
        setName(d.map.name);
        setVersion(d.map.version);
        setPublished(d.map.published ? JSON.stringify(canonical(d.map.published)) : null);
        setSettings(graph.settings);
        setIssues(d.issues ?? []);
        const rfNodes: FlowNode[] = graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as AnyData, deletable: n.type !== "start" }));
        const rfEdges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined }));
        setNodes(rfNodes);
        setEdges(rfEdges);
        setSaved(JSON.stringify({ name: d.map.name, graph: canonical(toGraph(rfNodes, rfEdges, graph.settings)) }));
      })
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : "No se pudo abrir el mapa."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [mapId, setNodes, setEdges]);

  // Salir con cambios sin guardar avisa antes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const flowNames = useMemo(() => new Map((ctx?.flows ?? []).map((f) => [f.id, f.name])), [ctx]);
  const roleById = useMemo(() => new Map((ctx?.roles ?? []).map((r) => [r.id, r])), [ctx]);
  const personById = useMemo(() => new Map((ctx?.people ?? []).map((p) => [p.id, p])), [ctx]);
  const docName = useCallback((key: string) => ctx?.docTypes.find((d) => d.key === key)?.name ?? key, [ctx]);
  const fieldName = useCallback((doc: string, field: string) => ctx?.docTypes.find((d) => d.key === doc)?.fields.find((f) => f.key === field)?.label ?? field, [ctx]);

  const whoText = useCallback((who: Who | null): { label: string; sub?: string } => {
    if (!who) return { label: "Elige quién" };
    if (who.kind === "person") return { label: personById.get(who.userId)?.name ?? "Persona eliminada" };
    const role = roleById.get(who.roleId);
    if (!role) return { label: "Rol eliminado" };
    const people = role.memberIds.map((id) => personById.get(id)?.name).filter(Boolean);
    return { label: role.name, sub: people.length ? people.join(" o ") : "Sin personas" };
  }, [personById, roleById]);

  const display = useMemo(() => {
    const map = new Map<string, Display>();
    const issueNodes = new Set(issues.map((i) => i.nodeId).filter(Boolean) as string[]);
    const visited = test ? new Set(test.visited.concat(nodes.filter((n) => n.type === "start" || n.type === "end").map((n) => n.id))) : null;
    const signOrder = test ? test.steps.filter((s) => s.kind === "sign").map((s) => s.key) : [];
    for (const n of nodes) {
      const data = n.data as AnyData;
      let entry: Display = { label: "" };
      if (n.type === "question") {
        const q = data as unknown as QuestionData;
        const subject = q.subject.kind === "field" ? { ...q.subject, field: fieldName(q.subject.docType, q.subject.field) } : q.subject;
        entry = { label: questionLabel({ ...q, subject }), sub: SUBJECT_SHORT[subjectChoice(q.subject)], branches: q.branches.map((b) => ({ id: b.id, label: branchLabel(b, q.subject, flowNames) })) };
      } else if (n.type === "sign" || n.type === "notify") {
        entry = whoText((data.who ?? null) as Who | null);
      }
      if (visited) entry.state = visited.has(n.id) ? "hit" : "dim";
      const order = signOrder.indexOf(n.id);
      if (order >= 0) entry.badge = order + 1;
      entry.issue = issueNodes.has(n.id);
      map.set(n.id, entry);
    }
    return map;
  }, [nodes, issues, test, flowNames, whoText, fieldName]);

  const displayEdges = useMemo(() => edges.map((e) => {
    const source = nodes.find((n) => n.id === e.source);
    let label: string | undefined;
    if (source?.type === "question" && e.sourceHandle) {
      const q = source.data as unknown as QuestionData;
      const branch = q.branches.find((b) => b.id === e.sourceHandle);
      if (branch) label = branchLabel(branch, q.subject, flowNames);
    }
    const hit = test && test.visited.includes(e.source) && (test.visited.includes(e.target) || nodes.find((n) => n.id === e.target)?.type === "end")
      && (source?.type !== "question" || test.answers.some((a) => a.nodeId === e.source && label && a.answer.startsWith(label)));
    return {
      ...e, label,
      selected: e.id === selectedEdge,
      style: { stroke: hit ? "#0E7C70" : e.id === selectedEdge ? "#0B6E64" : "#A9A49A", strokeWidth: hit ? 3 : 1.6, opacity: test && !hit ? 0.4 : 1 },
      labelStyle: { fontSize: 11.5, fontWeight: 600, fill: "#4A4E5C" },
      labelBgStyle: { fill: "#FDFCFA" }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 999,
    };
  }), [edges, nodes, flowNames, test, selectedEdge]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const source = nodes.find((n) => n.id === c.source);
    const target = nodes.find((n) => n.id === c.target);
    if (!source || !target || source.type === "end" || target.type === "start") return;
    if (source.type === "question" && !c.sourceHandle) return;
    // Cada camino (o cada firma) sigue hacia una sola pieza: la línea nueva reemplaza a la anterior.
    setEdges((es) => [
      ...es.filter((e) => !(e.source === c.source && (source.type !== "question" || e.sourceHandle === c.sourceHandle))),
      { id: `e-${rid()}`, source: c.source!, target: c.target!, sourceHandle: c.sourceHandle ?? undefined },
    ]);
    setTest(null);
  }, [nodes, setEdges]);

  const addPiece = (key: PieceKey, at?: { x: number; y: number }) => {
    const position = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node = newNode(key, position);
    if (key === "person") node.data = { who: null, _kind: "person" };
    setNodes((ns) => [...ns, node]);
    setSelectedId(node.id);
    setSelectedEdge(null);
    setTest(null);
  };

  const patchNode = (id: string, patch: AnyData) => {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
    setTest(null);
  };
  const removeNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
    setTest(null);
  };

  async function save(): Promise<boolean> {
    setBusy("save"); setMsg(null);
    try {
      const graph = currentGraph();
      const res = await fetch(`/api/v1/contracts/approval-maps/${mapId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, draft: graph }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: d.error ?? "No se pudo guardar." }); return false; }
      setSaved(JSON.stringify({ name, graph: canonical(graph) }));
      setIssues(d.issues ?? []);
      setMsg({ ok: true, text: "Borrador guardado" });
      return true;
    } catch { setMsg({ ok: false, text: "Sin conexión" }); return false; }
    finally { setBusy(null); }
  }

  async function publish() {
    if (!await save()) return;
    setBusy("publish");
    try {
      const res = await fetch(`/api/v1/contracts/approval-maps/${mapId}/publish`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (Array.isArray(d.issues)) setIssues(d.issues);
      if (!res.ok) { setMsg({ ok: false, text: d.error ?? "No se pudo publicar." }); setSelectedId(null); return; }
      setVersion(d.version);
      setPublished(JSON.stringify(canonical(currentGraph())));
      setMsg({ ok: true, text: `Publicada la versión ${d.version}: la reciben los casos que terminen de analizarse desde ahora.` });
    } catch { setMsg({ ok: false, text: "Sin conexión" }); }
    finally { setBusy(null); }
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const changedSincePublish = published !== null && published !== JSON.stringify(canonical(currentGraph()));

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (loadError || !ctx) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p role="alert" className="text-sm text-tone-err">{loadError ?? "No se pudo abrir el mapa."}</p>
      <Link href="/contracts/approval-maps" className={btn("secondary")}>Volver a Mapas de aprobación</Link>
    </div>
  );

  const errors = issues.filter((i) => i.level === "error").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <Link href="/contracts/approval-maps" onClick={(e) => { if (dirty && !window.confirm("Hay cambios sin guardar. ¿Salir de todas formas?")) e.preventDefault(); }}
          className="inline-flex items-center gap-1.5 text-[13px] text-link hover:underline"><ArrowLeft className="size-4" />Mapas de aprobación</Link>
        <span aria-hidden className="h-6 w-px bg-border" />
        <label className="min-w-0">
          <span className="sr-only">Nombre del mapa</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150}
            className="min-w-[260px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[17px] font-semibold tracking-[-0.01em] outline-none hover:border-border focus:border-primary" />
        </label>
        {version > 0 ? <StatusPill tone="ok">Publicado · v{version}</StatusPill> : <StatusPill tone="mute">Sin publicar</StatusPill>}
        {(dirty || changedSincePublish) && <StatusPill tone="warn">{dirty ? "Cambios sin guardar" : "Cambios sin publicar"}</StatusPill>}
        <span className="flex-1" />
        {msg && <span role="status" className={cn("max-w-[420px] text-[13px]", msg.ok ? "text-tone-ok" : "text-tone-err")}>{msg.text}</span>}
        {testing ? (
          <button type="button" onClick={() => { setTesting(false); setTest(null); }} className={btn("secondary")}>Salir de la prueba</button>
        ) : (
          <>
            <button type="button" onClick={() => { setTesting(true); setSelectedId(null); setSelectedEdge(null); }} className={btn("secondary")}><FlaskConical />Probar con un caso</button>
            <button type="button" onClick={() => void save()} disabled={busy !== null} className={btn("secondary")}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}Guardar borrador</button>
            <button type="button" onClick={() => void publish()} disabled={busy !== null} className={btn("primary")}>{busy === "publish" && <Loader2 className="animate-spin" />}Publicar v{version + 1}</button>
          </>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_400px]">
        <aside aria-label="Piezas del mapa" className={cn("flex min-h-0 flex-col gap-1 overflow-y-auto border-b border-border bg-card p-3 lg:border-b-0 lg:border-r", testing && "pointer-events-none opacity-50")}>
          <h2 className="px-1.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/75">Agregar</h2>
          {PIECES.map((p) => (
            <button key={p.key} type="button" onClick={() => addPiece(p.key)} draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/approvalpiece", p.key); e.dataTransfer.effectAllowed = "copy"; }}
              className="flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-transparent p-2 text-left hover:border-border hover:bg-background active:cursor-grabbing">
              <span className={cn("mt-px flex size-7 shrink-0 items-center justify-center rounded-md", p.tone)}><p.Icon className="size-4" /></span>
              <span className="min-w-0"><b className="block text-[13px] font-semibold leading-snug">{p.title}</b><span className="block text-xs leading-snug text-muted-foreground">{p.hint}</span></span>
            </button>
          ))}
          <div className="mt-4 border-t border-line-soft pt-3">
            <h2 className="px-1.5 pb-1 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/75">Roles</h2>
            {ctx.roles.length === 0 && <p className="px-1.5 text-xs text-muted-foreground">Todavía no hay roles.</p>}
            {ctx.roles.map((r) => {
              const lonely = r.memberIds.length <= 1 && !r.substituteId;
              return (
                <div key={r.id} className="flex items-baseline justify-between gap-2 px-1.5 py-1 text-[13px]">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className={cn("shrink-0 text-xs", lonely ? "text-tone-warn" : "text-muted-foreground")}>{lonely ? "sin suplente" : `${r.memberIds.length} persona${r.memberIds.length === 1 ? "" : "s"}`}</span>
                </div>
              );
            })}
            <Link href="/contracts/approval-maps/roles" className="mt-1 block px-1.5 text-[13px] font-semibold text-link hover:underline">Administrar roles →</Link>
          </div>
        </aside>

        <div className="relative h-full min-h-[520px] bg-background"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={(e) => {
            e.preventDefault();
            const key = e.dataTransfer.getData("application/approvalpiece") as PieceKey;
            if (PIECES.some((p) => p.key === key)) addPiece(key, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}>
          <DisplayContext.Provider value={display}>
            <ReactFlow
              nodes={nodes} edges={displayEdges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              onNodeClick={(_, n) => { if (!testing) { setSelectedId(n.id); setSelectedEdge(null); } }}
              onEdgeClick={(_, e) => { if (!testing) { setSelectedEdge(e.id); setSelectedId(null); } }}
              onPaneClick={() => { setSelectedId(null); setSelectedEdge(null); }}
              nodesDraggable={!testing} nodesConnectable={!testing}
              deleteKeyCode={null}
              defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#A9A49A" } }}
              fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}
              style={{ minHeight: 520 }}
              ariaLabelConfig={{ "node.a11yDescription.default": "Pieza del mapa. Pulsa Enter para elegirla.", "edge.a11yDescription.default": "Línea del mapa.", "controls.zoomIn.ariaLabel": "Acercar", "controls.zoomOut.ariaLabel": "Alejar", "controls.fitView.ariaLabel": "Ver todo el mapa" }}
            >
              <Background gap={18} size={1} color="var(--color-border)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </DisplayContext.Provider>
          <p className="pointer-events-none absolute bottom-3 left-4 rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground">
            {testing ? "En verde, el camino de este caso. Lo atenuado no aplica." : "Arrastra una pieza desde la izquierda. Une el punto de abajo de una pieza con el de arriba de la siguiente."}
          </p>
        </div>

        <aside aria-label="Detalle" className="flex min-h-0 flex-col overflow-y-auto border-t border-border bg-card lg:border-l lg:border-t-0">
          {testing ? (
            <TestPanel mapId={mapId} ctx={ctx} graph={currentGraph()} docName={docName} fieldName={fieldName} onResult={setTest} result={test} />
          ) : selected ? (
            <NodePanel key={selected.id} node={selected} ctx={ctx} edges={edges} nodes={nodes} flowNames={flowNames} whoText={whoText}
              fieldName={fieldName}
              patch={(p) => patchNode(selected.id, p)} remove={() => removeNode(selected.id)} close={() => setSelectedId(null)} />
          ) : selectedEdge ? (
            <div className="flex flex-col gap-3 p-5">
              <h2 className="text-[17px] font-semibold">Línea</h2>
              <p className="text-[13px] text-muted-foreground">Une dos piezas del camino. Para cambiar a dónde va, arrastra una nueva desde el mismo punto: reemplaza a esta.</p>
              <button type="button" className={btn("danger", "sm", "self-start")} onClick={() => { setEdges((es) => es.filter((e) => e.id !== selectedEdge)); setSelectedEdge(null); }}><Trash2 />Quitar línea</button>
            </div>
          ) : (
            <MapPanel mapId={mapId} ctx={ctx} issues={issues} errors={errors} settings={settings} setSettings={setSettings}
              onPick={(id) => { setSelectedId(id); setSelectedEdge(null); }}
              onFlowsChanged={(flows) => setCtx({ ...ctx, flows })}
              onDeleted={() => { setSaved(snapshot); router.push("/contracts/approval-maps"); }} />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Panel: el mapa (nada elegido) ─────────────────────────────────────
function MapPanel({ mapId, ctx, issues, errors, settings, setSettings, onPick, onFlowsChanged, onDeleted }: {
  mapId: string; ctx: ApprovalEditorContext; issues: MapIssue[]; errors: number;
  settings: MapGraph["settings"]; setSettings: (s: MapGraph["settings"]) => void;
  onPick: (nodeId: string) => void; onFlowsChanged: (flows: ApprovalEditorContext["flows"]) => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = ctx.flows.filter((f) => f.approvalMapId === mapId).map((f) => f.id);

  async function toggleFlow(id: string, on: boolean) {
    const next = on ? [...mine, id] : mine.filter((x) => x !== id);
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/contracts/approval-maps/${mapId}/flows`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flowIds: next }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo cambiar."); return; }
      onFlowsChanged(ctx.flows.map((f) => f.id === id ? { ...f, approvalMapId: on ? mapId : null } : f));
    } catch { setError("Sin conexión"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("¿Borrar este mapa? Los flujos que lo usan vuelven a aprobarse como antes. Los casos que ya empezaron con él no cambian.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/contracts/approval-maps/${mapId}`, { method: "DELETE" });
      if (res.ok) onDeleted();
      else setError((await res.json().catch(() => ({}))).error ?? "No se pudo borrar.");
    } catch { setError("Sin conexión"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">El mapa</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Toca una pieza para configurarla. Un caso entra por «Caso listo», cada pregunta le abre caminos y cada firma es un paso, en orden, hasta «Aprobado».</p>
      </div>

      <section>
        <span className={sectionTitle}>Revisión del mapa</span>
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-[13.5px] text-tone-ok"><CheckCircle2 className="size-4" />Todos los caminos llegan a «Aprobado» y cada firma tiene quién la haga.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {issues.map((issue, i) => (
              <li key={i}>
                <button type="button" disabled={!issue.nodeId} onClick={() => issue.nodeId && onPick(issue.nodeId)}
                  className={cn("flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-[13px]", issue.level === "error" ? "bg-tone-err-bg text-tone-err" : "bg-tone-warn-bg text-[#5B4208]", issue.nodeId && "hover:underline")}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />{issue.message}
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors > 0 && <p className={cn(hlp, "mt-2")}>Lo marcado en rojo impide publicar. Guarda el borrador para volver a revisar.</p>}
      </section>

      <section>
        <span className={sectionTitle}>Lo usan</span>
        <div className="flex flex-col gap-2">
          {ctx.flows.length === 0 && <p className={hlp}>Todavía no hay flujos.</p>}
          {ctx.flows.map((f) => {
            const other = f.approvalMapId && f.approvalMapId !== mapId;
            return (
              <label key={f.id} className="flex items-start gap-2.5 text-[13.5px]">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={f.approvalMapId === mapId} disabled={busy} onChange={(e) => void toggleFlow(f.id, e.target.checked)} />
                <span>{f.name}{other && <span className="block text-xs text-muted-foreground">Usa otro mapa: marcarlo lo pasa a este.</span>}{!f.isActive && <span className="block text-xs text-muted-foreground">Flujo desactivado.</span>}</span>
              </label>
            );
          })}
        </div>
        <p className={cn(hlp, "mt-2")}>Los casos de estos flujos se aprueban con la última versión publicada del mapa. Sin publicar, siguen como antes.</p>
      </section>

      <section>
        <span className={sectionTitle}>Si nadie firma a tiempo</span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className={lbl}>Recordar a los</span>
            <span className="flex items-center gap-2"><input type="number" min={0} max={30} className={cn(inp, "w-20 tabular-nums")} value={settings.remindDays} onChange={(e) => setSettings({ ...settings, remindDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} /><span className="text-[13px]">días hábiles</span></span>
          </label>
          <label className="flex flex-col gap-1"><span className={lbl}>Que firme el suplente a los</span>
            <span className="flex items-center gap-2"><input type="number" min={0} max={60} className={cn(inp, "w-20 tabular-nums")} value={settings.escalateDays} onChange={(e) => setSettings({ ...settings, escalateDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} /><span className="text-[13px]">días hábiles</span></span>
          </label>
        </div>
        <p className={cn(hlp, "mt-2")}>0 = nunca. El suplente de cada rol se define en Roles y personas.</p>
      </section>

      {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
      <div className="border-t border-line-soft pt-4">
        <button type="button" onClick={() => void remove()} disabled={busy} className={btn("danger", "sm")}><Trash2 />Borrar mapa</button>
      </div>
    </div>
  );
}

// ── Panel: una pieza elegida ──────────────────────────────────────────
function NodePanel({ node, ctx, nodes, edges, flowNames, whoText, fieldName, patch, remove, close }: {
  node: FlowNode; ctx: ApprovalEditorContext; nodes: FlowNode[]; edges: Edge[]; flowNames: Map<string, string>;
  whoText: (who: Who | null) => { label: string; sub?: string };
  fieldName: (doc: string, field: string) => string;
  patch: (p: AnyData) => void; remove: () => void; close: () => void;
}) {
  const data = node.data as AnyData;
  const title = node.type === "question" ? "Pregunta" : node.type === "sign" ? "Firma" : node.type === "notify" ? "Aviso" : node.type === "start" ? "Caso listo" : "Aprobado";
  const qLabel = (q: QuestionData) => questionLabel(q.subject.kind === "field" ? { ...q, subject: { ...q.subject, field: fieldName(q.subject.docType, q.subject.field) } } : q);
  const heading = node.type === "question" ? qLabel(data as unknown as QuestionData) : node.type === "sign" || node.type === "notify" ? whoText((data.who ?? null) as Who | null).label : title;
  const targetLabel = (handle?: string) => {
    const edge = edges.find((e) => e.source === node.id && (handle === undefined || e.sourceHandle === handle));
    const target = edge ? nodes.find((n) => n.id === edge.target) : null;
    if (!target) return null;
    if (target.type === "end") return "Aprobado";
    if (target.type === "question") return qLabel(target.data as unknown as QuestionData);
    return whoText(((target.data as AnyData).who ?? null) as Who | null).label;
  };
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 pb-3.5 pt-4">
        <div className="min-w-0">
          <p className="text-[12.5px] text-muted-foreground">{title}</p>
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{heading}</h2>
        </div>
        <button type="button" onClick={close} aria-label="Cerrar el detalle" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-foreground/70 hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-5 p-5">
        {node.type === "start" && <p className="text-[13.5px] text-muted-foreground">Todo caso de los flujos que usan este mapa entra por aquí cuando termina su análisis. Une su punto de abajo con la primera pregunta o firma.</p>}
        {node.type === "end" && <p className="text-[13.5px] text-muted-foreground">El caso queda aprobado al llegar aquí con todas las firmas del camino. Puede haber varios «Aprobado».</p>}
        {node.type === "question" && <QuestionForm data={data as unknown as QuestionData} patch={patch} ctx={ctx} flowNames={flowNames} fieldName={fieldName} targetLabel={targetLabel} />}
        {(node.type === "sign" || node.type === "notify") && <WhoForm kind={node.type} data={data} patch={patch} ctx={ctx} next={targetLabel()} />}
        {node.type !== "start" && (
          <div className="border-t border-line-soft pt-4">
            <button type="button" onClick={remove} className={btn("danger", "sm")}><Trash2 />Quitar esta pieza</button>
          </div>
        )}
      </div>
    </>
  );
}

function QuestionForm({ data, patch, ctx, flowNames, fieldName, targetLabel }: {
  data: QuestionData; patch: (p: AnyData) => void; ctx: ApprovalEditorContext; flowNames: Map<string, string>;
  fieldName: (doc: string, field: string) => string; targetLabel: (handle?: string) => string | null;
}) {
  const choice = subjectChoice(data.subject);
  const setBranches = (branches: Branch[]) => patch({ branches });
  const setBranch = (id: string, p: Partial<Branch>) => setBranches(data.branches.map((b) => b.id === id ? { ...b, ...p } : b));
  const field = data.subject.kind === "field" ? data.subject : null;
  const doc = field ? ctx.docTypes.find((d) => d.key === field.docType) : undefined;
  const hasOtherwise = data.branches.some((b) => b.otherwise);

  const choose = (next: SubjectChoice) => {
    if (next === choice) return;
    const subject: QuestionSubject = next === "flow" ? { kind: "flow" } : next === "analysis" ? { kind: "analysis" }
      : { kind: "field", docType: field?.docType ?? "", field: field?.field ?? "", mode: next };
    patch({ subject, branches: branchesFor(next, data.branches) });
  };

  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={sectionTitle}>¿Sobre qué es la pregunta?</legend>
        {SUBJECTS.map((s) => (
          <label key={s.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-[13.5px]", choice === s.key ? "border-primary ring-2 ring-primary/10" : "border-border")}>
            <input type="radio" name="subject" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={choice === s.key} onChange={() => choose(s.key)} />
            <span><b className="font-semibold">{s.title}</b><span className="block text-[12.5px] text-muted-foreground">{s.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {field && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1"><span className={lbl}>Documento</span>
            <select className={inp} value={field.docType} onChange={(e) => patch({ subject: { ...field, docType: e.target.value, field: "" } })}>
              <option value="">Elegir…</option>
              {ctx.docTypes.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={lbl}>Dato</span>
            <select className={inp} value={field.field} disabled={!doc} onChange={(e) => patch({ subject: { ...field, field: e.target.value } })}>
              <option value="">Elegir…</option>
              {(doc?.fields ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          {ctx.docTypes.length === 0 && <p className={cn(hlp, "col-span-2")}>Los documentos y sus datos salen de los flujos. Crea primero un flujo con su extracción.</p>}
        </div>
      )}

      <label className="flex flex-col gap-1"><span className={lbl}>Nombre de la pregunta <span className="font-normal text-muted-foreground">(opcional)</span></span>
        <input className={inp} value={data.label} maxLength={150} placeholder={questionLabel({ ...data, label: "", subject: field ? { ...field, field: fieldName(field.docType, field.field) } : data.subject })} onChange={(e) => patch({ label: e.target.value })} />
      </label>

      <div>
        <span className={sectionTitle}>Caminos</span>
        <div className="flex flex-col gap-2">
          {data.branches.map((b, i) => {
            const next = targetLabel(b.id);
            return (
              <div key={b.id} className="rounded-[10px] border border-border bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <b className="text-[13px] font-semibold">{b.otherwise ? "En otro caso" : `Camino ${i + 1}`}</b>
                  {data.branches.length > 2 && <button type="button" aria-label={`Quitar el camino ${i + 1}`} onClick={() => setBranches(data.branches.filter((x) => x.id !== b.id))} className="text-muted-foreground hover:text-tone-err"><Trash2 className="size-4" /></button>}
                </div>
                {!b.otherwise && choice === "flow" && (
                  <div className="flex flex-wrap gap-1.5">
                    {ctx.flows.map((f) => {
                      const on = (b.flowIds ?? []).includes(f.id);
                      return <button key={f.id} type="button" aria-pressed={on} onClick={() => setBranch(b.id, { flowIds: on ? (b.flowIds ?? []).filter((x) => x !== f.id) : [...(b.flowIds ?? []), f.id] })}
                        className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-tone-info-bg font-semibold text-tone-info" : "border-[#D6D2C8] bg-white text-foreground/75")}>{f.name}</button>;
                    })}
                  </div>
                )}
                {!b.otherwise && choice === "number" && (
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <select aria-label="Comparación" className={inp} value={b.op ?? "lte"} onChange={(e) => setBranch(b.id, { op: e.target.value as Branch["op"] })}>
                      <option value="lte">hasta</option><option value="lt">menos de</option><option value="gt">más de</option><option value="gte">desde</option>
                    </select>
                    <input aria-label="Monto" type="number" inputMode="decimal" className={cn(inp, "tabular-nums")} value={typeof b.value === "number" ? b.value : ""} onChange={(e) => setBranch(b.id, { value: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    {typeof b.value === "number" && <span className={cn(hlp, "col-span-2")}>{formatAmount(b.value)}</span>}
                  </div>
                )}
                {!b.otherwise && choice === "text" && (
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <select aria-label="Comparación" className={inp} value={b.op ?? "eq"} onChange={(e) => setBranch(b.id, { op: e.target.value as Branch["op"] })}>
                      <option value="eq">es</option><option value="contains">contiene</option>
                    </select>
                    <input aria-label="Texto" className={inp} value={typeof b.value === "string" ? b.value : ""} maxLength={200} onChange={(e) => setBranch(b.id, { value: e.target.value })} />
                  </div>
                )}
                {!b.otherwise && choice === "analysis" && (
                  <select aria-label="Lo que encontró" className={inp} value={b.level ?? ""} onChange={(e) => setBranch(b.id, { level: (e.target.value || undefined) as Branch["level"] })}>
                    <option value="">Elegir…</option><option value="block">Algo grave (un bloqueo)</option><option value="warn">Solo advertencias</option><option value="ok">Nada</option>
                  </select>
                )}
                {b.otherwise && <p className={hlp}>{choice === "flow" ? "Los flujos que no están en otro camino." : "Todo lo que no entra en los demás caminos."}</p>}
                <p className={cn("mt-2 text-[12.5px]", next ? "text-muted-foreground" : "text-tone-warn")}>{next ? <>Sigue a <b className="font-semibold text-foreground">{next}</b></> : "Sin unir: arrastra desde su punto en el lienzo."}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {data.branches.length < 12 && (
            <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-link hover:underline"
              onClick={() => {
                const fresh: Branch = choice === "flow" ? { id: `b-${rid()}`, label: "", flowIds: [] } : choice === "analysis" ? { id: `b-${rid()}`, label: "" } : choice === "number" ? { id: `b-${rid()}`, label: "", op: "gt", value: 0 } : { id: `b-${rid()}`, label: "", op: "eq", value: "" };
                const rest = data.branches.filter((x) => !x.otherwise);
                setBranches([...rest, fresh, ...data.branches.filter((x) => x.otherwise)]);
              }}><Plus className="size-4" />Agregar un camino</button>
          )}
          {!hasOtherwise && choice !== "number" && (
            <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-link hover:underline" onClick={() => setBranches([...data.branches, { id: `b-${rid()}`, label: "", otherwise: true }])}><Plus className="size-4" />«En otro caso»</button>
          )}
        </div>
        <p className={cn(hlp, "mt-2")}>Los caminos se revisan en orden: el caso toma el primero que se cumple.</p>
      </div>

      {field && (
        <label className="flex flex-col gap-1"><span className={lbl}>Si el dato no aparece o no se puede leer</span>
          <select className={inp} value={data.missing} onChange={(e) => patch({ missing: e.target.value })}>
            <option value="first">Sigue el primer camino</option>
            <option value="last">Sigue el último camino</option>
            <option value="wait">Espera a que alguien lo corrija</option>
          </select>
          {choice === "number" && <span className={hlp}>Se lee el valor que extrajo el análisis, también si viene escrito como «2.500 millones».</span>}
        </label>
      )}
      {!field && choice === "flow" && flowNames.size === 0 && <p className={hlp}>Todavía no hay flujos para elegir.</p>}
    </>
  );
}

function WhoForm({ kind, data, patch, ctx, next }: { kind: "sign" | "notify"; data: AnyData; patch: (p: AnyData) => void; ctx: ApprovalEditorContext; next: string | null }) {
  const who = (data.who ?? null) as Who | null;
  const mode: "role" | "person" = who?.kind ?? (data._kind === "person" ? "person" : "role");
  const role = who?.kind === "role" ? ctx.roles.find((r) => r.id === who.roleId) : undefined;
  const nameOf = (id: string) => ctx.people.find((p) => p.id === id)?.name ?? "—";
  return (
    <>
      <div>
        <span className={sectionTitle}>{kind === "sign" ? "Quién firma" : "A quién avisar"}</span>
        <div className="mb-2 grid grid-cols-2 overflow-hidden rounded-[9px] border border-[#D6D2C8] bg-white" role="group" aria-label="Rol o persona">
          {(["role", "person"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => patch({ who: null, _kind: m })}
              className={cn("min-h-9 text-[13px]", mode === m ? "bg-foreground font-semibold text-background" : "text-foreground/75")}>{m === "role" ? "Un rol" : "Una persona"}</button>
          ))}
        </div>
        {mode === "role" ? (
          <>
            <select aria-label="Rol" className={inp} value={who?.kind === "role" ? who.roleId : ""} onChange={(e) => patch({ who: e.target.value ? { kind: "role", roleId: e.target.value } : null })}>
              <option value="">Elegir un rol…</option>
              {ctx.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {ctx.roles.length === 0 && <p className={cn(hlp, "mt-1.5")}>Todavía no hay roles. <Link href="/contracts/approval-maps/roles" className="font-semibold text-link hover:underline">Crear uno</Link></p>}
            {role && (
              <p className="mt-2 text-[13px]">{role.memberIds.length ? role.memberIds.map(nameOf).join(" o ") : <span className="text-tone-warn">Este rol no tiene personas.</span>}{role.substituteId && <span className="block text-[12.5px] text-muted-foreground">Suplente: {nameOf(role.substituteId)}</span>}</p>
            )}
          </>
        ) : (
          <select aria-label="Persona" className={inp} value={who?.kind === "person" ? who.userId : ""} onChange={(e) => patch({ who: e.target.value ? { kind: "person", userId: e.target.value } : null })}>
            <option value="">Elegir una persona…</option>
            {ctx.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {kind === "sign" ? (
        <>
          <div className="rounded-[10px] bg-background px-3.5 py-3 text-[13px] leading-relaxed">
            <b className="font-semibold">Si a quien le toca no puede</b>
            <span className="block text-muted-foreground">
              {mode === "role"
                ? <>Si subió el caso, está fuera o ya firmó otro paso, firma otra persona del rol; si no hay, {role?.substituteId ? `el suplente (${nameOf(role.substituteId)})` : "el suplente del rol"}; si tampoco, un administrador.</>
                : <>Si subió el caso, está fuera o ya firmó otro paso, firma un administrador.</>}
            </span>
          </div>
          <label className="flex items-start gap-2.5 text-[13.5px]">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={data.comment === true} onChange={(e) => patch({ comment: e.target.checked || undefined })} />
            <span>Debe dejar un comentario al firmar</span>
          </label>
        </>
      ) : (
        <p className={hlp}>Recibe un correo cuando el caso pasa por aquí. No firma ni detiene el caso.</p>
      )}
      <p className={cn("text-[12.5px]", next ? "text-muted-foreground" : "text-tone-warn")}>{next ? <>Después sigue a <b className="font-semibold text-foreground">{next}</b></> : "Sin unir: arrastra desde su punto de abajo hacia la siguiente pieza."}</p>
    </>
  );
}

// ── Panel: probar ─────────────────────────────────────────────────────
function TestPanel({ mapId, ctx, graph, docName, fieldName, onResult, result }: {
  mapId: string; ctx: ApprovalEditorContext; graph: MapGraph; docName: (key: string) => string; fieldName: (doc: string, field: string) => string;
  onResult: (r: TestResult | null) => void; result: TestResult | null;
}) {
  const fields = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; number: boolean }>();
    for (const n of graph.nodes) {
      if (n.type !== "question" || n.data.subject.kind !== "field" || !n.data.subject.docType || !n.data.subject.field) continue;
      const { docType, field, mode } = n.data.subject;
      seen.set(`${docType}.${field}`, { key: `${docType}.${field}`, label: `${docName(docType)} · ${fieldName(docType, field)}`, number: mode === "number" });
    }
    return [...seen.values()];
  }, [graph, docName, fieldName]);
  const usesFlow = graph.nodes.some((n) => n.type === "question" && n.data.subject.kind === "flow");
  const [flowId, setFlowId] = useState(ctx.flows[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<"ok" | "warn" | "block">("ok");
  const [creatorId, setCreatorId] = useState("");
  const [date, setDate] = useState(ctx.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/contracts/approval-maps/${mapId}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: graph, flowId, values, verdict, creatorId, date }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo probar."); onResult(null); return; }
      onResult(d as TestResult);
    } catch { setError("Sin conexión"); }
    finally { setBusy(false); }
  }

  const signs = result?.steps.filter((s) => s.kind !== "notify") ?? [];
  const nobody = signs.some((s) => s.kind === "sign" && s.names.length === 0) || result?.steps.some((s) => s.kind === "wait") || Boolean(result?.problem);
  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <p className="text-[12.5px] text-muted-foreground">Probar</p>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">¿Quién firmaría este caso?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Con el mapa como está en pantalla, aunque no lo hayas guardado. No se guarda nada.</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {usesFlow && (
          <label className="col-span-2 flex flex-col gap-1"><span className={lbl}>Flujo del caso</span>
            <select className={inp} value={flowId} onChange={(e) => setFlowId(e.target.value)}>{ctx.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </label>
        )}
        {fields.map((f) => (
          <label key={f.key} className="col-span-2 flex flex-col gap-1"><span className={lbl}>{f.label}</span>
            <input className={cn(inp, f.number && "tabular-nums")} value={values[f.key] ?? ""} placeholder={f.number ? "Ej. 1.250.000.000 o 2.500 millones" : ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          </label>
        ))}
        <label className="flex flex-col gap-1"><span className={lbl}>El análisis encontró</span>
          <select className={inp} value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}><option value="ok">Nada</option><option value="warn">Advertencias</option><option value="block">Algo grave</option></select>
        </label>
        <label className="flex flex-col gap-1"><span className={lbl}>Fecha</span>
          <input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="col-span-2 flex flex-col gap-1"><span className={lbl}>Quién sube el caso</span>
          <select className={inp} value={creatorId} onChange={(e) => setCreatorId(e.target.value)}><option value="">Alguien que no aprueba</option>{ctx.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
      </div>
      <button type="button" onClick={() => void run()} disabled={busy} className={btn("primary", "md", "self-start")}>{busy && <Loader2 className="animate-spin" />}Ver quién firmaría</button>
      {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}

      {result && (
        <section aria-label="Resultado de la prueba" className="flex flex-col gap-3">
          {result.answers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.answers.map((a) => <span key={a.nodeId} className="rounded-full border border-[#E2C88E] bg-[#FFFBF2] px-2.5 py-0.5 text-xs text-[#5B4208]">{a.question}: <b className="font-semibold">{a.answer}</b></span>)}
            </div>
          )}
          <span className={sectionTitle}>Firmarían, en orden</span>
          {signs.length === 0 && !result.problem && <p className="text-[13.5px] text-muted-foreground">Ninguna firma: el caso quedaría aprobado al terminar su análisis.</p>}
          <ol className="flex flex-col">
            {result.steps.map((s) => (
              <li key={s.key} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-b border-line-soft py-3">
                <span className={cn("flex size-6 items-center justify-center rounded-full text-xs font-bold", s.kind === "sign" ? "bg-primary text-primary-foreground" : s.kind === "wait" ? "bg-tone-warn-bg text-tone-warn" : "bg-secondary text-foreground/70")}>
                  {s.kind === "sign" ? signs.filter((x) => x.kind === "sign").findIndex((x) => x.key === s.key) + 1 : s.kind === "wait" ? "!" : <Bell className="size-3" />}
                </span>
                <div className="min-w-0 text-[13.5px]">
                  <b className="block font-semibold">{s.kind === "notify" ? `Aviso a ${s.label}` : s.label}</b>
                  {s.kind === "wait" ? <span className="text-tone-warn">{s.reason}</span>
                    : s.names.length ? <span>{s.kind === "sign" ? "Firma " : "Recibe "}{s.names.join(" o ")}</span>
                    : <span className="text-tone-err">Nadie podría firmarlo.</span>}
                  {s.note && <span className="mt-1 block text-[12.5px] text-muted-foreground">{s.note}</span>}
                </div>
              </li>
            ))}
          </ol>
          {result.problem ? <p className="rounded-lg bg-tone-err-bg px-3 py-2 text-[13px] text-tone-err">{result.problem}</p>
            : nobody ? <p className="rounded-lg bg-tone-warn-bg px-3 py-2 text-[13px] text-[#5B4208]">Este caso no se podría aprobar así: revisa el paso marcado.</p>
            : <p className="flex items-start gap-2 rounded-lg bg-tone-ok-bg px-3 py-2 text-[13px] text-tone-ok"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />Este caso se puede aprobar: cada paso tiene quién lo firme.</p>}
        </section>
      )}
    </div>
  );
}
