import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { getFeature } from "@/lib/features";
import { db } from "@/lib/db";
import { itemMappings, subsidiaries } from "@/db/schema";
import { normalizeForLookup } from "@/lib/workflow/similarity";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };
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

async function ownedMapping(mappingId: number, orgId: string) {
  const [mapping] = await db.select({ id: itemMappings.id })
    .from(itemMappings)
    .innerJoin(subsidiaries, eq(itemMappings.subsidiaryId, subsidiaries.id))
    .where(and(eq(itemMappings.id, mappingId), eq(subsidiaries.organizationId, orgId)));
  return mapping ?? null;
}

async function requireMappingAdmin() {
  const session = await getTenantSession();
  if (!session) return { session: null, error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (session.role !== "admin") return { session: null, error: NextResponse.json({ error: "Solo administradores pueden administrar mapeos" }, { status: 403 }) };
  const feature = await getFeature(session.orgId, "auto_mapping");
  if (!feature.isEnabled) return { session: null, error: NextResponse.json({ error: "Auto-mapeo no activado" }, { status: 403 }) };
  return { session, feature, error: null };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireMappingAdmin();
  if (auth.error || !auth.session || !auth.feature) return auth.error!;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Mapeo inválido" }, { status: 400 });

  try {
    if (!await ownedMapping(id, auth.session.orgId)) return NextResponse.json({ error: "Mapeo no encontrado" }, { status: 404 });
    const input = parseInput(await req.json() as MappingInput);
    if (!input) return NextResponse.json({ error: "Completa subsidiaria, proveedor, ítem del documento e ítem de NetSuite" }, { status: 400 });

    const subsidiary = await db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, input.subsidiaryId), eq(subsidiaries.organizationId, auth.session.orgId)),
      columns: { id: true },
    });
    if (!subsidiary) return NextResponse.json({ error: "La subsidiaria no pertenece a tu organización" }, { status:403 });

    const minimum = configuredMinimum(auth.feature.config);
    const [updated] = await db.update(itemMappings).set({
      ...input,
      autoMap: true,
      timesConfirmed: sql`GREATEST(${itemMappings.timesConfirmed}, ${minimum})`,
      lastConfirmed: new Date(),
      updatedAt: new Date(),
    }).where(eq(itemMappings.id, id)).returning();

    await logAudit({
      orgId: auth.session.orgId, userId: auth.session.sub, userEmail: auth.session.email,
      action: "mapping.updated", resourceType: "item_mapping", resourceId: String(id),
      metadata: { subsidiaryId: updated.subsidiaryId, vendor: updated.vendor, netsuiteInternalId: updated.netsuiteInternalId },
    });
    return NextResponse.json({ mapping: updated });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
    if (code === "23505") return NextResponse.json({ error: "Ya existe un mapeo para ese proveedor, ítem y subsidiaria" }, { status: 409 });
    console.error("[mappings PATCH]", err);
    return NextResponse.json({ error: "No se pudo actualizar el mapeo" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireMappingAdmin();
  if (auth.error || !auth.session) return auth.error!;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Mapeo inválido" }, { status: 400 });

  try {
    if (!await ownedMapping(id, auth.session.orgId)) return NextResponse.json({ error: "Mapeo no encontrado" }, { status: 404 });
    await db.delete(itemMappings).where(eq(itemMappings.id, id));
    await logAudit({
      orgId: auth.session.orgId, userId: auth.session.sub, userEmail: auth.session.email,
      action: "mapping.deleted", resourceType: "item_mapping", resourceId: String(id),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mappings DELETE]", err);
    return NextResponse.json({ error: "No se pudo eliminar el mapeo" }, { status: 500 });
  }
}
