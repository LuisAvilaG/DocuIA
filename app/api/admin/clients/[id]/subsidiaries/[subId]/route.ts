import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import {
  subsidiaries, subsidiaryDocumentConfigs, catalogItems, catalogVendors, catalogLocations, itemMappings,
  historyDocuments, exceptionQueue,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string; subId: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, subId } = await params;
    const body = await req.json();

    const sub = await db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, subId), eq(subsidiaries.organizationId, organizationId)),
    });
    if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.nsSubsidiaryId === "string" && body.nsSubsidiaryId.trim()) updates.nsSubsidiaryId = body.nsSubsidiaryId.trim();
    if (typeof body.currency === "string" && body.currency.trim()) updates.currency = body.currency.trim().toUpperCase();
    if (typeof body.taxId === "string") {
      const taxId = body.taxId.toUpperCase().replace(/[^A-Z0-9&Ñ]/g, "").slice(0, 20);
      updates.taxId = taxId || null;
    }
    if (typeof body.locale === "string") updates.locale = body.locale.trim() || null;
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;

    await db.update(subsidiaries).set(updates).where(eq(subsidiaries.id, subId));
    await logAdminAction(req, session!, { action: "subsidiary.updated", targetOrgId: organizationId, after: { name: (updates.name as string) ?? sub.name, ...updates } });

    const fresh = await db.query.subsidiaries.findFirst({ where: eq(subsidiaries.id, subId) });
    return NextResponse.json({ ok: true, subsidiary: fresh });
  } catch (err) {
    console.error("[clients/subsidiaries PATCH]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/**
 * Removes a subsidiary together with its catalogs and mappings. Refused while
 * documents still reference it: deactivate it instead, so history stays whole.
 */
async function handleDELETE(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, subId } = await params;

    const sub = await db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, subId), eq(subsidiaries.organizationId, organizationId)),
    });
    if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });

    const [docs, exceptions] = await Promise.all([
      db.$count(historyDocuments, eq(historyDocuments.subsidiaryId, subId)),
      db.$count(exceptionQueue, eq(exceptionQueue.subsidiaryId, subId)),
    ]);
    if (docs > 0 || exceptions > 0) {
      return NextResponse.json({
        error: `La subsidiaria tiene ${docs} documento${docs === 1 ? "" : "s"} y ${exceptions} excepción${exceptions === 1 ? "" : "es"} asociados. Desactívala en lugar de eliminarla.`,
        documents: docs, exceptions,
      }, { status: 409 });
    }

    const removed = await db.transaction(async (tx) => {
      const [items, vendors, locations, mappings] = await Promise.all([
        tx.delete(catalogItems).where(eq(catalogItems.subsidiaryId, subId)),
        tx.delete(catalogVendors).where(eq(catalogVendors.subsidiaryId, subId)),
        tx.delete(catalogLocations).where(eq(catalogLocations.subsidiaryId, subId)),
        tx.delete(itemMappings).where(eq(itemMappings.subsidiaryId, subId)),
      ]);
      await tx.delete(subsidiaryDocumentConfigs).where(eq(subsidiaryDocumentConfigs.subsidiaryId, subId));
      await tx.delete(subsidiaries).where(eq(subsidiaries.id, subId));
      const n = (r: unknown) => (r as { rowCount?: number }).rowCount ?? 0;
      return { items: n(items), vendors: n(vendors), locations: n(locations), mappings: n(mappings) };
    });

    await logAdminAction(req, session!, { action: "subsidiary.deleted", targetOrgId: organizationId, before: { name: sub.name, nsSubsidiaryId: sub.nsSubsidiaryId }, after: removed });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    console.error("[clients/subsidiaries DELETE]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export const PATCH = withApiSecurity(handlePATCH);
export const DELETE = withApiSecurity(handleDELETE);
