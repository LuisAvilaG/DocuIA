import { db } from "@/lib/db";
import { adminAuditLog, organizations, orgFeatures } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { setAdminGrant } from "@/lib/features";
import { qaModeActive } from "./qa-mode";

/**
 * Proceso diario: apaga el modo QA de los clientes donde venció o donde el ERP
 * ya no está en sandbox. Cada apagado queda en la auditoría del superadmin.
 */
export async function sweepQaMode(now = new Date()): Promise<{ checked: number; disabled: number }> {
  const rows = await db.select({ organizationId: orgFeatures.organizationId, config: orgFeatures.configJson, notes: orgFeatures.notes })
    .from(orgFeatures)
    .where(and(eq(orgFeatures.featureId, "qa_mode"), eq(orgFeatures.adminGranted, true)));
  if (rows.length === 0) return { checked: 0, disabled: 0 };

  const orgs = await db.select({ id: organizations.id, name: organizations.name, env: organizations.activeNsEnvironment })
    .from(organizations).where(inArray(organizations.id, rows.map((r) => r.organizationId)));
  const orgBy = new Map(orgs.map((o) => [o.id, o]));

  let disabled = 0;
  for (const r of rows) {
    const org = orgBy.get(r.organizationId);
    const config = (r.config ?? {}) as Record<string, unknown>;
    if (qaModeActive(true, config, org?.env, now)) continue;
    await setAdminGrant(r.organizationId, "qa_mode", false, config, undefined, r.notes ?? undefined);
    await db.insert(adminAuditLog).values({
      adminId: "system",
      adminEmail: "proceso automático",
      action: "feature.auto_disabled",
      targetOrgId: r.organizationId,
      targetOrgName: org?.name ?? null,
      targetFeature: "qa_mode",
      beforeJson: { adminGranted: true },
      afterJson: { adminGranted: false, reason: org?.env !== "sandbox" ? "environment_production" : "expired" },
    }).catch((err) => console.error("[qa-mode-sweep] audit", err instanceof Error ? err.message : err));
    disabled++;
  }
  return { checked: rows.length, disabled };
}
