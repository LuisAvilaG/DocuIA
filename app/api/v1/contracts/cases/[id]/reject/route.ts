import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden rechazar" }, { status: 403 });
  const { id } = await params;

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true, resultJson: true },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Escribe un motivo para rechazar el caso." }, { status: 400 });

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  await db.update(contractCases).set({
    status: "rejected",
    resultJson: { ...prev, decision: { action: "reject", reason, byId: session.sub, byEmail: session.email, at: new Date().toISOString() } },
    updatedAt: new Date(),
  }).where(eq(contractCases.id, id));

  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.rejected", resourceType: "contract_case", resourceId: id });
  return NextResponse.json({ ok: true, status: "rejected" });
}
