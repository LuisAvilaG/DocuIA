import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { approvalRoleMembers, approvalRoles } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalEditorContext, approvalMapAdmin, readJson } from "@/lib/approval-map/admin";
import { parseRoleBody } from "@/lib/approval-map/roles";

async function handleGET() {
  const auth = await approvalMapAdmin(false);
  if ("response" in auth) return auth.response;
  const context = await approvalEditorContext(auth.session.orgId);
  return NextResponse.json({ people: context.people, roles: context.roles, absences: context.absences, today: context.today });
}

// Un rol de firma nuevo con sus personas y su suplente.
async function handlePOST(req: NextRequest) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const context = await approvalEditorContext(session.orgId);
  const parsed = parseRoleBody(await readJson(req), context.people);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (context.roles.some((r) => r.name.toLowerCase() === parsed.name.toLowerCase())) return NextResponse.json({ error: `Ya hay un rol «${parsed.name}».` }, { status: 409 });
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(approvalRoles).values({ id, organizationId: session.orgId, name: parsed.name, substituteUserId: parsed.substituteId });
    if (parsed.memberIds.length) await tx.insert(approvalRoleMembers).values(parsed.memberIds.map((userId) => ({ roleId: id, userId, organizationId: session.orgId })));
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_role.created", resourceType: "approval_role", resourceId: id, metadata: parsed });
  return NextResponse.json({ id }, { status: 201 });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
