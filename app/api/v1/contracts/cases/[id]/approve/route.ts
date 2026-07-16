import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases, contractValidations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden aprobar" }, { status: 403 });
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true, resultJson: true },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const override = !!body?.override;

  // Gate on blocking validations: cannot approve unless the reviewer overrides + explains.
  const vals = await db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id), columns: { ok: true, severity: true } });
  const blocked = vals.some((v) => v.ok === false && v.severity === "block");
  if (blocked && !override) {
    return NextResponse.json({ error: "Este caso tiene validaciones bloqueantes. Debes forzar la aprobación con un motivo.", needsOverride: true }, { status: 409 });
  }
  if (blocked && override && !reason) {
    return NextResponse.json({ error: "Escribe el motivo para aprobar pese a los bloqueos." }, { status: 400 });
  }

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  await db.update(contractCases).set({
    status: "approved",
    resultJson: { ...prev, decision: { action: "approve", reason: reason || null, byId: session.sub, byEmail: session.email, at: new Date().toISOString(), override: blocked && override } },
    updatedAt: new Date(),
  }).where(eq(contractCases.id, id));

  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.approved", resourceType: "contract_case", resourceId: id, metadata: { override: blocked && override } });
  return NextResponse.json({ ok: true, status: "approved" });
}
