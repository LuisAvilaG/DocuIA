import { db } from "@/lib/db";
import { tenantAuditLog } from "@/db/schema";

// Security auditing is UNCONDITIONAL — it must not depend on a billing feature.
// The `tenant_audit_log` feature only gates whether the tenant can VIEW the log
// (enforced in GET /api/v1/audit-log), never whether events are recorded.
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
