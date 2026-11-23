import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { enqueueContractCase } from "@/lib/queue";

/**
 * Vuelve a analizar un caso cuyo análisis no terminó (una caída del proveedor de
 * IA, por ejemplo), con los documentos que ya tiene: sin esto la única salida
 * era crear el caso otra vez y, si venía de una entrega del contratista, volver
 * a pedírsela.
 */
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_ai_extraction")) {
    return NextResponse.json({ error: "El análisis AI de contratos no está habilitado para este cliente." }, { status: 403 });
  }
  const { id } = await params;

  const documents = await db.$count(contractDocuments, eq(contractDocuments.caseId, id));
  // Only a failed case, and taken once: two clicks start one analysis.
  const taken = documents > 0
    ? await db.update(contractCases).set({ status: "uploaded", errorMessage: null, updatedAt: new Date() })
      .where(and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId), eq(contractCases.status, "failed")))
      .returning({ id: contractCases.id })
    : [];
  if (!taken.length) {
    const kase = await db.query.contractCases.findFirst({ where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)), columns: { status: true } });
    if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
    if (documents === 0) return NextResponse.json({ error: "El caso no tiene documentos que analizar. Crea el caso de nuevo." }, { status: 409 });
    return NextResponse.json({ error: "Solo se vuelve a analizar un caso cuyo análisis no terminó. Recarga la página." }, { status: 409 });
  }

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.reprocess_requested", resourceType: "contract_case", resourceId: id });
  await enqueueContractCase(id);
  return NextResponse.json({ ok: true, status: "uploaded" });
}

export const POST = withApiSecurity(handlePOST);
