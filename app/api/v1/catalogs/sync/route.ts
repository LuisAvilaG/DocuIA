import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { syncSubsidiaryCatalog, type CatalogType } from "@/lib/netsuite/sync-catalog";

// Tenant-facing catalog sync. Available to org admins so they can refresh their
// own items/vendors/locations without a platform super-admin. The subsidiary is
// verified to belong to the caller's org inside syncSubsidiaryCatalog.
export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede sincronizar el catálogo." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { subsidiaryId, types } = body as { subsidiaryId: string; types?: CatalogType[] };

    if (!subsidiaryId) {
      return NextResponse.json({ error: "subsidiaryId es requerido" }, { status: 400 });
    }

    const result = await syncSubsidiaryCatalog(session.orgId, subsidiaryId, types);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, partial: result.partial }, { status: result.status });
    }
    return NextResponse.json({ ok: true, summary: result.summary });
  } catch (err) {
    console.error("[v1/catalogs/sync POST]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
