import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";
import { isFeatureEnabled } from "@/lib/features";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "contracts")) return NextResponse.json({ error: "No tienes permiso para rechazar casos" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_approval_workflow")) {
    return NextResponse.json({ error: "La aprobación de contratos no está habilitada para este cliente." }, { status: 403 });
  }
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true, status: true, resultJson: true },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.status !== "validated") {
    return NextResponse.json({ error: "Este caso todavía no está listo para rechazar. Espera a que finalice la validación." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Escribe un motivo para rechazar el caso." }, { status: 400 });

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  const rejected = await db.update(contractCases).set({
    status: "rejected",
    resultJson: { ...prev, decision: { action: "reject", reason, byId: session.sub, byEmail: session.email, at: new Date().toISOString() } },
    updatedAt: new Date(),
  }).where(and(eq(contractCases.id, id), eq(contractCases.status, "validated"))).returning({ id: contractCases.id });
  if (!rejected.length) return NextResponse.json({ error: "El caso cambió mientras lo revisabas. Recarga la página." }, { status: 409 });

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.rejected", resourceType: "contract_case", resourceId: id, metadata: { reason } });
  return NextResponse.json({ ok: true, status: "rejected" });
}

export const POST = withApiSecurity(handlePOST);
