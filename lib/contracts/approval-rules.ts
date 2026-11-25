// Aprobación por reglas (feature contract_approval_rules). Puro: decide qué pasos de
// aprobación pide un caso, si una persona puede firmar el siguiente y cuándo termina.
import { normalizeContractNumber } from "./normalization";

export interface Approvers { mode: "any" | "users"; userIds: string[] }
export interface ApprovalNodeData {
  name: string;
  base: Approvers;
  conditions: Array<{ label: string; docType: string; field: string; op: "gt" | "gte"; value: number; approvers: Approvers }>;
  exceptionUserIds: string[];
}
export interface ApprovalStep {
  key: string;
  label: string;
  approvers: Approvers;
  /** Mapa de aprobaciones: por qué firma quien firma (el titular subió el caso, está fuera…). */
  note?: string | null;
  /** Mapa de aprobaciones: el paso no se puede firmar todavía, y por qué. */
  blockedReason?: string;
  /** Mapa de aprobaciones: el rol o la persona del paso, tal como se dibujó. */
  who?: string;
  /** Mapa de aprobaciones: quien firma este paso debe dejar un comentario. */
  comment?: boolean;
}
export interface ApprovalRecord { stepKey: string; byId: string; byEmail: string | null; at: string; reason: string | null }

type DocsByType = Record<string, Array<{ values: Record<string, unknown> }>>;

function firstNumber(docs: DocsByType, docType: string, field: string): number | null {
  for (const d of docs[docType] ?? []) {
    const raw = d.values[field];
    const n = normalizeContractNumber(Array.isArray(raw) ? raw[0] : raw);
    if (n !== null) return n;
  }
  return null;
}

/** Pasos que pide el caso: «Siempre» y cada condición por valor que se cumple. */
export function requiredSteps(node: ApprovalNodeData, docs: DocsByType): ApprovalStep[] {
  const steps: ApprovalStep[] = [{ key: "base", label: "Siempre", approvers: node.base }];
  node.conditions.forEach((c, i) => {
    const v = firstNumber(docs, c.docType, c.field);
    if (v === null) return;
    if (c.op === "gte" ? v >= c.value : v > c.value) {
      steps.push({ key: `cond_${i}`, label: c.label || `${c.field} ${c.op === "gte" ? "≥" : ">"} ${c.value.toLocaleString("es-MX")}`, approvers: c.approvers });
    }
  });
  return steps;
}

export type ApprovalCheck =
  | { ok: true; step: ApprovalStep; last: boolean }
  | { ok: false; reason: string };

/**
 * Si `actor` puede firmar ahora: el primer paso pendiente para el que tiene permiso.
 * Una misma persona no firma dos pasos; quien crea el caso no aprueba si así se configuró;
 * con bloqueos, solo quien está en la lista de excepción (si la hay).
 */
export function checkApproval(opts: {
  steps: ApprovalStep[];
  done: ApprovalRecord[];
  actor: { id: string; canApprove: boolean };
  creatorId: string | null;
  noSelfApproval: boolean;
  blocked: boolean;
  exceptionUserIds: string[];
  /** Mapa de aprobaciones: los pasos se firman en orden, solo el primero pendiente. */
  ordered?: boolean;
}): ApprovalCheck {
  const { steps, done, actor } = opts;
  if (opts.ordered) {
    if (!actor.canApprove) return { ok: false, reason: "No tienes permiso para aprobar casos." };
    const pending = steps.filter((s) => !done.some((d) => d.stepKey === s.key));
    const next = pending[0];
    if (!next) return { ok: false, reason: "El caso ya tiene todas sus aprobaciones." };
    if (next.blockedReason) return { ok: false, reason: next.blockedReason };
    if (done.some((d) => d.byId === actor.id)) return { ok: false, reason: "Ya firmaste este caso; falta otra persona." };
    if (!next.approvers.userIds.includes(actor.id)) return { ok: false, reason: `Este paso lo firma ${next.label}${next.approvers.userIds.length ? "" : ", y hoy nadie puede"}.` };
    return { ok: true, step: next, last: pending.length === 1 };
  }
  if (!actor.canApprove) return { ok: false, reason: "No tienes permiso para aprobar casos." };
  if (opts.noSelfApproval && opts.creatorId && opts.creatorId === actor.id) return { ok: false, reason: "Quien crea el caso no puede aprobarlo." };
  if (opts.blocked && opts.exceptionUserIds.length > 0 && !opts.exceptionUserIds.includes(actor.id)) {
    return { ok: false, reason: "Con bloqueos, solo las personas autorizadas pueden aprobar con excepción." };
  }
  if (done.some((d) => d.byId === actor.id)) return { ok: false, reason: "Ya aprobaste este caso; falta otra persona." };
  const pending = steps.filter((s) => !done.some((d) => d.stepKey === s.key));
  if (pending.length === 0) return { ok: false, reason: "El caso ya tiene todas sus aprobaciones." };
  // A step that names this person goes first: taking the open one would leave
  // theirs for nobody (they cannot sign twice, and no one else may sign it).
  const step = pending.find((s) => s.approvers.mode === "users" && s.approvers.userIds.includes(actor.id))
    ?? pending.find((s) => s.approvers.mode === "any");
  if (!step) return { ok: false, reason: `Este paso lo decide otra persona: ${pending[0].label}.` };
  return { ok: true, step, last: pending.length === 1 };
}
