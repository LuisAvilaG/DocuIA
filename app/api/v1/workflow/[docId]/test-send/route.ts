import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { draftFromReviewBody, storedDraft, type NsDraft } from "@/lib/workflow/ns-payload";
import { sandboxTestSendAvailable, sendTestToSandbox, testSendsOf } from "@/lib/workflow/test-send";
import { logAudit } from "@/lib/audit/log";
import { clientIp } from "@/lib/security/request-ip";

type Params = { params: Promise<{ docId: string }> };

/**
 * Sends the document to the ERP sandbox as a test. Works on documents in
 * review (with the draft from the form) and on documents parked for approval
 * or receipt (with the stored draft). The document keeps its status.
 */
async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const gate = await sandboxTestSendAvailable(session.orgId);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { docId } = await params;
  const id = Number(docId);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const doc = await db.query.historyDocuments.findFirst({
    where: and(eq(historyDocuments.id, id), eq(historyDocuments.organizationId, session.orgId)),
  });
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (doc.documentType === "purchase_order") {
    return NextResponse.json({ error: "El envío de prueba solo aplica a facturas" }, { status: 422 });
  }

  let draft: NsDraft | null = null;
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && "line_items" in body) {
    const parsed = draftFromReviewBody(body);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    draft = parsed;
  } else {
    draft = storedDraft(doc.products);
  }
  if (!draft) return NextResponse.json({ error: "Este documento no tiene un borrador para enviar" }, { status: 422 });

  try {
    const sent = await sendTestToSandbox({ doc, draft, userId: session.sub });
    await logAudit({
      orgId: session.orgId, userId: session.sub, userEmail: session.email,
      action: "document.test_sent", resourceType: "document", resourceId: String(doc.id),
      metadata: { seq: sent.seq, internalId: sent.internalId, documentNumber: sent.documentNumber },
      ipAddress: clientIp(req.headers),
    });
    return NextResponse.json({ ok: true, sent, history: [...testSendsOf(doc.products), sent] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al enviar la prueba";
    console.error("[workflow/test-send]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const POST = withApiSecurity(handlePOST);
