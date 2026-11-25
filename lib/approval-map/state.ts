// Mapa de aprobaciones: lo que el motor necesita de la base de datos (roles,
// personas, ausencias, el mapa del flujo) y el camino de un caso guardado.
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalAbsences, approvalMaps, approvalRoleMembers, approvalRoles, contractFlows, orgUsers } from "@/db/schema";
import { canApprove } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/features";
import { orgTimeZone } from "@/lib/org-time-zone";
import { dayIn } from "@/lib/time-zone";
import type { ApprovalRecord, ApprovalStep } from "@/lib/contracts/approval-rules";
import { fieldLabelsFromFlows } from "./labels";
import {
  businessDaysBetween, evaluateRoute, mapGraphSchema, resolveSigners,
  type DocsByTypeLike, type MapContext, type MapGraph, type RouteAnswer, type RouteStep, type Who,
} from "./engine";

/** La copia del mapa publicado con la que un caso empieza a aprobarse. */
export interface MapSnapshot { mapId: string; name: string; version: number; graph: MapGraph; at: string }

/** Personas, roles y ausencias de hoy de una organización. */
export interface ApprovalPeople extends MapContext {
  admins: string[];
  names: Map<string, string>;
  emails: Map<string, string>;
  absentToday: Set<string>;
  today: string;
}

export async function loadApprovalPeople(organizationId: string, now = new Date()): Promise<ApprovalPeople> {
  const today = dayIn(await orgTimeZone(organizationId), now);
  const [users, roles, members, absences] = await Promise.all([
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, organizationId), columns: { id: true, fullName: true, email: true, role: true, isActive: true } }),
    db.query.approvalRoles.findMany({ where: eq(approvalRoles.organizationId, organizationId), columns: { id: true, name: true, substituteUserId: true } }),
    db.query.approvalRoleMembers.findMany({ where: eq(approvalRoleMembers.organizationId, organizationId), columns: { roleId: true, userId: true } }),
    db.query.approvalAbsences.findMany({
      where: and(eq(approvalAbsences.organizationId, organizationId), lte(approvalAbsences.startsOn, today), gte(approvalAbsences.endsOn, today)),
      columns: { userId: true },
    }),
  ]);
  const active = users.filter((u) => u.isActive);
  return {
    roles: new Map(roles.map((r) => [r.id, { name: r.name, substituteId: r.substituteUserId, memberIds: members.filter((m) => m.roleId === r.id).map((m) => m.userId) }])),
    signers: new Set(active.filter((u) => canApprove(u.role, "contracts")).map((u) => u.id)),
    admins: active.filter((u) => u.role === "admin").map((u) => u.id),
    names: new Map(users.map((u) => [u.id, u.fullName || u.email])),
    emails: new Map(active.map((u) => [u.id, u.email])),
    absentToday: new Set(absences.map((a) => a.userId)),
    today,
  };
}

/**
 * El mapa publicado del flujo, si la organización usa la aprobación por reglas
 * y el flujo tiene uno asignado. Lo guarda el análisis en el caso.
 */
export async function mapSnapshotForFlow(organizationId: string, flowId: string | null): Promise<MapSnapshot | null> {
  if (!flowId) return null;
  if (!await isFeatureEnabled(organizationId, "contract_approval_rules").catch(() => false)) return null;
  const flow = await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, flowId), eq(contractFlows.organizationId, organizationId)), columns: { approvalMapId: true } });
  if (!flow?.approvalMapId) return null;
  const map = await db.query.approvalMaps.findFirst({
    where: and(eq(approvalMaps.id, flow.approvalMapId), eq(approvalMaps.organizationId, organizationId)),
    columns: { id: true, name: true, version: true, publishedJson: true },
  });
  const graph = map?.publishedJson ? mapGraphSchema.safeParse(map.publishedJson) : null;
  if (!map || !graph?.success) return null;
  return { mapId: map.id, name: map.name, version: map.version, graph: graph.data, at: new Date().toISOString() };
}

export function storedSnapshot(resultJson: unknown): MapSnapshot | null {
  const raw = (resultJson as { approvalMap?: Partial<MapSnapshot> } | null)?.approvalMap;
  if (!raw || typeof raw.mapId !== "string") return null;
  const graph = mapGraphSchema.safeParse(raw.graph);
  if (!graph.success) return null;
  return { mapId: raw.mapId, name: String(raw.name ?? "Mapa"), version: Number(raw.version) || 0, graph: graph.data, at: String(raw.at ?? "") };
}

export function whoLabel(who: Who | null, people: Pick<ApprovalPeople, "roles" | "names">): string {
  if (!who) return "Sin asignar";
  return who.kind === "role" ? people.roles.get(who.roleId)?.name ?? "Rol eliminado" : people.names.get(who.userId) ?? "Una persona";
}

export interface MapRoute {
  map: { id: string; name: string; version: number };
  /** Firmas, en orden, con quién puede firmar cada una hoy. */
  steps: ApprovalStep[];
  /** Todo el camino (firmas, avisos y esperas) en orden. */
  route: RouteStep[];
  answers: RouteAnswer[];
  problem: string | null;
  remindDays: number;
}

/**
 * El camino de un caso por su mapa y quién puede firmar cada paso hoy. Se usa
 * la copia del mapa que el caso guardó al analizarse; si no la tiene, el mapa
 * publicado del flujo (casos analizados antes de asignar el mapa).
 */
export async function caseMapRoute(kase: {
  organizationId: string; flowId: string | null; createdBy: string | null; resultJson: unknown; updatedAt: Date;
}, docs: DocsByTypeLike, people?: ApprovalPeople, now = new Date()): Promise<MapRoute | null> {
  const snapshot = storedSnapshot(kase.resultJson) ?? await mapSnapshotForFlow(kase.organizationId, kase.flowId);
  if (!snapshot) return null;
  const who = people ?? await loadApprovalPeople(kase.organizationId, now);
  const result = (kase.resultJson ?? {}) as { verdict?: string; approvals?: ApprovalRecord[] };
  const verdict = result.verdict === "block" || result.verdict === "warn" ? result.verdict : "ok";
  const flows = await db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, kase.organizationId), columns: { id: true, name: true, graphJson: true } });
  const route = evaluateRoute(snapshot.graph, { flowId: kase.flowId, docs, verdict }, new Map(flows.map((f) => [f.id, f.name])), fieldLabelsFromFlows(flows.map((f) => f.graphJson)));
  const done = Array.isArray(result.approvals) ? result.approvals : [];
  const signed = new Set(done.map((d) => d.byId));

  // Desde cuándo espera el paso pendiente: la última firma, o el análisis.
  const lastAt = done.map((d) => new Date(d.at)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0];
  const waitingSince = lastAt ?? (snapshot.at ? new Date(snapshot.at) : kase.updatedAt);
  const escalateDays = snapshot.graph.settings.escalateDays;
  let firstPending = true;
  const steps: ApprovalStep[] = [];
  for (const step of route.steps) {
    if (step.kind === "notify") continue;
    const label = whoLabel(step.who, who);
    if (step.kind === "wait") {
      steps.push({ key: step.key, label: "Falta un dato", who: "Nadie todavía", approvers: { mode: "users", userIds: [] }, blockedReason: step.reason });
      firstPending = false;
      continue;
    }
    const isDone = done.some((d) => d.stepKey === step.key);
    const escalated = !isDone && firstPending && escalateDays > 0 && businessDaysBetween(waitingSince, now) >= escalateDays;
    const signers = resolveSigners(step.who, {
      roles: who.roles, signers: who.signers, admins: who.admins, creatorId: kase.createdBy,
      absent: who.absentToday, alreadySigned: signed, escalated, names: who.names,
    });
    steps.push({ key: step.key, label, who: label, approvers: { mode: "users", userIds: signers.userIds }, note: signers.note, comment: step.comment });
    if (!isDone) firstPending = false;
  }
  if (route.problem) {
    steps.push({ key: "map-problem", label: "Mapa incompleto", who: "Un administrador", approvers: { mode: "users", userIds: [] }, blockedReason: `${route.problem} Un administrador debe corregir el mapa «${snapshot.name}».` });
  }
  return {
    map: { id: snapshot.mapId, name: snapshot.name, version: snapshot.version },
    steps, route: route.steps, answers: route.answers, problem: route.problem,
    remindDays: snapshot.graph.settings.remindDays,
  };
}
