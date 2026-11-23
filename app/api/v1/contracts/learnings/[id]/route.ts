import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { contractExtractionLearnings } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

async function guard(params: Params["params"]) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (session.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores pueden cambiar aprendizajes." }, { status: 403 }) };
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) return { error: NextResponse.json({ error: "Aprendizaje inválido." }, { status: 400 }) };
  return { session, id };
}

/** Pausar o reactivar: el aprendizaje deja de usarse o vuelve a usarse en la extracción. */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("error" in g) return g.error;
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  if (body.action !== "pause" && body.action !== "resume") return NextResponse.json({ error: "Acción inválida." }, { status: 400 });

  const [learning] = await db.update(contractExtractionLearnings)
    .set({ isActive: body.action === "resume" })
    .where(and(eq(contractExtractionLearnings.id, g.id), eq(contractExtractionLearnings.organizationId, g.session.orgId), isNull(contractExtractionLearnings.retiredAt)))
    .returning({ id: contractExtractionLearnings.id });
  if (!learning) return NextResponse.json({ error: "Aprendizaje no encontrado." }, { status: 404 });
  await logAudit({ orgId: g.session.orgId, userId: g.session.sub, userEmail: g.session.email, action: body.action === "pause" ? "contract.extraction_learning_paused" : "contract.extraction_learning_resumed", resourceType: "contract_extraction_learning", resourceId: String(g.id) });
  return NextResponse.json({ ok: true, isActive: body.action === "resume" });
}

/** Retirar: deja de usarse y sale de la lista. No se puede deshacer desde la pantalla. */
async function handleDELETE(_request: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("error" in g) return g.error;
  const [learning] = await db.update(contractExtractionLearnings)
    .set({ isActive: false, retiredAt: new Date() })
    .where(and(eq(contractExtractionLearnings.id, g.id), eq(contractExtractionLearnings.organizationId, g.session.orgId), isNull(contractExtractionLearnings.retiredAt)))
    .returning({ id: contractExtractionLearnings.id });
  if (!learning) return NextResponse.json({ error: "Aprendizaje no encontrado." }, { status: 404 });
  await logAudit({ orgId: g.session.orgId, userId: g.session.sub, userEmail: g.session.email, action: "contract.extraction_learning_retired", resourceType: "contract_extraction_learning", resourceId: String(g.id) });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiSecurity(handlePATCH);
export const DELETE = withApiSecurity(handleDELETE);
