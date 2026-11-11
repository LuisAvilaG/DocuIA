import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { getFeature } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { createUploadLink } from "@/lib/contracts/upload-links";

/** Genera un enlace nuevo para el contratista (anula el anterior) y lo devuelve para copiarlo. */
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "contracts")) return NextResponse.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  const feature = await getFeature(session.orgId, "contract_document_requests").catch(() => null);
  if (!feature?.isEnabled) return NextResponse.json({ error: "Pedir documentos no está activo para tu empresa." }, { status: 403 });

  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({ where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)), columns: { status: true, resultJson: true } });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.status !== "awaiting_documents") return NextResponse.json({ error: "El caso no está esperando documentos." }, { status: 409 });
  const request = (kase.resultJson as { documentRequest?: { reason?: string; documents?: string[] } } | null)?.documentRequest;

  const link = await createUploadLink({ orgId: session.orgId, caseId: id, userId: session.sub, documents: request?.documents ?? [], reason: request?.reason ?? "", days: Number(feature.config.link_days) || undefined });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.upload_link_created", resourceType: "contract_case", resourceId: id, metadata: { expiresAt: link.expiresAt.toISOString() } });
  return NextResponse.json({ ok: true, url: link.url, expiresAt: link.expiresAt.toISOString() });
}

export const POST = withApiSecurity(handlePOST);
