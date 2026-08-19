import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { contractExtractionLearnings } from "@/db/schema";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden retirar aprendizajes." }, { status: 403 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Aprendizaje inválido." }, { status: 400 });

  const [learning] = await db.update(contractExtractionLearnings)
    .set({ isActive: false })
    .where(and(eq(contractExtractionLearnings.id, id), eq(contractExtractionLearnings.organizationId, session.orgId)))
    .returning({ id: contractExtractionLearnings.id });
  if (!learning) return NextResponse.json({ error: "Aprendizaje no encontrado." }, { status: 404 });
  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.extraction_learning_retired", resourceType: "contract_extraction_learning", resourceId: String(id) });
  return NextResponse.json({ ok: true });
}
