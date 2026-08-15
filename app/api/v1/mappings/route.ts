import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { getFeature } from "@/lib/features";
import { db } from "@/lib/db";
import { itemMappings, subsidiaries } from "@/db/schema";
import { normalizeForLookup } from "@/lib/workflow/similarity";
import { logAudit } from "@/lib/audit/log";

type MappingInput = {
  subsidiaryId?: unknown;
  vendor?: unknown;
  vendorItemName?: unknown;
  netsuiteInternalId?: unknown;
  netsuiteItemName?: unknown;
  netsuiteUnit?: unknown;
};

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return text(value, maxLength);
}

function parseInput(body: MappingInput) {
  const subsidiaryId = text(body.subsidiaryId, 36);
  const vendor = text(body.vendor, 191);
  const vendorItemName = text(body.vendorItemName, 512);
  const netsuiteInternalId = text(body.netsuiteInternalId, 64);
  const netsuiteItemName = optionalText(body.netsuiteItemName, 255);
  const netsuiteUnit = optionalText(body.netsuiteUnit, 64);

  if (!subsidiaryId || !vendor || !vendorItemName || !netsuiteInternalId) return null;
  const vendorNorm = normalizeForLookup(vendor).slice(0, 191);
  const vendorItemNorm = normalizeForLookup(vendorItemName).slice(0, 512);
  if (!vendorNorm || !vendorItemNorm) return null;

  return { subsidiaryId, vendor, vendorNorm, vendorItemName, vendorItemNorm, netsuiteInternalId, netsuiteItemName, netsuiteUnit };
}

function configuredMinimum(config: Record<string, unknown>): number {
  const value = Number(config.min_confirmations);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : 5;
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden crear mapeos" }, { status: 403 });

  const feature = await getFeature(session.orgId, "auto_mapping");
  if (!feature.isEnabled) return NextResponse.json({ error: "Auto-mapeo no activado" }, { status: 403 });

  try {
    const input = parseInput(await req.json() as MappingInput);
    if (!input) return NextResponse.json({ error: "Completa subsidiaria, proveedor, ítem del documento e ítem de NetSuite" }, { status: 400 });

    const subsidiary = await db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, input.subsidiaryId), eq(subsidiaries.organizationId, session.orgId)),
      columns: { id: true },
    });
    if (!subsidiary) return NextResponse.json({ error: "La subsidiaria no pertenece a tu organización" }, { status: 403 });

    const now = new Date();
    const [created] = await db.insert(itemMappings).values({
      ...input,
      autoMap: true,
      timesConfirmed: configuredMinimum(feature.config),
      lastConfirmed: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();

    if (!created) return NextResponse.json({ error: "Ya existe un mapeo para ese proveedor, ítem y subsidiaria" }, { status: 409 });

    await logAudit({
      orgId: session.orgId, userId: session.sub, userEmail: session.email,
      action: "mapping.created", resourceType: "item_mapping", resourceId: String(created.id),
      metadata: { subsidiaryId: created.subsidiaryId, vendor: created.vendor, netsuiteInternalId: created.netsuiteInternalId },
    });

    return NextResponse.json({ mapping: created }, { status: 201 });
  } catch (err) {
    console.error("[mappings POST]", err);
    return NextResponse.json({ error: "No se pudo crear el mapeo" }, { status: 500 });
  }
}
