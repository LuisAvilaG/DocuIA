import { withApiSecurity } from "@/lib/security/http";
import { getErp } from "@/lib/erp";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { subsidiaries } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/features";

async function handleGET(req: NextRequest) {
  const session = await getTenantSession({ area: "documents" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "po_processing")) {
    return NextResponse.json({ error: "El procesamiento con OC no está habilitado" }, { status: 403 });
  }

  const subsidiaryId = req.nextUrl.searchParams.get("subsidiaryId")?.trim() ?? "";
  const vendorId = req.nextUrl.searchParams.get("vendorId")?.trim() ?? "";
  if (!subsidiaryId || !vendorId) {
    return NextResponse.json({ error: "Subsidiaria y proveedor son requeridos" }, { status: 400 });
  }

  const [sub, conn] = await Promise.all([
    db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, subsidiaryId), eq(subsidiaries.organizationId, session.orgId)),
    }),
    getErp(session.orgId),
  ]);
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });
  if (!conn?.capabilities.purchaseOrders) {
    return NextResponse.json({ error: "El ERP conectado no permite consultar órdenes de compra" }, { status: 422 });
  }

  const result = await conn.fetchOpenPurchaseOrders(sub.nsSubsidiaryId, vendorId);
  if (!result.ok) return NextResponse.json({ error: result.error ?? "No se pudieron consultar las OC abiertas" }, { status: 502 });
  return NextResponse.json({ purchaseOrders: result.data ?? [] });
}

export const GET = withApiSecurity(handleGET);
