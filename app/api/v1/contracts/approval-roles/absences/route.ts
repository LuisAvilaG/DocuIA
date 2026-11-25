import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { approvalAbsences } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalEditorContext, approvalMapAdmin, readJson } from "@/lib/approval-map/admin";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Alguien estará fuera esos días (ambos incluidos): sus firmas pasan a otra persona del rol o al suplente.
async function handlePOST(req: NextRequest) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const body = await readJson(req);
  const userId = typeof body.userId === "string" ? body.userId : "";
  const startsOn = typeof body.startsOn === "string" ? body.startsOn : "";
  const endsOn = typeof body.endsOn === "string" ? body.endsOn : "";
  if (!DAY.test(startsOn) || !DAY.test(endsOn) || Number.isNaN(Date.parse(startsOn)) || Number.isNaN(Date.parse(endsOn))) return NextResponse.json({ error: "Elige las fechas de inicio y fin." }, { status: 400 });
  if (endsOn < startsOn) return NextResponse.json({ error: "La fecha de fin es anterior a la de inicio." }, { status: 400 });
  const context = await approvalEditorContext(session.orgId);
  if (!context.people.some((p) => p.id === userId)) return NextResponse.json({ error: "Elige una persona que pueda aprobar." }, { status: 400 });
  if (endsOn < context.today) return NextResponse.json({ error: "Esa ausencia ya terminó." }, { status: 400 });
  const id = randomUUID();
  await db.insert(approvalAbsences).values({ id, organizationId: session.orgId, userId, startsOn, endsOn, createdBy: session.sub });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_absence.created", resourceType: "approval_absence", resourceId: id, metadata: { userId, startsOn, endsOn } });
  return NextResponse.json({ id }, { status: 201 });
}

export const POST = withApiSecurity(handlePOST);
