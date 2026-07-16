import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";

// Reopen a decided case back to review, keeping the prior decision in history.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden reabrir" }, { status: 403 });
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true, status: true, resultJson: true },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.status !== "approved" && kase.status !== "rejected") {
    return NextResponse.json({ error: "Solo se puede reabrir un caso ya decidido." }, { status: 400 });
  }

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  const decision = prev.decision ? [...((prev.decisionHistory as unknown[]) ?? []), prev.decision] : (prev.decisionHistory ?? []);
  await db.update(contractCases).set({
    status: "validated",
    resultJson: { ...prev, decision: null, decisionHistory: decision },
    updatedAt: new Date(),
  }).where(eq(contractCases.id, id));

  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.reopened", resourceType: "contract_case", resourceId: id });
  return NextResponse.json({ ok: true, status: "validated" });
}
