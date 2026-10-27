import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchiveReferences } from "@/db/schema";
import { withApiSecurity } from "@/lib/security/http";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { registerUploadedArchiveDocument } from "@/lib/contracts/archive";
import { enqueueArchiveDocument } from "@/lib/queue";
import { logAudit } from "@/lib/audit/log";

async function authorized(permission: "read" | "write") {
  const session = await getTenantSession({ area: "contracts", permission });
  if (!session) return null;
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return null;
  return session;
}

async function handleGET(req: NextRequest) {
  const session = await authorized("read");
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = (req.nextUrl.searchParams.get("status") ?? "").trim();
  const where = and(eq(contractArchiveDocuments.organizationId, session.orgId), ne(contractArchiveDocuments.status, "removed"),
    query ? or(ilike(contractArchiveDocuments.documentCode, `%${query}%`), ilike(contractArchiveDocuments.originalName, `%${query}%`), ilike(contractArchiveDocuments.title, `%${query}%`)) : undefined,
    ["queued", "processing", "ready", "failed"].includes(status) ? eq(contractArchiveDocuments.status, status) : undefined);
  const documents = await db.query.contractArchiveDocuments.findMany({ where, orderBy: [desc(contractArchiveDocuments.createdAt)], limit: 100 });
  const referenceCounts = await Promise.all(documents.map(async (document) => {
    const references = await db.query.contractArchiveReferences.findMany({ where: eq(contractArchiveReferences.sourceDocumentId, document.id), columns: { status: true } });
    return { id: document.id, total: references.length, missing: references.filter((reference) => reference.status === "missing").length, review: references.filter((reference) => ["review", "ambiguous", "unrelated"].includes(reference.status)).length };
  }));
  const counts = new Map(referenceCounts.map((count) => [count.id, count]));
  return NextResponse.json({ documents: documents.map((document) => ({ ...document, references: counts.get(document.id) })) });
}

async function handlePOST(req: NextRequest) {
  const session = await authorized("write");
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json() as { uploadId?: unknown };
  if (typeof body.uploadId !== "string") return NextResponse.json({ error: "Carga inválida" }, { status: 400 });
  try {
    const id = await registerUploadedArchiveDocument({ organizationId: session.orgId, createdBy: session.sub, uploadId: body.uploadId });
    await enqueueArchiveDocument(id);
    await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.archive_uploaded", resourceType: "contract_archive_document", resourceId: id });
    return NextResponse.json({ id, status: "queued" }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al archivar" }, { status: 400 });
  }
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
