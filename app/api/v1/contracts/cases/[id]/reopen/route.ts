import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";
import { isFeatureEnabled } from "@/lib/features";

// Reopen a decided case back to review, keeping the prior decision in history.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden reabrir" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_approval_workflow")) {
    return NextResponse.json({ error: "La aprobación de contratos no está habilitada para este cliente." }, { status: 403 });
  }
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true, status: true, resultJson: true },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.status !== "approved" && kase.status !== "rejected" && kase.status !== "generated") {
    return NextResponse.json({ error: "Solo se puede reabrir un caso ya decidido." }, { status: 400 });
  }

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  const decision = prev.decision ? [...((prev.decisionHistory as unknown[]) ?? []), prev.decision] : (prev.decisionHistory ?? []);
  const { outputKey, missing, generatedAt, ...resultWithoutCurrentOutput } = prev;
  const outputHistory = outputKey
    ? [...((prev.outputHistory as unknown[]) ?? []), { outputKey, missing: missing ?? [], generatedAt: generatedAt ?? null }]
    : prev.outputHistory ?? [];
  await db.update(contractCases).set({
    status: "validated",
    // A document produced before reopening is no longer the current output.
    // Keep an audit reference, but require a fresh approval and generation.
    resultJson: { ...resultWithoutCurrentOutput, decision: null, decisionHistory: decision, outputHistory },
    updatedAt: new Date(),
  }).where(eq(contractCases.id, id));

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.reopened", resourceType: "contract_case", resourceId: id });
  return NextResponse.json({ ok: true, status: "validated" });
}
