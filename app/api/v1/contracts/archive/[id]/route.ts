import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchivePages, contractArchiveReferences } from "@/db/schema";
import { withApiSecurity } from "@/lib/security/http";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { normalizeReferenceCode, detectReferences } from "@/lib/contracts/reference-codes";
import { reconcileReference } from "@/lib/contracts/archive";
import { logAudit } from "@/lib/audit/log";
import { syncArchiveCases } from "@/lib/contracts/archive-case-sync";

async function getDocument(id: string, orgId: string) {
  return db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.id, id), eq(contractArchiveDocuments.organizationId, orgId)) });
}

async function handleGET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  const document = await getDocument(id, session.orgId);
  if (!document) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const references = await db.query.contractArchiveReferences.findMany({ where: eq(contractArchiveReferences.sourceDocumentId, id), orderBy: [contractArchiveReferences.pageNumber] });
  const targetIds = [...new Set(references.map((reference) => reference.targetDocumentId).filter((value): value is string => !!value))];
  const targets = await Promise.all(targetIds.map((targetId) => getDocument(targetId, session.orgId)));
  const targetNames = new Map(targets.filter((target): target is NonNullable<typeof target> => !!target).map((target) => [target.id, target]));
  return NextResponse.json({ document, references: references.map((reference) => ({ ...reference, target: reference.targetDocumentId ? targetNames.get(reference.targetDocumentId) ?? null : null })) });
}

async function handlePATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  const document = await getDocument(id, session.orgId);
  if (!document) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const body = await req.json() as { documentCode?: unknown; title?: unknown };
  const documentCode = typeof body.documentCode === "string" ? body.documentCode.trim().slice(0, 160) : document.documentCode;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 255) : document.title;
  await db.update(contractArchiveDocuments).set({ documentCode, normalizedCode: documentCode ? normalizeReferenceCode(documentCode) : null, title, updatedAt: new Date() }).where(eq(contractArchiveDocuments.id, id));
  if (documentCode !== document.documentCode && document.status === "ready") {
    const pages = await db.query.contractArchivePages.findMany({ where: eq(contractArchivePages.documentId, id), orderBy: [contractArchivePages.pageNumber] });
    // Preserve human decisions on existing links; only add newly discovered
    // citations and remove a false self-reference after correcting the code.
    for (const reference of detectReferences(pages, documentCode)) await db.insert(contractArchiveReferences).values({ id: randomUUID(), organizationId: session.orgId, sourceDocumentId: id, ...reference }).onConflictDoNothing();
    if (documentCode) await db.delete(contractArchiveReferences).where(and(eq(contractArchiveReferences.sourceDocumentId, id), eq(contractArchiveReferences.normalizedCode, normalizeReferenceCode(documentCode))));
    const own = await db.query.contractArchiveReferences.findMany({ where: eq(contractArchiveReferences.sourceDocumentId, id) });
    const inboundNew = documentCode ? await db.query.contractArchiveReferences.findMany({ where: and(eq(contractArchiveReferences.organizationId, session.orgId), eq(contractArchiveReferences.normalizedCode, normalizeReferenceCode(documentCode))) }) : [];
    const inboundOld = document.normalizedCode ? await db.query.contractArchiveReferences.findMany({ where: and(eq(contractArchiveReferences.organizationId, session.orgId), eq(contractArchiveReferences.normalizedCode, document.normalizedCode)) }) : [];
    for (const reference of [...own, ...inboundNew, ...inboundOld]) await reconcileReference(reference.id);
    await syncArchiveCases([...own, ...inboundNew, ...inboundOld].map((reference) => reference.sourceDocumentId));
  }
  await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.archive_metadata_updated", resourceType: "contract_archive_document", resourceId: id });
  return NextResponse.json({ ok: true });
}

export const GET = withApiSecurity(handleGET);
export const PATCH = withApiSecurity(handlePATCH);
