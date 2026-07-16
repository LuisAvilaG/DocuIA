import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { processInNetSuite } from "@/lib/workflow/process-ns";
import { isFeatureEnabled } from "@/lib/features";
import { upsertItemMappings } from "@/lib/workflow/mappings";

type Params = { params: Promise<{ docId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { docId } = await params;
  const docIdNum = Number(docId);
  if (!Number.isFinite(docIdNum)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const doc = await db.query.historyDocuments.findFirst({
      where: and(
        eq(historyDocuments.id, docIdNum),
        eq(historyDocuments.organizationId, session.orgId)
      ),
    });

    if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

    // ── Pending approval flow (admin-only, uses saved payload) ────────────
    if (doc.status === "pending_approval") {
      if (session.role !== "admin") {
        return NextResponse.json({ error: "Se requiere rol de administrador" }, { status: 403 });
      }
      if (!doc.products) {
        return NextResponse.json({ error: "Payload no disponible" }, { status: 422 });
      }

      const uiPayload = doc.products as Record<string, unknown>;
      const document  = (uiPayload as any)?.document ?? {};
      const lines     = Array.isArray(document.lines) ? document.lines : [];

      const validLines = lines
        .filter((l: any) => l.selected_item_id)
        .map((l: any) => ({
          internal_id:        l.selected_item_id,
          item_document_name: l.description ?? "",
          quantity:           l.quantity ?? 0,
          rate:               l.rate ?? null,
          amount:             l.amount ?? null,
          unit:               l.selected_unit_id ?? null,
        }));

      if (!validLines.length) {
        return NextResponse.json({ error: "Sin líneas válidas para enviar" }, { status: 422 });
      }

      const sub = await db.query.subsidiaries.findFirst({
        where: eq(subsidiaries.id, doc.subsidiaryId),
      });
      if (!sub) {
        return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 422 });
      }

      const dryRun = await isFeatureEnabled(session.orgId, "netsuite_dry_run");

      await db.update(historyDocuments)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(historyDocuments.id, docIdNum));

      const nsPayload = {
        documentType:           doc.documentType,
        dry_run:                dryRun,
        subsidiary_internal_id: sub.nsSubsidiaryId,
        vendor_id:              document.vendor?.selected_internal_id ?? null,
        document_number:        document.invoice_number ?? null,
        date:                   document.invoice_date ?? "",
        due_date:               document.due_date ?? null,
        currency_internal_id:   document.currency ?? null,
        line_items:             validLines,
      };

      const nsResult = await processInNetSuite(session.orgId, nsPayload);

      const confirmedProducts = validLines.map((l: any) => ({
        description: l.item_document_name,
        quantity:    l.quantity,
        unitPrice:   l.rate,
        total:       l.amount,
        nsItemId:    l.internal_id,
        unit:        l.unit,
      }));

      await db.update(historyDocuments).set({
        status:        "completed",
        netsuiteDocId: nsResult.internalId ?? null,
        urlNetsuite:   nsResult.recordUrl ?? null,
        products:      confirmedProducts as unknown,
        approvedBy:    session.sub,
        updatedAt:     new Date(),
      }).where(eq(historyDocuments.id, docIdNum));

      void upsertItemMappings(
        validLines.map((l: any) => ({
          subsidiaryId:       doc.subsidiaryId,
          vendor:             doc.vendor ?? "",
          vendorItemName:     l.item_document_name,
          netsuiteInternalId: l.internal_id,
          netsuiteItemName:   null,
          netsuiteUnit:       l.unit ?? null,
          autoMap:            false,
        }))
      ).catch(() => {});

      return NextResponse.json({ ok: true, netsuiteId: nsResult.internalId, recordUrl: nsResult.recordUrl });
    }

    // ── Review flow (user provides edited line items) ─────────────────────
    if (doc.status !== "review") {
      return NextResponse.json(
        { error: `El documento está en estado "${doc.status}", no en revisión` },
        { status: 409 }
      );
    }

    const body = await req.json() as {
      vendor_internal_id:  string;
      vendor_name?:        string | null;
      invoice_number:      string | null;
      invoice_date:        string;
      due_date:            string | null;
      currency:            string;
      location_internal_id?: string | null;
      line_items: Array<{
        internal_id:        string;
        item_document_name: string;
        quantity:           number;
        rate:               number | null;
        amount:             number | null;
        unit:               string | null;
      }>;
    };

    if (!body.vendor_internal_id) {
      return NextResponse.json({ error: "Selecciona un proveedor de NetSuite" }, { status: 400 });
    }
    const validLines = body.line_items?.filter((l) => l.internal_id) ?? [];
    if (!validLines.length) {
      return NextResponse.json({ error: "Se requiere al menos una línea con ítem de NetSuite" }, { status: 400 });
    }

    const sub = await db.query.subsidiaries.findFirst({
      where: eq(subsidiaries.id, doc.subsidiaryId),
    });
    if (!sub) {
      return NextResponse.json(
        { error: `Subsidiaria ${doc.subsidiaryId} no encontrada` },
        { status: 422 }
      );
    }

    const dryRun = await isFeatureEnabled(session.orgId, "netsuite_dry_run");

    await db.update(historyDocuments)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(historyDocuments.id, docIdNum));

    const nsPayload = {
      documentType:           doc.documentType,
      dry_run:                dryRun,
      subsidiary_internal_id: sub.nsSubsidiaryId,
      vendor_id:              body.vendor_internal_id,
      document_number:        body.invoice_number,
      date:                   body.invoice_date,
      due_date:               body.due_date,
      currency_internal_id:   body.currency,
      location_internal_id:   body.location_internal_id ?? null,
      external_id:            `docuia:${session.orgId}:${docIdNum}`,
      line_items:             validLines,
    };

    const nsResult = await processInNetSuite(session.orgId, nsPayload);

    const confirmedProducts = validLines.map((l) => ({
      description: l.item_document_name,
      quantity:    l.quantity,
      unitPrice:   l.rate,
      total:       l.amount,
      nsItemId:    l.internal_id,
      unit:        l.unit,
    }));

    const resolvedVendorName = body.vendor_name ?? doc.vendor ?? null;

    await db.update(historyDocuments).set({
      status:        "completed",
      vendor:        resolvedVendorName,
      netsuiteDocId: nsResult.internalId ?? null,
      urlNetsuite:   nsResult.recordUrl ?? null,
      products:      confirmedProducts as unknown,
      approvedBy:    session.sub,
      updatedAt:     new Date(),
    }).where(eq(historyDocuments.id, docIdNum));

    void upsertItemMappings(
      validLines.map((l) => ({
        subsidiaryId:       doc.subsidiaryId,
        vendor:             resolvedVendorName ?? "",
        vendorItemName:     l.item_document_name,
        netsuiteInternalId: l.internal_id,
        netsuiteItemName:   null,
        netsuiteUnit:       l.unit ?? null,
        autoMap:            false,
      }))
    ).catch(() => {});

    return NextResponse.json({ ok: true, netsuiteId: nsResult.internalId, recordUrl: nsResult.recordUrl });

  } catch (err) {
    console.error("[workflow/approve]", err);
    const message = err instanceof Error ? err.message : "Error interno del servidor";
    await db.update(historyDocuments)
      .set({ status: "review", errorMessage: message, updatedAt: new Date() })
      .where(and(
        eq(historyDocuments.id, docIdNum),
        eq(historyDocuments.organizationId, session.orgId),
        eq(historyDocuments.status, "processing")
      )).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
