import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { vendorRules } from "@/db/schema";
import { parseVendorRuleConfig } from "@/lib/workflow/vendor-rules";
import { listVendorRules } from "@/lib/workflow/vendor-rules-store";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };

async function authorize() {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (session.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores pueden modificar reglas" }, { status: 403 }) };
  if (!await isFeatureEnabled(session.orgId, "vendor_rules")) {
    return { error: NextResponse.json({ error: "Reglas de proveedores no activadas" }, { status: 403 }) };
  }
  return { session };
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { session } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const [updated] = await db.update(vendorRules)
    .set({ config: parseVendorRuleConfig(body?.config), updatedAt: new Date() })
    .where(and(eq(vendorRules.id, id), eq(vendorRules.organizationId, session.orgId)))
    .returning({ id: vendorRules.id, scope: vendorRules.scope, targetKey: vendorRules.targetKey });
  if (!updated) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "vendor_rule.updated", resourceType: "vendor_rule", resourceId: id,
    metadata: { scope: updated.scope, targetKey: updated.targetKey },
  });
  const rules = await listVendorRules(session.orgId);
  return NextResponse.json({ rule: rules.find((r) => r.id === id) });
}

async function handleDELETE(_req: NextRequest, { params }: Params) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { session } = auth;
  const { id } = await params;

  const [deleted] = await db.delete(vendorRules)
    .where(and(eq(vendorRules.id, id), eq(vendorRules.organizationId, session.orgId)))
    .returning({ scope: vendorRules.scope, targetKey: vendorRules.targetKey });
  if (!deleted) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "vendor_rule.deleted", resourceType: "vendor_rule", resourceId: id,
    metadata: deleted,
  });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiSecurity(handlePATCH);
export const DELETE = withApiSecurity(handleDELETE);
