import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { setTenantEnabled, getFeature } from "@/lib/features";

export async function PATCH(req: Request) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Se requiere rol admin" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.isEnabled !== "boolean") {
    return NextResponse.json({ error: "isEnabled requerido" }, { status: 400 });
  }

  try {
    const feature = await getFeature(session.orgId, "netsuite_dry_run");
    if (!feature.adminGranted) {
      return NextResponse.json({ error: "El administrador no ha habilitado esta función para tu organización" }, { status: 403 });
    }

    await setTenantEnabled(session.orgId, "netsuite_dry_run", body.isEnabled, session.sub);

    const confirmed = await getFeature(session.orgId, "netsuite_dry_run");
    if (confirmed.tenantEnabled !== body.isEnabled) {
      return NextResponse.json({ error: "No se pudo guardar el cambio en la base de datos" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, isEnabled: confirmed.isEnabled });
  } catch (err) {
    console.error("[dry-run PATCH]", err);
    return NextResponse.json({ error: "Error al guardar la configuración" }, { status: 500 });
  }
}

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const feature = await getFeature(session.orgId, "netsuite_dry_run");
  return NextResponse.json({
    isEnabled:     feature.isEnabled,
    adminGranted:  feature.adminGranted,
    tenantEnabled: feature.tenantEnabled,
  });
}
