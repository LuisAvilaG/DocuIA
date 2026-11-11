import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { ruleForVendor } from "@/lib/workflow/vendor-rules-store";

// «¿Qué regla se aplica a…?»: resuelve con la misma prioridad que el envío.
async function handleGET(req: NextRequest) {
  const session = await getTenantSession({ area: "documents" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "vendor_rules")) return NextResponse.json({ error: "Reglas de proveedores no activadas" }, { status: 403 });
  const vendorId = (req.nextUrl.searchParams.get("vendorId") ?? "").trim().slice(0, 64);
  if (!vendorId) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });
  return NextResponse.json(await ruleForVendor(session.orgId, vendorId));
}

export const GET = withApiSecurity(handleGET);
