import { canAccessTenantArea } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/features";

/**
 * Si el usuario puede subir facturas y órdenes a mano (decisión 1 del plan del
 * rediseño): su rol escribe en Documentos y el cliente tiene `manual_upload`.
 */
export async function canUploadDocuments(session: { orgId: string; role: string }): Promise<boolean> {
  if (!canAccessTenantArea(session.role, { area: "documents", permission: "write" })) return false;
  return isFeatureEnabled(session.orgId, "manual_upload").catch(() => false);
}
