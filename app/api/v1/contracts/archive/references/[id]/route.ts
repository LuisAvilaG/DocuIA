import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchiveReferences } from "@/db/schema";
import { withApiSecurity } from "@/lib/security/http";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { normalizeReferenceCode } from "@/lib/contracts/reference-codes";
import { syncArchiveCases } from "@/lib/contracts/archive-case-sync";

async function handlePATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  const reference = await db.query.contractArchiveReferences.findFirst({ where: and(eq(contractArchiveReferences.id, id), eq(contractArchiveReferences.organizationId, session.orgId)) });
  if (!reference) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const source = await db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.id, reference.sourceDocumentId), eq(contractArchiveDocuments.organizationId, session.orgId)) });
  if (!source || source.status === "removed") return NextResponse.json({ error: "Documento no disponible" }, { status: 404 });
  const body = await req.json() as { status?: unknown; targetDocumentId?: unknown; targetCode?: unknown; note?: unknown };
  if (body.status !== "confirmed" && body.status !== "rejected") return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  let targetDocumentId = reference.targetDocumentId;
  if (typeof body.targetDocumentId === "string") {
    const target = await db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.id, body.targetDocumentId), eq(contractArchiveDocuments.organizationId, session.orgId)) });
    if (!target || target.status !== "ready" || target.id === reference.sourceDocumentId) return NextResponse.json({ error: "Documento destino inválido" }, { status: 400 });
    targetDocumentId = target.id;
  }
  if (typeof body.targetCode === "string" && body.targetCode.trim()) {
    const candidates = await db.query.contractArchiveDocuments.findMany({ where: and(eq(contractArchiveDocuments.organizationId, session.orgId), eq(contractArchiveDocuments.normalizedCode, normalizeReferenceCode(body.targetCode)), eq(contractArchiveDocuments.status, "ready")), limit: 2 });
    if (candidates.length !== 1 || candidates[0].id === reference.sourceDocumentId) return NextResponse.json({ error: "El código no identifica un único documento origen" }, { status: 400 });
    targetDocumentId = candidates[0].id;
  }
  if (body.status === "confirmed" && !targetDocumentId) return NextResponse.json({ error: "Selecciona un documento destino" }, { status: 400 });
  await db.update(contractArchiveReferences).set({ status: body.status, targetDocumentId, reason: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : reference.reason, reviewedBy: session.sub, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(contractArchiveReferences.id, id));
  await syncArchiveCases([reference.sourceDocumentId]);
  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.archive_reference_reviewed", resourceType: "contract_archive_reference", resourceId: id, metadata: { status: body.status, targetDocumentId } });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiSecurity(handlePATCH);
