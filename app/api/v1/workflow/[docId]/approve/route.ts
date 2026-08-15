import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments, nsConnections, organizations, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { processInNetSuite } from "@/lib/workflow/process-ns";
import { isFeatureEnabled, getFeature } from "@/lib/features";
import { upsertItemMappings } from "@/lib/workflow/mappings";
import { resolveCustomFormId } from "@/lib/netsuite/custom-forms";
import { fetchOpenPurchaseOrders } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import { decryptField } from "@/lib/crypto/encrypt";

type Params = { params: Promise<{ docId: string }> };

type PendingApprovalLine = {
  selected_item_id?: unknown;
  selected_unit_id?: unknown;
  description?: unknown;
  quantity?: unknown;
  rate?: unknown;
  amount?: unknown;
};

type PendingApprovalDocument = {
  vendor?: { selected_internal_id?: unknown };
  invoice_number?: unknown;
  invoice_date?: unknown;
  due_date?: unknown;
  currency?: unknown;
  lines?: PendingApprovalLine[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function pendingDocument(value: unknown): PendingApprovalDocument {
  if (!isRecord(value) || !isRecord(value.document)) return {};
  const document = value.document;
  return {
    vendor: isRecord(document.vendor) ? document.vendor : undefined,
    invoice_number: document.invoice_number,
    invoice_date: document.invoice_date,
    due_date: document.due_date,
    currency: document.currency,
    lines: Array.isArray(document.lines)
      ? document.lines.filter(isRecord)
      : [],
  };
}

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

    // Custom NetSuite form configured by the admin for this org. Localization
    // forms (e.g. CFDI) carry defaults for otherwise-mandatory fields, so this
    // must travel with the manual-approve flow too — not only the auto pipeline.
    // The configuration is retained when the feature is turned off, but must
    // only affect NetSuite requests while the feature itself is enabled.
    const [formsFeat, autoMappingFeat] = await Promise.all([
      getFeature(session.orgId, "custom_netsuite_forms"),
      getFeature(session.orgId, "auto_mapping"),
    ]);
    const customFormId = formsFeat.isEnabled
      ? resolveCustomFormId(formsFeat.config, doc.subsidiaryId, doc.documentType)
      : "";

    // ── Pending approval flow (admin-only, uses saved payload) ────────────
    if (doc.status === "pending_approval") {
      if (session.role !== "admin") {
        return NextResponse.json({ error: "Se requiere rol de administrador" }, { status: 403 });
      }
      if (!doc.products) {
        return NextResponse.json({ error: "Payload no disponible" }, { status: 422 });
      }

      const document = pendingDocument(doc.products);
      const lines = document.lines ?? [];

      const validLines = lines
        .map((l) => ({
          internal_id:        asString(l.selected_item_id),
          item_document_name: asString(l.description) ?? "",
          quantity:           l.quantity ?? 0,
          rate:               l.rate ?? null,
          amount:             l.amount ?? null,
          unit:               asString(l.selected_unit_id),
        }))
        .filter((l): l is Omit<typeof l, "internal_id"> & { internal_id: string } => Boolean(l.internal_id));

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
        vendor_id:              asString(document.vendor?.selected_internal_id),
        document_number:        asString(document.invoice_number),
        date:                   asString(document.invoice_date) ?? "",
        due_date:               asString(document.due_date),
        currency_internal_id:   asString(document.currency),
        customform_id:          customFormId || undefined,
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

      await db.update(historyDocuments).set({
        status:        "completed",
        netsuiteDocId: nsResult.internalId ?? null,
        urlNetsuite:   nsResult.recordUrl ?? null,
        products:      confirmedProducts as unknown,
        approvedBy:    session.sub,
        updatedAt:     new Date(),
      }).where(eq(historyDocuments.id, docIdNum));

      if (autoMappingFeat.isEnabled) void upsertItemMappings(
        validLines.map((l) => ({
          subsidiaryId:       doc.subsidiaryId,
          vendor:             doc.vendor ?? "",
          vendorItemName:     l.item_document_name,
          netsuiteInternalId: l.internal_id,
          netsuiteItemName:   null,
          netsuiteUnit:       l.unit ?? null,
          autoMap:            false,
        })),
        { mergeSimilarity: Number(autoMappingFeat.config.merge_similarity) },
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
      po_internal_id?: string | null;
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
    if (body.po_internal_id) {
      const poProcessingEnabled = await isFeatureEnabled(session.orgId, "po_processing");
      if (!poProcessingEnabled || doc.documentType !== "invoice") {
        return NextResponse.json({ error: "El procesamiento con PO no está habilitado para este documento" }, { status: 403 });
      }
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

    if (body.po_internal_id) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, session.orgId),
        columns: { activeNsEnvironment: true },
      });
      const environment = org?.activeNsEnvironment as "sandbox" | "production" | undefined;
      const connection = environment
        ? await db.query.nsConnections.findFirst({
            where: and(
              eq(nsConnections.organizationId, session.orgId),
              eq(nsConnections.environment, environment),
              eq(nsConnections.isActive, true),
            ),
          })
        : undefined;

      if (!connection?.catalogScriptId || !connection.catalogDeployId) {
        return NextResponse.json(
          { error: "No hay un catálogo de NetSuite configurado para validar la PO seleccionada" },
          { status: 422 }
        );
      }

      const credentials: NSCredentials = {
        accountId: connection.accountId,
        consumerKey: decryptField(connection.consumerKey),
        consumerSecret: decryptField(connection.consumerSecret),
        tokenId: decryptField(connection.tokenId),
        tokenSecret: decryptField(connection.tokenSecret),
      };
      const openPurchaseOrders = await fetchOpenPurchaseOrders(
        credentials,
        connection.catalogScriptId,
        connection.catalogDeployId,
        sub.nsSubsidiaryId,
        body.vendor_internal_id,
      );
      if (!openPurchaseOrders.ok) {
        return NextResponse.json(
          { error: `No se pudo validar la PO en NetSuite: ${openPurchaseOrders.error ?? "error desconocido"}` },
          { status: 502 }
        );
      }
      if (!openPurchaseOrders.data?.some((purchaseOrder) => purchaseOrder.internal_id === body.po_internal_id)) {
        return NextResponse.json(
          { error: "La PO elegida no está abierta o no corresponde al proveedor y subsidiaria seleccionados" },
          { status: 422 }
        );
      }
    }

    const [dryRun, poFeature] = await Promise.all([
      isFeatureEnabled(session.orgId, "netsuite_dry_run"),
      getFeature(session.orgId, "po_processing"),
    ]);
    const poConfig = poFeature.config as {
      apply_to_po_lines?: boolean;
      set_unselected_po_lines_to_zero?: boolean;
      allow_additional_lines?: boolean;
    };

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
      po_internal_id:         body.po_internal_id ?? null,
      apply_to_po_lines:      poConfig.apply_to_po_lines ?? true,
      set_unselected_po_lines_to_zero: poConfig.set_unselected_po_lines_to_zero ?? false,
      allow_additional_lines: poConfig.allow_additional_lines ?? true,
      customform_id:          customFormId || undefined,
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

    if (autoMappingFeat.isEnabled) void upsertItemMappings(
      validLines.map((l) => ({
        subsidiaryId:       doc.subsidiaryId,
        vendor:             resolvedVendorName ?? "",
        vendorItemName:     l.item_document_name,
        netsuiteInternalId: l.internal_id,
        netsuiteItemName:   null,
        netsuiteUnit:       l.unit ?? null,
        autoMap:            false,
      })),
      { mergeSimilarity: Number(autoMappingFeat.config.merge_similarity) },
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
