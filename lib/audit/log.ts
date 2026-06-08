import { db } from "@/lib/db";
import { tenantAuditLog } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/features";

export async function logAudit(opts: {
  orgId:          string;
  userId?:        string;
  userEmail?:     string;
  action:         string;
  resourceType?:  string;
  resourceId?:    string;
  metadata?:      Record<string, unknown>;
  ipAddress?:     string;
}) {
  try {
    const enabled = await isFeatureEnabled(opts.orgId, "tenant_audit_log");
    if (!enabled) return;

    await db.insert(tenantAuditLog).values({
      organizationId: opts.orgId,
      userId:         opts.userId,
      userEmail:      opts.userEmail,
      action:         opts.action,
      resourceType:   opts.resourceType,
      resourceId:     opts.resourceId,
      metadata:       opts.metadata ?? null,
      ipAddress:      opts.ipAddress,
    });
  } catch {
    // best-effort — never crashes the caller
  }
}
