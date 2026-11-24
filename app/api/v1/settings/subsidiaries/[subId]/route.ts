import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { clientIp } from "@/lib/security/request-ip";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { catalogLocations, subsidiaries } from "@/db/schema";

type Params = { params: Promise<{ subId: string }> };

/** El administrador del cliente elige la ubicación predeterminada de una subsidiaria (Ajustes de Facturas). */
async function handlePATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "settings", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Se requiere rol de administrador" }, { status: 403 });

  const { subId } = await params;
  const body = await req.json().catch(() => null) as { defaultLocationId?: unknown } | null;
  const raw = body?.defaultLocationId;
  if (!body || (raw !== null && (typeof raw !== "string" || raw.length > 64))) {
    return NextResponse.json({ error: "Cambio inválido" }, { status: 400 });
  }
  const next = typeof raw === "string" && raw.trim() ? raw.trim() : null;

  const sub = await db.query.subsidiaries.findFirst({
    where: and(eq(subsidiaries.id, subId), eq(subsidiaries.organizationId, session.orgId)),
    columns: { id: true, defaultLocationId: true },
  });
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });

  if (next) {
    // Only a location the ERP has for this subsidiary, and still active there.
    const [location] = await db.select({ id: catalogLocations.internalId }).from(catalogLocations)
      .where(and(eq(catalogLocations.subsidiaryId, subId), eq(catalogLocations.internalId, next), eq(catalogLocations.isInactive, false)))
      .limit(1);
    if (!location) return NextResponse.json({ error: "Esa ubicación ya no está entre las del ERP para esta subsidiaria." }, { status: 400 });
  }

  await db.update(subsidiaries).set({ defaultLocationId: next, updatedAt: new Date() }).where(eq(subsidiaries.id, subId));
  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "subsidiary.default_location.updated", resourceType: "subsidiary", resourceId: subId,
    metadata: { before: sub.defaultLocationId, after: next }, ipAddress: clientIp(req.headers),
  });
  return NextResponse.json({ ok: true, defaultLocationId: next });
}

export const PATCH = withApiSecurity(handlePATCH);
