// Mapa de aprobaciones: el motor. Puro (sin base de datos): valida un mapa,
// sigue el camino de un caso por sus preguntas y decide quién puede firmar
// cada paso. lib/approval-map/state.ts lo conecta con los casos guardados.
import { z } from "zod";
import { normalizeContractNumber } from "@/lib/contracts/normalization";

// ── Forma del mapa ────────────────────────────────────────────────────
const zWho = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), roleId: z.string().min(1) }),
  z.object({ kind: z.literal("person"), userId: z.string().min(1) }),
]);
export type Who = z.infer<typeof zWho>;

const zSubject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flow") }),
  z.object({ kind: z.literal("field"), docType: z.string(), field: z.string(), mode: z.enum(["number", "text"]).default("number") }),
  z.object({ kind: z.literal("analysis") }),
]);
export type QuestionSubject = z.infer<typeof zSubject>;

export const NUMBER_OPS = ["lte", "lt", "gt", "gte"] as const;
export const TEXT_OPS = ["eq", "contains"] as const;

const zBranch = z.object({
  id: z.string().min(1),
  label: z.string().max(120).default(""),
  /** Este camino toma todo lo que no entra en los demás. */
  otherwise: z.boolean().optional(),
  op: z.enum([...NUMBER_OPS, ...TEXT_OPS]).optional(),
  value: z.union([z.number(), z.string().max(200)]).optional(),
  flowIds: z.array(z.string()).max(100).optional(),
  level: z.enum(["block", "warn", "ok"]).optional(),
});
export type Branch = z.infer<typeof zBranch>;

const zPosition = z.object({ x: z.number(), y: z.number() });

const zNode = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("start"), position: zPosition, data: z.object({}).passthrough().default({}) }),
  z.object({ id: z.string().min(1), type: z.literal("end"), position: zPosition, data: z.object({}).passthrough().default({}) }),
  z.object({
    id: z.string().min(1), type: z.literal("question"), position: zPosition,
    data: z.object({
      label: z.string().max(150).default(""),
      subject: zSubject,
      branches: z.array(zBranch).max(12),
      /** Si el dato no aparece o no se puede leer. */
      missing: z.enum(["first", "last", "wait"]).default("first"),
    }),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("sign"), position: zPosition,
    data: z.object({ who: zWho.nullable(), comment: z.boolean().optional() }),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("notify"), position: zPosition,
    data: z.object({ who: zWho.nullable() }),
  }),
]);
export type MapNode = z.infer<typeof zNode>;

const zEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** En una pregunta, el camino (Branch.id) del que sale la línea. */
  sourceHandle: z.string().nullable().optional(),
});
export type MapEdge = z.infer<typeof zEdge>;

export const mapGraphSchema = z.object({
  nodes: z.array(zNode).max(200),
  edges: z.array(zEdge).max(400),
  settings: z.object({
    /** Días hábiles sin firma para recordar a quien le toca (0: no recordar). */
    remindDays: z.number().int().min(0).max(30).default(2),
    /** Días hábiles sin firma para que también pueda firmar el suplente (0: nunca). */
    escalateDays: z.number().int().min(0).max(60).default(4),
  }).default({ remindDays: 2, escalateDays: 4 }),
});
export type MapGraph = z.infer<typeof mapGraphSchema>;

/** Un mapa nuevo: el caso entra y queda aprobado; el cliente dibuja lo de en medio. */
export function emptyMap(start: "single" | "flow" | "field" | "blank" = "blank", firstRoleId?: string): MapGraph {
  const settings = { remindDays: 2, escalateDays: 4 };
  const startNode: MapNode = { id: "start", type: "start", position: { x: 260, y: 20 }, data: {} };
  const endNode: MapNode = { id: "end", type: "end", position: { x: 260, y: 420 }, data: {} };
  const who: Who | null = firstRoleId ? { kind: "role", roleId: firstRoleId } : null;
  if (start === "single") {
    return {
      nodes: [startNode, { id: "sign-1", type: "sign", position: { x: 230, y: 200 }, data: { who } }, endNode],
      edges: [{ id: "e1", source: "start", target: "sign-1" }, { id: "e2", source: "sign-1", target: "end" }],
      settings,
    };
  }
  if (start === "flow" || start === "field") {
    const subject: QuestionSubject = start === "flow" ? { kind: "flow" } : { kind: "field", docType: "", field: "", mode: "number" };
    const branches: Branch[] = start === "flow"
      ? [{ id: "b1", label: "", flowIds: [] }, { id: "b2", label: "Otro", otherwise: true }]
      : [{ id: "b1", label: "", op: "lte", value: 0 }, { id: "b2", label: "", op: "gt", value: 0 }];
    return {
      nodes: [
        startNode,
        { id: "q-1", type: "question", position: { x: 220, y: 120 }, data: { label: start === "flow" ? "¿Qué tipo de contrato?" : "", subject, branches, missing: "first" } },
        { id: "sign-1", type: "sign", position: { x: 80, y: 260 }, data: { who } },
        { id: "sign-2", type: "sign", position: { x: 380, y: 260 }, data: { who: null } },
        endNode,
      ],
      edges: [
        { id: "e1", source: "start", target: "q-1" },
        { id: "e2", source: "q-1", sourceHandle: "b1", target: "sign-1" },
        { id: "e3", source: "q-1", sourceHandle: "b2", target: "sign-2" },
        { id: "e4", source: "sign-1", target: "end" },
        { id: "e5", source: "sign-2", target: "end" },
      ],
      settings,
    };
  }
  return { nodes: [startNode, endNode], edges: [], settings };
}

// ── Leer valores ──────────────────────────────────────────────────────
const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^mil\s+millones?$/i, 1e9],
  [/^(?:billones?|billón|billon)$/i, 1e12],
  [/^(?:millones?|millón|millon|mm|mills?\.?)$/i, 1e6],
  [/^mil$/i, 1e3],
];

/**
 * Un monto como lo escribe un contrato: «$1.500.000.000», «2.500 millones»,
 * «COP 1,5 MM», «USD 3 mil». null si no hay un número claro.
 */
export function readAmount(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  const words = /^[^\d-]{0,12}(-?[\d][\d.,\s]*?)\s*(mil millones|billones|billón|billon|millones|millón|millon|mm|mills?\.?|mil)\b/i.exec(text);
  if (words) {
    const base = normalizeContractNumber(words[1].replace(/\s/g, ""));
    const factor = MULTIPLIERS.find(([pattern]) => pattern.test(words[2]))?.[1];
    if (base !== null && factor) return base * factor;
  }
  return normalizeContractNumber(raw);
}

const plain = (value: unknown) => String(Array.isArray(value) ? value.join(" ") : value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ── Seguir el camino de un caso ───────────────────────────────────────
export type DocsByTypeLike = Record<string, Array<{ values: Record<string, unknown> }>>;

export interface RouteInput {
  flowId: string | null;
  /** Documentos por tipo, del más reciente al más antiguo (newestFirst). */
  docs: DocsByTypeLike;
  /** Lo que encontró el análisis: block (algo grave), warn o ok. */
  verdict: "block" | "warn" | "ok";
}

export interface RouteStep {
  /** El id del nodo: un camino no pasa dos veces por el mismo. */
  key: string;
  kind: "sign" | "notify" | "wait";
  who: Who | null;
  comment?: boolean;
  /** En un paso «wait», por qué el caso no puede seguir. */
  reason?: string;
}

export interface RouteAnswer { nodeId: string; question: string; answer: string }

export interface Route { steps: RouteStep[]; answers: RouteAnswer[]; problem: string | null }

const OP_LABEL: Record<string, string> = { lte: "hasta", lt: "menos de", gt: "más de", gte: "desde", eq: "es", contains: "contiene" };
const LEVEL_LABEL = { block: "Algo grave", warn: "Advertencias", ok: "Nada" } as const;

/** Un monto sin moneda (el dato puede estar en pesos, UF o dólares): «2.000 M», «5.000». */
export function formatAmount(n: number): string {
  if (Math.abs(n) >= 1e9 && n % 1e6 === 0) return `${(n / 1e6).toLocaleString("es-CO")} M`;
  if (Math.abs(n) >= 1e6 && n % 1e5 === 0) return `${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  return n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/** El texto de un camino cuando nadie le puso nombre: «Hasta $2.000 M», «Obra». */
export function branchLabel(branch: Branch, subject: QuestionSubject, flowNames: Map<string, string> = new Map()): string {
  if (branch.label.trim()) return branch.label.trim();
  if (branch.otherwise) return "En otro caso";
  if (subject.kind === "flow") return (branch.flowIds ?? []).map((id) => flowNames.get(id) ?? "Flujo").join(", ") || "Sin flujo";
  if (subject.kind === "analysis") return branch.level ? LEVEL_LABEL[branch.level] : "Sin elegir";
  const op = OP_LABEL[branch.op ?? (subject.mode === "text" ? "eq" : "lte")];
  if (subject.mode === "number") return typeof branch.value === "number" ? `${op[0].toUpperCase()}${op.slice(1)} ${formatAmount(branch.value)}` : "Sin valor";
  return `${op[0].toUpperCase()}${op.slice(1)} «${branch.value ?? ""}»`;
}

/**
 * El nombre de una pregunta: el que le pusieron o, si no, de qué trata. Un
 * dato se nombra como en el flujo («Monto (UF)»), no por su clave interna:
 * fieldLabels va de «documento.dato» a su nombre.
 */
export function questionLabel(data: Extract<MapNode, { type: "question" }>["data"], fieldLabels?: Map<string, string>): string {
  if (data.label.trim()) return data.label.trim();
  if (data.subject.kind === "flow") return "Tipo de contrato";
  if (data.subject.kind === "analysis") return "Lo que encontró el análisis";
  return fieldLabels?.get(`${data.subject.docType}.${data.subject.field}`) ?? (data.subject.field || "Un dato");
}

function firstValue(docs: DocsByTypeLike, docType: string, field: string): unknown {
  const list = docs[docType] ?? [];
  const present = (v: unknown) => Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "";
  return (list.find((doc) => present(doc.values[field])) ?? list[0])?.values[field];
}

/** El camino que toma una pregunta, o null si el dato falta o ninguno aplica. */
function chooseBranch(data: Extract<MapNode, { type: "question" }>["data"], input: RouteInput): Branch | null | "missing" {
  const real = data.branches.filter((b) => !b.otherwise);
  const otherwise = data.branches.find((b) => b.otherwise) ?? null;
  const subject = data.subject;
  if (subject.kind === "flow") {
    return real.find((b) => input.flowId && (b.flowIds ?? []).includes(input.flowId)) ?? otherwise;
  }
  if (subject.kind === "analysis") {
    return real.find((b) => b.level === input.verdict) ?? otherwise;
  }
  const raw = firstValue(input.docs, subject.docType, subject.field);
  if (subject.mode === "number") {
    const n = readAmount(raw);
    if (n === null) return "missing";
    const hit = real.find((b) => {
      if (typeof b.value !== "number") return false;
      switch (b.op ?? "lte") {
        case "lte": return n <= b.value;
        case "lt": return n < b.value;
        case "gt": return n > b.value;
        case "gte": return n >= b.value;
        default: return false;
      }
    });
    return hit ?? otherwise;
  }
  const text = plain(raw);
  if (!text) return "missing";
  return real.find((b) => {
    const want = plain(b.value);
    if (!want) return false;
    return (b.op ?? "eq") === "contains" ? text.includes(want) : text === want;
  }) ?? otherwise;
}

/**
 * El camino de un caso por el mapa: las firmas y avisos en orden y lo que
 * respondió cada pregunta. Un mapa publicado ya pasó validateMap; aun así un
 * camino roto termina con un problema en vez de colgarse.
 */
export function evaluateRoute(graph: MapGraph, input: RouteInput, flowNames: Map<string, string> = new Map(), fieldLabels?: Map<string, string>): Route {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = (id: string, handle?: string) => graph.edges.find((e) => e.source === id && (handle === undefined || e.sourceHandle === handle));
  const steps: RouteStep[] = [];
  const answers: RouteAnswer[] = [];
  let node: MapNode | undefined = graph.nodes.find((n) => n.type === "start");
  const seen = new Set<string>();
  while (node && node.type !== "end") {
    if (seen.has(node.id) || seen.size > graph.nodes.length) return { steps, answers, problem: "El mapa tiene un ciclo." };
    seen.add(node.id);
    let next: MapEdge | undefined;
    if (node.type === "question") {
      let branch = chooseBranch(node.data, input);
      if (branch === "missing" || branch === null) {
        const real = node.data.branches.filter((b) => !b.otherwise);
        const what = questionLabel(node.data, fieldLabels);
        if (node.data.missing === "wait" || real.length === 0) {
          steps.push({ key: node.id, kind: "wait", who: null, reason: branch === "missing" ? `Falta «${what}» o no se pudo leer: corrígelo en el caso para seguir.` : `«${what}» no entra en ningún camino del mapa.` });
          return { steps, answers, problem: null };
        }
        branch = node.data.missing === "last" ? real[real.length - 1] : real[0];
        answers.push({ nodeId: node.id, question: what, answer: `${branchLabel(branch, node.data.subject, flowNames)} (sin dato)` });
      } else {
        answers.push({ nodeId: node.id, question: questionLabel(node.data, fieldLabels), answer: branchLabel(branch, node.data.subject, flowNames) });
      }
      next = out(node.id, branch.id);
    } else {
      if (node.type === "sign") steps.push({ key: node.id, kind: "sign", who: node.data.who, comment: node.data.comment });
      if (node.type === "notify") steps.push({ key: node.id, kind: "notify", who: node.data.who });
      next = out(node.id);
    }
    if (!next) return { steps, answers, problem: "Un camino del mapa no llega a «Aprobado»." };
    node = byId.get(next.target);
  }
  if (!node) return { steps, answers, problem: "Un camino del mapa no llega a «Aprobado»." };
  return { steps, answers, problem: null };
}

// ── Revisar un mapa antes de publicarlo ───────────────────────────────
export interface MapIssue { nodeId?: string; message: string; level: "error" | "warn" }

export interface MapContext {
  roles: Map<string, { name: string; memberIds: string[]; substituteId: string | null }>;
  /** Personas que hoy pueden aprobar (activas, Administrador o Aprobador). */
  signers: Set<string>;
  names?: Map<string, string>;
  flowIds?: Set<string>;
}

export function validateMap(graph: MapGraph, ctx: MapContext & { fieldLabels?: Map<string, string> }): MapIssue[] {
  const issues: MapIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) issues.push({ level: "error", message: "El mapa necesita exactamente un «Caso listo»." });
  if (!graph.nodes.some((n) => n.type === "end")) issues.push({ level: "error", message: "Falta «Aprobado», el final del camino." });
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) issues.push({ level: "error", message: "Hay una línea que no une dos piezas." });
  }
  const name = (id: string) => ctx.names?.get(id) ?? "una persona";
  for (const n of graph.nodes) {
    const outs = graph.edges.filter((e) => e.source === n.id);
    if (n.type === "end") {
      if (outs.length) issues.push({ level: "error", nodeId: n.id, message: "«Aprobado» es el final: no puede seguir a otra pieza." });
      continue;
    }
    if (n.type === "question") {
      const q = n.data;
      const what = questionLabel(q, ctx.fieldLabels);
      if (q.branches.length < 2) issues.push({ level: "error", nodeId: n.id, message: `«${what}» necesita al menos dos caminos.` });
      if (q.branches.filter((b) => b.otherwise).length > 1) issues.push({ level: "error", nodeId: n.id, message: `«${what}» tiene más de un camino «En otro caso».` });
      if (q.subject.kind === "field" && (!q.subject.docType || !q.subject.field)) issues.push({ level: "error", nodeId: n.id, message: `Elige el documento y el dato de «${what}».` });
      for (const b of q.branches) {
        const edges = outs.filter((e) => e.sourceHandle === b.id);
        const label = branchLabel(b, q.subject);
        if (edges.length !== 1) issues.push({ level: "error", nodeId: n.id, message: `El camino «${label}» de «${what}» ${edges.length ? "sale hacia más de una pieza" : "no lleva a ninguna pieza"}.` });
        if (b.otherwise) continue;
        if (q.subject.kind === "flow" && !(b.flowIds ?? []).length) issues.push({ level: "error", nodeId: n.id, message: `Elige el flujo del camino «${label}».` });
        if (q.subject.kind === "flow" && ctx.flowIds && (b.flowIds ?? []).some((id) => !ctx.flowIds!.has(id))) issues.push({ level: "warn", nodeId: n.id, message: `El camino «${label}» nombra un flujo que ya no existe.` });
        if (q.subject.kind === "analysis" && !b.level) issues.push({ level: "error", nodeId: n.id, message: `Elige qué encontró el análisis en el camino «${label}».` });
        if (q.subject.kind === "field" && q.subject.mode === "number" && typeof b.value !== "number") issues.push({ level: "error", nodeId: n.id, message: `Escribe el monto del camino «${label}».` });
        if (q.subject.kind === "field" && q.subject.mode === "text" && !String(b.value ?? "").trim()) issues.push({ level: "error", nodeId: n.id, message: `Escribe el texto del camino «${label}».` });
      }
      for (const e of outs) if (!q.branches.some((b) => b.id === e.sourceHandle)) issues.push({ level: "error", nodeId: n.id, message: `Una línea de «${what}» no sale de ningún camino.` });
      continue;
    }
    if (outs.length !== 1) issues.push({ level: "error", nodeId: n.id, message: n.type === "start" ? "«Caso listo» debe llevar a una sola pieza." : outs.length ? "Una firma o aviso solo puede seguir hacia una pieza; para abrir caminos usa una pregunta." : "Hay una firma o aviso que no lleva a ninguna pieza." });
    if (n.type === "sign" || n.type === "notify") {
      const who = n.data.who;
      const kind = n.type === "sign" ? "firma" : "aviso";
      if (!who) { issues.push({ level: "error", nodeId: n.id, message: `Elige quién recibe la ${kind}.` }); continue; }
      if (who.kind === "role") {
        const role = ctx.roles.get(who.roleId);
        if (!role) { issues.push({ level: "error", nodeId: n.id, message: `La ${kind} nombra un rol que ya no existe.` }); continue; }
        const active = role.memberIds.filter((id) => ctx.signers.has(id));
        if (n.type === "sign" && active.length === 0 && !(role.substituteId && ctx.signers.has(role.substituteId))) {
          issues.push({ level: "warn", nodeId: n.id, message: `«${role.name}» no tiene a nadie que pueda firmar: lo firmará un administrador.` });
        } else if (n.type === "sign" && active.length === 1 && !role.substituteId) {
          issues.push({ level: "warn", nodeId: n.id, message: `«${role.name}» tiene una sola persona y no tiene suplente: si ${name(active[0])} sube el caso o está fuera, lo firmará un administrador.` });
        }
      } else if (n.type === "sign" && !ctx.signers.has(who.userId)) {
        issues.push({ level: "warn", nodeId: n.id, message: `${name(who.userId)} ya no puede aprobar: lo firmará un administrador.` });
      }
    }
  }
  // Ciclos y piezas sueltas.
  const start = starts[0];
  if (start) {
    const reached = new Set<string>();
    const stack = [start.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const e of graph.edges) if (e.source === id) stack.push(e.target);
    }
    for (const n of graph.nodes) if (!reached.has(n.id)) issues.push({ level: n.type === "end" ? "error" : "warn", nodeId: n.id, message: n.type === "end" ? "Ningún camino llega a «Aprobado»." : "Hay una pieza que no está unida al camino; no se usará." });
    if (hasCycle(graph)) issues.push({ level: "error", message: "Una línea vuelve hacia atrás: el camino de un caso no puede repetirse." });
  }
  return issues;
}

function hasCycle(graph: MapGraph): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const e of graph.edges) if (e.source === id && visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  return graph.nodes.some((n) => visit(n.id));
}

// ── Quién firma un paso ───────────────────────────────────────────────
export interface SignerContext {
  roles: MapContext["roles"];
  signers: Set<string>;
  admins: string[];
  creatorId: string | null;
  /** Personas fuera hoy (ausencias en la zona de la organización). */
  absent: Set<string>;
  /** Quienes ya firmaron otro paso de este caso: nadie firma dos. */
  alreadySigned: Set<string>;
  /** El paso lleva más días sin firma que los del mapa: también puede el suplente. */
  escalated: boolean;
  names: Map<string, string>;
}

export interface StepSigners { userIds: string[]; note: string | null; label: string }

export function resolveSigners(who: Who | null, ctx: SignerContext): StepSigners {
  const name = (id: string) => ctx.names.get(id) ?? "Alguien";
  const why = (id: string) => id === ctx.creatorId ? `${name(id)} subió el caso`
    : ctx.absent.has(id) ? `${name(id)} está fuera`
    : ctx.alreadySigned.has(id) ? `${name(id)} ya firmó otro paso`
    : `${name(id)} ya no puede aprobar`;
  const can = (id: string) => ctx.signers.has(id) && id !== ctx.creatorId && !ctx.absent.has(id) && !ctx.alreadySigned.has(id);
  const adminsFallback = (reason: string): StepSigners => {
    const admins = ctx.admins.filter(can);
    return admins.length
      ? { userIds: admins, label: "", note: `${reason}: lo firma un administrador.` }
      : { userIds: [], label: "", note: `${reason} y no hay un administrador que pueda firmarlo.` };
  };

  if (!who) return { ...adminsFallback("El paso no dice quién firma"), label: "Sin asignar" };
  if (who.kind === "person") {
    const label = name(who.userId);
    return can(who.userId) ? { userIds: [who.userId], label, note: null } : { ...adminsFallback(why(who.userId)), label };
  }
  const role = ctx.roles.get(who.roleId);
  if (!role) return { ...adminsFallback("El rol ya no existe"), label: "Rol eliminado" };
  const primary = role.memberIds.filter(can);
  const excluded = role.memberIds.filter((id) => !can(id) && ctx.signers.has(id));
  const sub = role.substituteId && can(role.substituteId) ? role.substituteId : null;
  if (primary.length) {
    if (ctx.escalated && sub && !primary.includes(sub)) {
      return { userIds: [...primary, sub], label: role.name, note: `No se firmó a tiempo: también puede firmar el suplente, ${name(sub)}.` };
    }
    return { userIds: primary, label: role.name, note: excluded.length ? `${excluded.map(why).join("; ")}.` : null };
  }
  const reason = role.memberIds.length ? role.memberIds.map(why).join("; ") : `«${role.name}» no tiene personas`;
  if (sub) return { userIds: [sub], label: role.name, note: `${reason}: firma el suplente, ${name(sub)}.` };
  return { ...adminsFallback(reason), label: role.name };
}

/** Los días hábiles (lunes a viernes) completos entre dos fechas. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}
