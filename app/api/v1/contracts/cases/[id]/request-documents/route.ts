import { orgTimeZone } from "@/lib/org-time-zone";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { contractCases, contractDocTypes, contractDocuments, contractUploadLinks } from "@/db/schema";
import { loadCasePlan } from "@/lib/contracts/plan";
import { getFeature } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/send";
import { buildRequestEmail, isEmail, suggestContractorEmail } from "@/lib/contracts/document-requests";
import { createUploadLink } from "@/lib/contracts/upload-links";

type Params = { params: Promise<{ id: string }> };

async function load(orgId: string, id: string) {
  return db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, orgId)),
    columns: { id: true, title: true, status: true, contractorEmail: true, resultJson: true, organizationId: true, flowId: true },
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
  // The names of the case's own flow first: a flow built in the editor has no
  // rows in the type table, and the contractor received internal keys instead.
  const plan = await loadCasePlan(kase).catch(() => null);
  const typeName = new Map([...types.map((t) => [t.key, t.name] as const), ...(plan?.docTypes ?? []).map((t) => [t.key, t.name] as const)]);
  const nameOf = (d: { detectedType: string | null; originalName: string | null }) =>
    (d.detectedType && d.detectedType !== "unknown" ? typeName.get(d.detectedType) : null) ?? d.originalName ?? "Documento";
  const fromContract = suggestContractorEmail(docs.map((d) => ({ values: (d.extractedJson ?? {}) as Record<string, unknown> })));
  return NextResponse.json({
    enabled: true,
    email: kase.contractorEmail ?? fromContract,
    emailSource: kase.contractorEmail ? "case" : fromContract ? "contract" : null,
    documents: [...new Set(docs.map(nameOf))],
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

  // Primero se toma el caso: si otra decisión ganó la carrera, no sale ningún
  // correo ni se anula el enlace que ya tenía el contratista.
  const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
  const request = { to: email, reason, documents, message, byId: session.sub, byEmail: session.email, at: new Date().toISOString(), emailSent: false, linkExpiresAt: null as string | null };
  const updated = await db.update(contractCases).set({
    status: "awaiting_documents",
    contractorEmail: email,
    resultJson: { ...prev, documentRequest: request, documentRequests: [...(Array.isArray(prev.documentRequests) ? prev.documentRequests : []), request] },
    updatedAt: new Date(),
  }).where(and(eq(contractCases.id, id), eq(contractCases.status, "validated"))).returning({ id: contractCases.id });
  if (!updated.length) return NextResponse.json({ error: "El caso cambió mientras lo revisabas. Recarga la página." }, { status: 409 });

  const title = kase.title ?? "Caso";
  // Enlace para que el contratista suba lo pedido sin cuenta (vence y sirve una vez).
  const link = feature.config.upload_link === false ? null
    : await createUploadLink({ orgId: session.orgId, caseId: id, userId: session.sub, documents, reason, days: Number(feature.config.link_days) || undefined });
  const mail = buildRequestEmail({
    uploadUrl: link?.url ?? null, expiresAt: link?.expiresAt ?? null,
    template: typeof feature.config.email_template === "string" ? feature.config.email_template : null,
    senderName: typeof feature.config.sender_name === "string" ? feature.config.sender_name : null,
    caseTitle: title, message, reason, documents, timeZone: await orgTimeZone(session.orgId),
  });
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html });

  // El resultado del envío se anota en la solicitud recién guardada, sobre el valor actual del caso.
  const outcome = { emailSent: sent.ok, linkExpiresAt: link?.expiresAt.toISOString() ?? null };
  const mark = (r: unknown) => (r && typeof r === "object" && (r as { at?: unknown }).at === request.at ? { ...r, ...outcome } : r);
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ resultJson: contractCases.resultJson }).from(contractCases).where(eq(contractCases.id, id)).for("update");
    if (!current) return;
    const stored = (current.resultJson ?? {}) as Record<string, unknown>;
    await tx.update(contractCases).set({
      resultJson: { ...stored, documentRequest: mark(stored.documentRequest), ...(Array.isArray(stored.documentRequests) ? { documentRequests: stored.documentRequests.map(mark) } : {}) },
    }).where(eq(contractCases.id, id));
  });

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.documents_requested", resourceType: "contract_case", resourceId: id, metadata: { reason, documents, emailSent: sent.ok } });
  return NextResponse.json({ ok: true, status: "awaiting_documents", emailSent: sent.ok, uploadUrl: link?.url ?? null });
}

/** Cancela una solicitud enviada por error: el enlace deja de servir y el caso vuelve a «Por decidir». */
async function handleDELETE(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "contracts")) return NextResponse.json({ error: "No tienes permiso para decidir casos" }, { status: 403 });
  const { id } = await params;
  const now = new Date();
  const cancelled = await db.transaction(async (tx) => {
    const [kase] = await tx.select({ status: contractCases.status, resultJson: contractCases.resultJson }).from(contractCases)
      .where(and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId))).for("update");
    if (!kase) return "not_found" as const;
    if (kase.status !== "awaiting_documents") return "not_waiting" as const;
    const result = (kase.resultJson ?? {}) as Record<string, unknown>;
    const current = result.documentRequest as { at?: unknown } | undefined;
    const mark = (r: unknown) => (r && typeof r === "object" && (r as { at?: unknown }).at === current?.at ? { ...r, cancelledAt: now.toISOString(), cancelledByEmail: session.email } : r);
    // The request stays in the case's history; it just is no longer the open one.
    const { documentRequest: _open, ...rest } = result;
    void _open;
    await tx.update(contractCases).set({
      status: "validated",
      resultJson: { ...rest, ...(Array.isArray(result.documentRequests) ? { documentRequests: result.documentRequests.map(mark) } : {}) },
      updatedAt: now,
    }).where(eq(contractCases.id, id));
    await tx.update(contractUploadLinks).set({ revokedAt: now })
      .where(and(eq(contractUploadLinks.caseId, id), isNull(contractUploadLinks.usedAt), isNull(contractUploadLinks.revokedAt)));
    return "ok" as const;
  });
  if (cancelled === "not_found") return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (cancelled === "not_waiting") return NextResponse.json({ error: "El caso ya no está esperando documentos. Recarga la página." }, { status: 409 });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.documents_request_cancelled", resourceType: "contract_case", resourceId: id });
  return NextResponse.json({ ok: true, status: "validated" });
}

export const GET = withApiSecurity(handleGET);
export const DELETE = withApiSecurity(handleDELETE);
export const POST = withApiSecurity(handlePOST);
