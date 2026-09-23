import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { catalogVendors, historyDocuments, subsidiaries, vendorRules } from "@/db/schema";
import { getActiveNsConnection, nsCredentials } from "@/lib/netsuite/connection";
import { fetchOpenPurchaseOrders } from "@/lib/netsuite/client";
import { comparePurchaseOrder, effectivePoConfig, loadFeatureFlags, requiresReceipt, type ApFeatureFlags } from "@/lib/workflow/ap-checks";
import { parsePoMatchConfig, poOutcome, suggestPurchaseOrders } from "@/lib/workflow/po-match";
import { parseVendorRuleConfig, resolveVendorRule } from "@/lib/workflow/vendor-rules";
import type { UiPayload } from "@/lib/workflow/types";

// Review screen helper: open POs + suggestions for the chosen vendor (GET) and
// the invoice ↔ PO comparison for the PO and lines currently on screen (POST).

type Params = { params: Promise<{ docId: string }> };

async function context(req: NextRequest, docId: string) {
  const session = await getTenantSession({ area: "documents" });
  if (!session) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  const id = Number(docId);
  if (!Number.isSafeInteger(id)) return { error: NextResponse.json({ error: "ID inválido" }, { status: 400 }) };
  const flags = await loadFeatureFlags(session.orgId);
  if (!flags.isEnabled("po_matching")) {
    return { error: NextResponse.json({ error: "La conciliación con OC no está activa" }, { status: 403 }) };
  }
  const doc = await db.query.historyDocuments.findFirst({
    where: and(eq(historyDocuments.id, id), eq(historyDocuments.organizationId, session.orgId)),
  });
  if (!doc) return { error: NextResponse.json({ error: "Documento no encontrado" }, { status: 404 }) };
  return { session, doc, flags };
}

async function ruleFor(orgId: string, subsidiaryId: string, vendorId: string, flags: ApFeatureFlags) {
  if (!flags.isEnabled("vendor_rules")) return null;
  const [rules, vendor] = await Promise.all([
    db.query.vendorRules.findMany({ where: eq(vendorRules.organizationId, orgId) }),
    db.query.catalogVendors.findFirst({
      where: and(eq(catalogVendors.subsidiaryId, subsidiaryId), eq(catalogVendors.internalId, vendorId)),
      columns: { categoryId: true },
    }),
  ]);
  return resolveVendorRule(rules, { internalId: vendorId, categoryId: vendor?.categoryId ?? null }, parseVendorRuleConfig({}));
}

async function handleGET(req: NextRequest, { params }: Params) {
  const ctx = await context(req, (await params).docId);
  if (ctx.error) return ctx.error;
  const { session, doc, flags } = ctx;

  const vendorId = req.nextUrl.searchParams.get("vendorId")?.trim() ?? "";
  if (!/^\d+$/.test(vendorId)) return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });

  const [sub, conn, rule] = await Promise.all([
    db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, doc.subsidiaryId), eq(subsidiaries.organizationId, session.orgId)),
      columns: { nsSubsidiaryId: true },
    }),
    getActiveNsConnection(session.orgId),
    ruleFor(session.orgId, doc.subsidiaryId, vendorId, flags),
  ]);
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });
  if (!conn?.catalogScriptId || !conn.catalogDeployId) {
    return NextResponse.json({ error: "No hay script de catálogo del ERP configurado" }, { status: 422 });
  }

  const cfg = effectivePoConfig(parsePoMatchConfig(flags.getConfig("po_matching")), rule);
  const open = await fetchOpenPurchaseOrders(nsCredentials(conn), conn.catalogScriptId, conn.catalogDeployId, sub.nsSubsidiaryId, vendorId);
  if (!open.ok) return NextResponse.json({ error: open.error ?? "No se pudieron consultar las OC abiertas" }, { status: 502 });

  const payload = (doc.products ?? {}) as Partial<UiPayload>;
  const total = Number(payload.document?.totals?.total ?? doc.total ?? 0) || 0;
  const openPurchaseOrders = open.data ?? [];
  return NextResponse.json({
    openPurchaseOrders,
    suggestions: suggestPurchaseOrders({ poNumber: payload.document?.purchase_order ?? null, total }, openPurchaseOrders, cfg),
    vendorRule: rule,
    requireReceipt: requiresReceipt(flags, rule),
    tolerance: { price: cfg.priceTolerancePct, qty: cfg.qtyTolerancePct, totalType: cfg.totalToleranceType, total: cfg.totalToleranceValue },
  });
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const ctx = await context(req, (await params).docId);
  if (ctx.error) return ctx.error;
  const { session, doc, flags } = ctx;

  const body = await req.json().catch(() => null) as { po_internal_id?: unknown; vendor_internal_id?: unknown; line_items?: unknown } | null;
  const poId = typeof body?.po_internal_id === "string" ? body.po_internal_id.trim() : "";
  const vendorId = typeof body?.vendor_internal_id === "string" ? body.vendor_internal_id.trim() : "";
  if (!/^\d+$/.test(poId)) return NextResponse.json({ error: "OC inválida" }, { status: 400 });
  const rawLines = Array.isArray(body?.line_items) ? body.line_items.slice(0, 500) as Record<string, unknown>[] : [];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const lines = rawLines.map((l, index) => ({
    index,
    description: typeof l.item_document_name === "string" ? l.item_document_name.slice(0, 500) : "",
    itemId: typeof l.internal_id === "string" && l.internal_id ? l.internal_id : null,
    quantity: num(l.quantity) ?? 0,
    rate: num(l.rate),
    amount: num(l.amount),
  }));

  const rule = /^\d+$/.test(vendorId) ? await ruleFor(session.orgId, doc.subsidiaryId, vendorId, flags) : null;
  const cfg = effectivePoConfig(parsePoMatchConfig(flags.getConfig("po_matching")), rule);
  const payload = (doc.products ?? {}) as Partial<UiPayload>;
  const total = Number(payload.document?.totals?.total ?? doc.total ?? 0) || 0;
  const { comparison, error } = await comparePurchaseOrder(session.orgId, poId, lines, total, cfg, requiresReceipt(flags, rule));
  if (!comparison) return NextResponse.json({ error: error ?? "No se pudo comparar con la OC" }, { status: 502 });
  return NextResponse.json({ comparison, outcome: poOutcome(comparison, cfg) });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
