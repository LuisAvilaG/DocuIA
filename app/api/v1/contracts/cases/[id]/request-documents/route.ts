import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { contractCases, contractDocTypes, contractDocuments } from "@/db/schema";
import { getFeature } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/send";
import { buildRequestEmail, isEmail, suggestContractorEmail } from "@/lib/contracts/document-requests";
import { createUploadLink } from "@/lib/contracts/upload-links";

type Params = { params: Promise<{ id: string }> };

async function load(orgId: string, id: string) {
  return db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, orgId)),
    columns: { id: true, title: true, status: true, contractorEmail: true, resultJson: true },
  });
}

/** Datos para el diálogo: si la función está activa, el correo sugerido y los documentos del caso. */
async function handleGET(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const feature = await getFeature(session.orgId, "contract_document_requests").catch(() => null);
  if (!feature?.isEnabled) return NextResponse.json({ enabled: false });
  const { id } = await params;
  const kase = await load(session.orgId, id);
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  const [docs, types] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id), columns: { detectedType: true, originalName: true, extractedJson: true } }),
    db.query.contractDocTypes.findMany({ where: eq(contractDocTypes.organizationId, session.orgId), columns: { key: true, name: true } }),
  ]);
  const typeName = new Map(types.map((t) => [t.key, t.name]));
  const fromContract = suggestContractorEmail(docs.map((d) => ({ values: (d.extractedJson ?? {}) as Record<string, unknown> })));
  return NextResponse.json({
    enabled: true,
    email: kase.contractorEmail ?? fromContract,
    emailSource: kase.contractorEmail ? "case" : fromContract ? "contract" : null,
    documents: [...new Set(docs.map((d) => (d.detectedType ? typeName.get(d.detectedType) ?? d.detectedType : d.originalName ?? "Documento")))],
  });
}

/** Pide documentos corregidos: correo al contratista y el caso queda «Esperando documentos». */
async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "contracts")) return NextResponse.json({ error: "No tienes permiso para decidir casos" }, { status: 403 });
  const feature = await getFeature(session.orgId, "contract_document_requests").catch(() => null);
  if (!feature?.isEnabled) return NextResponse.json({ error: "Pedir documentos no está activo para tu empresa." }, { status: 403 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as { email?: unknown; reason?: unknown; documents?: unknown; message?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const documents = Array.isArray(body.documents) ? body.documents.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim().slice(0, 200)).slice(0, 20) : [];
  if (!isEmail(email)) return NextResponse.json({ error: "Escribe un correo válido para el contratista." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "Escribe el motivo." }, { status: 400 });

  const kase = await load(session.orgId, id);
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.status !== "validated") return NextResponse.json({ error: "Solo se piden documentos de un caso por decidir." }, { status: 409 });

  const title = kase.title ?? "Caso";
  // Enlace para que el contratista suba lo pedido sin cuenta (vence y sirve una vez).
  const link = feature.config.upload_link === false ? null
    : await createUploadLink({ orgId: session.orgId, caseId: id, userId: session.sub, documents, reason, days: Number(feature.config.link_days) || undefined });
  const mail = buildRequestEmail({
    uploadUrl: link?.url ?? null, expiresAt: link?.expiresAt ?? null,
    template: typeof feature.config.email_template === "string" ? feature.config.email_template : null,
    senderName: typeof feature.config.sender_name === "string" ? feature.config.sender_name : null,
    caseTitle: title, message, reason, documents,
  });
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html });

  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  const request = { to: email, reason, documents, message, byId: session.sub, byEmail: session.email, at: new Date().toISOString(), emailSent: sent.ok, linkExpiresAt: link?.expiresAt.toISOString() ?? null };
  const updated = await db.update(contractCases).set({
    status: "awaiting_documents",
    contractorEmail: email,
    resultJson: { ...prev, documentRequest: request, documentRequests: [...(Array.isArray(prev.documentRequests) ? prev.documentRequests : []), request] },
    updatedAt: new Date(),
  }).where(and(eq(contractCases.id, id), eq(contractCases.status, "validated"))).returning({ id: contractCases.id });
  if (!updated.length) return NextResponse.json({ error: "El caso cambió mientras lo revisabas. Recarga la página." }, { status: 409 });

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.documents_requested", resourceType: "contract_case", resourceId: id, metadata: { reason, documents, emailSent: sent.ok } });
  return NextResponse.json({ ok: true, status: "awaiting_documents", emailSent: sent.ok, uploadUrl: link?.url ?? null });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
