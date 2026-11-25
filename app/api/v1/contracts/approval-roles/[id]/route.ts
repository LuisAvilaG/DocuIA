import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps, approvalRoleMembers, approvalRoles } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalEditorContext, approvalMapAdmin, readJson } from "@/lib/approval-map/admin";
import { parseRoleBody, rolesInMap } from "@/lib/approval-map/roles";

type Params = { params: Promise<{ id: string }> };

async function findRole(orgId: string, id: string) {
  return db.query.approvalRoles.findFirst({ where: and(eq(approvalRoles.id, id), eq(approvalRoles.organizationId, orgId)) });
}

// Cambia el nombre, las personas o el suplente. Los mapas nombran el rol: no hay que tocarlos.
async function handlePUT(req: NextRequest, { params }: Params) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const role = await findRole(session.orgId, id);
  if (!role) return NextResponse.json({ error: "Rol no encontrado" }, { status: 404 });
  const context = await approvalEditorContext(session.orgId);
  const parsed = parseRoleBody(await readJson(req), context.people);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (context.roles.some((r) => r.id !== id && r.name.toLowerCase() === parsed.name.toLowerCase())) return NextResponse.json({ error: `Ya hay un rol «${parsed.name}».` }, { status: 409 });
  await db.transaction(async (tx) => {
    await tx.update(approvalRoles).set({ name: parsed.name, substituteUserId: parsed.substituteId, updatedAt: new Date() }).where(eq(approvalRoles.id, id));
    await tx.delete(approvalRoleMembers).where(eq(approvalRoleMembers.roleId, id));
    if (parsed.memberIds.length) await tx.insert(approvalRoleMembers).values(parsed.memberIds.map((userId) => ({ roleId: id, userId, organizationId: session.orgId })));
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_role.updated", resourceType: "approval_role", resourceId: id, metadata: parsed });
  return NextResponse.json({ ok: true });
}

// Un rol que algún mapa nombra no se borra: el mapa quedaría con una firma sin dueño.
async function handleDELETE(_req: NextRequest, { params }: Params) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const role = await findRole(session.orgId, id);
  if (!role) return NextResponse.json({ error: "Rol no encontrado" }, { status: 404 });
  const maps = await db.query.approvalMaps.findMany({ where: eq(approvalMaps.organizationId, session.orgId), columns: { name: true, draftJson: true, publishedJson: true } });
  const using = maps.filter((m) => rolesInMap(m.draftJson).has(id) || rolesInMap(m.publishedJson).has(id)).map((m) => m.name);
  if (using.length) return NextResponse.json({ error: `«${role.name}» firma en ${using.length === 1 ? "el mapa" : "los mapas"} ${using.map((n) => `«${n}»`).join(", ")}. Quítalo de ahí antes de borrarlo.` }, { status: 409 });
  await db.transaction(async (tx) => {
    await tx.delete(approvalRoleMembers).where(eq(approvalRoleMembers.roleId, id));
    await tx.delete(approvalRoles).where(eq(approvalRoles.id, id));
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_role.deleted", resourceType: "approval_role", resourceId: id, metadata: { name: role.name } });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiSecurity(handlePUT);
export const DELETE = withApiSecurity(handleDELETE);
