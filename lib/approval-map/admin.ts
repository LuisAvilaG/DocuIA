// Mapa de aprobaciones: lo común de sus rutas de API (quién puede tocarlo) y
// lo que necesita el editor (roles, personas, flujos y datos de los documentos).
import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalAbsences, approvalRoleMembers, approvalRoles, contractFlows, orgUsers } from "@/db/schema";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { orgTimeZone } from "@/lib/org-time-zone";
import { dayIn } from "@/lib/time-zone";

type Session = NonNullable<Awaited<ReturnType<typeof getTenantSession>>>;

/** Solo un administrador del cliente, con Contratos y la aprobación por reglas activos. */
export async function approvalMapAdmin(write: boolean): Promise<{ session: Session } | { response: NextResponse }> {
  const session = await getTenantSession({ area: "contracts", permission: write ? "write" : "read" });
  if (!session) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (session.role !== "admin") return { response: NextResponse.json({ error: "Solo un administrador configura las aprobaciones." }, { status: 403 }) };
  const [product, feature] = await Promise.all([
    isProductActive(session.orgId, "contract_intelligence"),
    isFeatureEnabled(session.orgId, "contract_approval_rules"),
  ]);
  if (!product || !feature) return { response: NextResponse.json({ error: "La aprobación por reglas no está habilitada para este cliente." }, { status: 403 }) };
  return { session };
}

export interface EditorPerson { id: string; name: string; role: string }
export interface EditorRole { id: string; name: string; memberIds: string[]; substituteId: string | null }
export interface EditorFlow { id: string; name: string; approvalMapId: string | null; isActive: boolean }
export interface EditorDocType { key: string; name: string; fields: Array<{ key: string; label: string }> }
export interface EditorAbsence { id: string; userId: string; startsOn: string; endsOn: string }

export interface ApprovalEditorContext {
  people: EditorPerson[];
  roles: EditorRole[];
  flows: EditorFlow[];
  docTypes: EditorDocType[];
  absences: EditorAbsence[];
  today: string;
}

/** Todo lo que se elige en el mapa y en Roles y personas. */
export async function approvalEditorContext(organizationId: string): Promise<ApprovalEditorContext> {
  const today = dayIn(await orgTimeZone(organizationId));
  const [users, roles, members, flows, absences] = await Promise.all([
    db.query.orgUsers.findMany({ where: and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.isActive, true)), columns: { id: true, fullName: true, email: true, role: true } }),
    db.query.approvalRoles.findMany({ where: eq(approvalRoles.organizationId, organizationId), columns: { id: true, name: true, substituteUserId: true }, orderBy: (r, { asc }) => [asc(r.name)] }),
    db.query.approvalRoleMembers.findMany({ where: eq(approvalRoleMembers.organizationId, organizationId), columns: { roleId: true, userId: true } }),
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, organizationId), columns: { id: true, name: true, approvalMapId: true, isActive: true, graphJson: true }, orderBy: (f, { asc }) => [asc(f.name)] }),
    db.query.approvalAbsences.findMany({ where: and(eq(approvalAbsences.organizationId, organizationId), gte(approvalAbsences.endsOn, today)), columns: { id: true, userId: true, startsOn: true, endsOn: true }, orderBy: (a, { asc }) => [asc(a.startsOn)] }),
  ]);
  const docTypes = new Map<string, EditorDocType>();
  for (const flow of flows) {
    const graph = flowGraphSchema.safeParse(flow.graphJson);
    if (!graph.success) continue;
    for (const node of graph.data.nodes) {
      if (node.kind === "intake") {
        const entry = docTypes.get(node.data.docTypeKey) ?? { key: node.data.docTypeKey, name: node.data.name, fields: [] };
        entry.name = entry.name || node.data.name;
        docTypes.set(node.data.docTypeKey, entry);
      }
      if (node.kind === "extract") {
        const entry = docTypes.get(node.data.docTypeKey) ?? { key: node.data.docTypeKey, name: node.data.docTypeKey, fields: [] };
        for (const field of node.data.fields) if (!entry.fields.some((f) => f.key === field.fieldKey)) entry.fields.push({ key: field.fieldKey, label: field.label });
        docTypes.set(node.data.docTypeKey, entry);
      }
    }
  }
  return {
    people: users.filter((u) => canApprove(u.role, "contracts")).map((u) => ({ id: u.id, name: u.fullName || u.email, role: u.role }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    roles: roles.map((r) => ({ id: r.id, name: r.name, substituteId: r.substituteUserId, memberIds: members.filter((m) => m.roleId === r.id).map((m) => m.userId) })),
    flows: flows.map((f) => ({ id: f.id, name: f.name, approvalMapId: f.approvalMapId, isActive: f.isActive })),
    docTypes: [...docTypes.values()].sort((a, b) => a.name.localeCompare(b.name, "es")),
    absences,
    today,
  };
}

/** Lo que validateMap necesita, desde el contexto del editor. */
export function mapContextFrom(ctx: ApprovalEditorContext) {
  return {
    roles: new Map(ctx.roles.map((r) => [r.id, { name: r.name, memberIds: r.memberIds, substituteId: r.substituteId }])),
    signers: new Set(ctx.people.map((p) => p.id)),
    names: new Map(ctx.people.map((p) => [p.id, p.name])),
    flowIds: new Set(ctx.flows.map((f) => f.id)),
    fieldLabels: new Map(ctx.docTypes.flatMap((d) => d.fields.map((f) => [`${d.key}.${f.key}`, f.label] as const))),
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}
