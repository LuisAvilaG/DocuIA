import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { count, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { getFeature } from "@/lib/features";
import { db } from "@/lib/db";
import { vendorRules } from "@/db/schema";
import { parseVendorRuleConfig } from "@/lib/workflow/vendor-rules";
import { listVendorCategories, listVendorRules } from "@/lib/workflow/vendor-rules-store";
import { logAudit } from "@/lib/audit/log";

const SCOPES = new Set(["default", "category", "vendor"]);

async function handleGET() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const feature = await getFeature(session.orgId, "vendor_rules");
  if (!feature.isEnabled) return NextResponse.json({ error: "Reglas de proveedores no activadas" }, { status: 403 });

  const [rules, categories] = await Promise.all([listVendorRules(session.orgId), listVendorCategories(session.orgId)]);
  return NextResponse.json({ rules, categories });
}

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden crear reglas" }, { status: 403 });
  const feature = await getFeature(session.orgId, "vendor_rules");
  if (!feature.isEnabled) return NextResponse.json({ error: "Reglas de proveedores no activadas" }, { status: 403 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const scope = typeof body?.scope === "string" && SCOPES.has(body.scope) ? body.scope as "default" | "category" | "vendor" : null;
  if (!scope) return NextResponse.json({ error: "Indica a qué aplica la regla" }, { status: 400 });
  const targetKey = scope === "default" ? "*" : typeof body?.targetKey === "string" ? body.targetKey.trim().slice(0, 64) : "";
  if (!targetKey) return NextResponse.json({ error: scope === "vendor" ? "Elige un proveedor" : "Elige una categoría" }, { status: 400 });
  const targetLabel = scope === "default" ? null : typeof body?.targetLabel === "string" ? body.targetLabel.trim().slice(0, 255) || null : null;

  const max = Math.max(1, Number(feature.config.max_rules) || 50);
  const [{ total }] = await db.select({ total: count() }).from(vendorRules).where(eq(vendorRules.organizationId, session.orgId));
  if (total >= max) return NextResponse.json({ error: `Tu plan permite hasta ${max} reglas` }, { status: 409 });

  const now = new Date();
  const [created] = await db.insert(vendorRules).values({
    id: randomUUID(),
    organizationId: session.orgId,
    scope,
    targetKey,
    targetLabel,
    config: parseVendorRuleConfig(body?.config),
    createdBy: session.sub,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();
  if (!created) return NextResponse.json({ error: "Ya existe una regla para ese destino" }, { status: 409 });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "vendor_rule.created", resourceType: "vendor_rule", resourceId: created.id,
    metadata: { scope, targetKey, targetLabel },
  });

  const rules = await listVendorRules(session.orgId);
  return NextResponse.json({ rule: rules.find((r) => r.id === created.id) }, { status: 201 });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
