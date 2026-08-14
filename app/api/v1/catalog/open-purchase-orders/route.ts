import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { nsConnections, subsidiaries } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/features";
import { decryptField } from "@/lib/crypto/encrypt";
import { fetchOpenPurchaseOrders } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "po_processing")) {
    return NextResponse.json({ error: "El procesamiento con PO no está habilitado" }, { status: 403 });
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
    db.query.nsConnections.findFirst({
      where: and(eq(nsConnections.organizationId, session.orgId), eq(nsConnections.isActive, true)),
    }),
  ]);
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 404 });
  if (!conn?.catalogScriptId || !conn.catalogDeployId) {
    return NextResponse.json({ error: "El script de catálogo de NetSuite no está configurado" }, { status: 422 });
  }

  const creds: NSCredentials = {
    accountId: conn.accountId,
    consumerKey: decryptField(conn.consumerKey), consumerSecret: decryptField(conn.consumerSecret),
    tokenId: decryptField(conn.tokenId), tokenSecret: decryptField(conn.tokenSecret),
  };
  const result = await fetchOpenPurchaseOrders(creds, conn.catalogScriptId, conn.catalogDeployId, sub.nsSubsidiaryId, vendorId);
  if (!result.ok) return NextResponse.json({ error: result.error ?? "No se pudieron consultar las POs abiertas" }, { status: 502 });
  return NextResponse.json({ purchaseOrders: result.data ?? [] });
}
