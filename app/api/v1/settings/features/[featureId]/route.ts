import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { clientIp } from "@/lib/security/request-ip";
import { logAudit } from "@/lib/audit/log";
import { setTenantFeature } from "@/lib/features/tenant-settings";

type Params = { params: Promise<{ featureId: string }> };

/** El administrador del cliente cambia lo que le toca de una feature (Ajustes de Facturas). */
async function handlePATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "settings", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Se requiere rol de administrador" }, { status: 403 });

  const { featureId } = await params;
  const body = await req.json().catch(() => null) as { enabled?: unknown; config?: unknown } | null;
  if (!body || (body.enabled !== undefined && typeof body.enabled !== "boolean") || (body.config !== undefined && (typeof body.config !== "object" || body.config === null || Array.isArray(body.config)))) {
    return NextResponse.json({ error: "Cambio inválido" }, { status: 400 });
  }

  const result = await setTenantFeature(session.orgId, featureId, {
    enabled: body.enabled as boolean | undefined,
    config: body.config as Record<string, unknown> | undefined,
  }, session.sub);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "feature_settings.updated", resourceType: "feature", resourceId: featureId,
    metadata: { before: result.before, after: result.after }, ipAddress: clientIp(req.headers),
  });
  return NextResponse.json({ ok: true, enabled: result.enabled, config: result.after });
}

export const PATCH = withApiSecurity(handlePATCH);
