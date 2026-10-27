import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractArchiveDocuments } from "@/db/schema";
import { getFileStream } from "@/lib/storage/minio";
import { withApiSecurity, contentDisposition } from "@/lib/security/http";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { Readable } from "node:stream";

async function handleGET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  const doc = await db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.id, id), eq(contractArchiveDocuments.organizationId, session.orgId)) });
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new Response(Readable.toWeb(await getFileStream(doc.storageKey)) as ReadableStream, { headers: { "Content-Type": doc.mimeType, "Content-Disposition": contentDisposition("inline", doc.originalName), "Cache-Control": "private, no-store" } });
}

export const GET = withApiSecurity(handleGET);
