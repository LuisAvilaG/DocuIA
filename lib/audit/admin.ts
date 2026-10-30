import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminAuditLog, organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { clientIp } from "@/lib/security/request-ip";

export interface AdminAuditEntry {
  action: string;
  targetOrgId?: string | null;
  targetOrgName?: string | null;
  targetUserId?: string | null;
  targetFeature?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Records a platform-admin action on a tenant. Never includes secrets: pass
 * only what changed (e.g. { role }, { configured: true }), not values such as
 * passwords, API keys or NetSuite tokens. Failures are logged, not thrown, so
 * auditing never blocks the action itself.
 */
export async function logAdminAction(req: NextRequest, admin: { sub: string; email: string }, entry: AdminAuditEntry): Promise<void> {
  const ip = clientIp(req.headers);
  let targetOrgName = entry.targetOrgName ?? null;
  if (!targetOrgName && entry.targetOrgId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, entry.targetOrgId),
      columns: { name: true },
    }).catch(() => null);
    targetOrgName = org?.name ?? null;
  }
  await db.insert(adminAuditLog).values({
    adminId:       admin.sub,
    adminEmail:    admin.email,
    action:        entry.action,
    targetOrgId:   entry.targetOrgId ?? null,
    targetOrgName,
    targetUserId:  entry.targetUserId ?? null,
    targetFeature: entry.targetFeature ?? null,
    beforeJson:    entry.before ?? null,
    afterJson:     entry.after ?? null,
    ipAddress:     ip === "unknown" ? null : ip,
    userAgent:     req.headers.get("user-agent"),
  }).catch((err) => console.error("[admin-audit]", err instanceof Error ? err.message : err));
}

/** How an action is classified in the audit viewer. */
export type AuditKind = "config" | "access" | "risk";

export function auditKind(action: string): AuditKind {
  if (/suspend|delete|purge|restore|environment|production/.test(action)) return "risk";
  if (/login|user|password|credential|connection|admin|api_key|ai_key/.test(action)) return "access";
  return "config";
}

/** Spanish sentence for an audit row, built from the action and its payload. */
export function describeAdminAction(row: {
  action: string;
  targetOrgName: string | null;
  targetFeature: string | null;
  beforeJson: unknown;
  afterJson: unknown;
}): string {
  const after = (row.afterJson ?? {}) as Record<string, unknown>;
  const before = (row.beforeJson ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  switch (row.action) {
    case "toggle_feature":
    case "feature.updated":
      return `${after.adminGranted ? "Activó" : "Desactivó"} la feature ${row.targetFeature ?? ""}${after.notes ? ` con nota "${str(after.notes)}"` : ""}.`;
    case "feature_default.updated":
      return `Cambió el valor por defecto de ${row.targetFeature ?? ""} a ${after.defaultEnabled ? "activo" : "inactivo"}${after.affected !== undefined ? ` (afecta a ${str(after.affected)} clientes)` : ""}.`;
    case "org.created":
      return `Dio de alta la organización con ${str(after.products) || "sus productos"}.`;
    case "org.updated":
      return `Editó los datos de la organización (${Object.keys(after).join(", ")}).`;
    case "org.suspended":
      return `Suspendió el acceso de la organización${after.reason ? `. Motivo: "${str(after.reason)}"` : "."}`;
    case "org.restored":
      return "Restableció el acceso de la organización.";
    case "org.deleted":
      return "Marcó la organización para eliminación (recuperable 30 días).";
    case "org.purged":
      return "Purgó definitivamente los datos de la organización.";
    case "org.plan_changed":
      return `Cambió el plan de ${str(before.planId)} a ${str(after.planId)}.`;
    case "products.updated":
      return `Actualizó los productos contratados (${str(after.summary)}).`;
    case "netsuite_connection.created":
    case "netsuite_connection.updated":
      return `Guardó credenciales ERP de ${str(after.environment)} (cuenta ${str(after.accountId)})${after.tested === true ? ", probadas" : after.tested === false ? ", sin probar" : ""}.`;
    case "netsuite_connection.tested":
      return `Probó la conexión ERP de ${str(after.environment)}: ${after.ok ? "correcta" : `falló (${str(after.error)})`}.`;
    case "netsuite_scripts.updated":
      return `Actualizó los scripts del ERP de ${str(after.environment)}.`;
    case "environment.switched":
      return `Cambió el entorno activo del ERP a ${str(after.environment)}.`;
    case "subsidiary.created":
      return `Agregó la subsidiaria ${str(after.name)}.`;
    case "subsidiary.updated":
      return `Editó la subsidiaria ${str(after.name)}.`;
    case "subsidiary.deleted":
      return `Eliminó la subsidiaria ${str(before.name)}.`;
    case "catalog.synced":
      return `Sincronizó el catálogo de ${str(after.subsidiary)} (${str(after.summary)}).`;
    case "expense_catalogs.synced":
      return `Sincronizó catálogos de gastos (${str(after.action)}).`;
    case "expense_category.caps_updated":
      return `Cambió los topes de la categoría ${str(after.category)}.`;
    case "tenant_user.created":
      return `Creó el usuario ${str(after.email)} con rol ${str(after.role)}.`;
    case "tenant_user.updated":
      return `Actualizó el usuario (${after.passwordReset ? "contraseña restablecida, " : ""}rol ${str(after.role)}, ${after.isActive ? "activo" : "inactivo"}).`;
    case "ai_key.set":
      return "Configuró una clave de IA propia para la organización.";
    case "ai_key.cleared":
      return "Quitó la clave de IA propia de la organización.";
    case "platform_admin.created":
      return `Creó al administrador ${str(after.email)}.`;
    case "platform_admin.updated":
      return `Actualizó al administrador ${str(after.email)}${after.passwordReset ? " (contraseña restablecida)" : ""}${after.isActive === false ? " y lo desactivó" : ""}.`;
    case "admin.login":
      return "Inició sesión en el panel.";
    default:
      return row.action.replace(/[._]/g, " ");
  }
}
