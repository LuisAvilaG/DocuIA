import type { EditorPerson } from "./admin";
import { mapGraphSchema } from "./engine";

/** Nombre, personas y suplente de un rol, solo entre quienes pueden aprobar. */
export function parseRoleBody(body: Record<string, unknown>, people: EditorPerson[]):
  { name: string; memberIds: string[]; substituteId: string | null } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return { error: "Escribe el nombre del rol." };
  const valid = new Set(people.map((p) => p.id));
  const memberIds = Array.isArray(body.memberIds) ? [...new Set((body.memberIds as unknown[]).filter((x): x is string => typeof x === "string"))] : [];
  if (memberIds.some((id) => !valid.has(id))) return { error: "Solo pueden estar en un rol las personas que pueden aprobar (Administrador o Aprobador)." };
  const substituteId = typeof body.substituteId === "string" && body.substituteId ? body.substituteId : null;
  if (substituteId && !valid.has(substituteId)) return { error: "El suplente debe poder aprobar casos." };
  if (substituteId && memberIds.includes(substituteId)) return { error: "El suplente no puede ser una persona del mismo rol." };
  return { name, memberIds: memberIds.slice(0, 50), substituteId };
}

/** Los roles que nombra un mapa (borrador o publicado). */
export function rolesInMap(json: unknown): Set<string> {
  const graph = mapGraphSchema.safeParse(json);
  const ids = new Set<string>();
  if (!graph.success) return ids;
  for (const node of graph.data.nodes) {
    if ((node.type === "sign" || node.type === "notify") && node.data.who?.kind === "role") ids.add(node.data.who.roleId);
  }
  return ids;
}
