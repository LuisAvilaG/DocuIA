import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { recheckAwaitingReceipt } from "@/lib/workflow/receipt-check";

type Params = { params: Promise<{ docId: string }> };

// Actions on a document waiting for its goods receipt:
//   { action: "check" }  — check the ERP now instead of waiting for the schedule
//   { action: "manual" } — stop waiting and send it to manual review
async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { docId } = await params;
  const id = Number(docId);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { action?: unknown };
  const doc = await db.query.historyDocuments.findFirst({
    where: and(eq(historyDocuments.id, id), eq(historyDocuments.organizationId, session.orgId)),
  });
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (doc.status !== "awaiting_receipt") return NextResponse.json({ error: "El documento ya no espera recepción" }, { status: 409 });

  if (body.action === "manual") {
    const moved = await db.update(historyDocuments)
      .set({ status: "review", nextReceiptCheckAt: null, errorMessage: "Pasado a revisión manual antes de completar la recepción", updatedAt: new Date() })
      .where(and(eq(historyDocuments.id, id), eq(historyDocuments.status, "awaiting_receipt")))
      .returning({ id: historyDocuments.id });
    if (!moved.length) return NextResponse.json({ error: "El documento cambió de estado. Recarga la página." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "review" });
  }

  if (body.action !== "check") return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  // Posting on receipt counts as the approval only when the person may approve.
  const result = await recheckAwaitingReceipt(doc, canApprove(session.role, "documents") ? session.sub : null);
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withApiSecurity(handlePOST);
