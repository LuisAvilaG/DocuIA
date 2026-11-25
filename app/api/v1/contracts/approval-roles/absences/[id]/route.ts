import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalAbsences } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalMapAdmin } from "@/lib/approval-map/admin";

async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const removed = await db.delete(approvalAbsences)
    .where(and(eq(approvalAbsences.id, id), eq(approvalAbsences.organizationId, session.orgId)))
    .returning({ userId: approvalAbsences.userId, startsOn: approvalAbsences.startsOn, endsOn: approvalAbsences.endsOn });
  if (!removed.length) return NextResponse.json({ error: "Ausencia no encontrada" }, { status: 404 });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_absence.deleted", resourceType: "approval_absence", resourceId: id, metadata: removed[0] });
  return NextResponse.json({ ok: true });
}

export const DELETE = withApiSecurity(handleDELETE);
