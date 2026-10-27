import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchiveReferences } from "@/db/schema";
import { normalizeReferenceCode } from "@/lib/contracts/reference-codes";
import { reconcileReference } from "@/lib/contracts/archive";
import { withApiSecurity } from "@/lib/security/http";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { syncArchiveCases } from "@/lib/contracts/archive-case-sync";

async function handlePOST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  const document = await db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.id, id), eq(contractArchiveDocuments.organizationId, session.orgId)) });
  if (!document || document.status !== "ready") return NextResponse.json({ error: "Documento no disponible" }, { status: 404 });
  const body = await req.json() as { code?: unknown; pageNumber?: unknown; context?: unknown };
  const rawCode = String(body.code ?? "").trim().slice(0, 160);
  const normalizedCode = normalizeReferenceCode(rawCode);
  const pageNumber = Number(body.pageNumber);
  const excerpt = String(body.context ?? "").trim().slice(0, 1500);
  if (normalizedCode.length < 5 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > (document.pageCount ?? 1) || !excerpt) return NextResponse.json({ error: "Indica código, página y contexto válidos" }, { status: 400 });
  if (normalizedCode === document.normalizedCode) return NextResponse.json({ error: "Una carta no puede referenciarse a sí misma" }, { status: 400 });
  const refId = randomUUID();
  const inserted = await db.insert(contractArchiveReferences).values({ id: refId, organizationId: session.orgId, sourceDocumentId: id, rawCode, normalizedCode, pageNumber, context: excerpt }).onConflictDoNothing().returning({ id: contractArchiveReferences.id });
  if (inserted.length === 0) return NextResponse.json({ error: "Esta referencia ya está registrada" }, { status: 409 });
  await reconcileReference(refId);
  await syncArchiveCases([id]);
  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.archive_reference_added", resourceType: "contract_archive_reference", resourceId: refId, metadata: { documentId: id, rawCode } });
  return NextResponse.json({ id: refId }, { status: 201 });
}

export const POST = withApiSecurity(handlePOST);
