import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/db/schema";
import { clientIp } from "@/lib/security/request-ip";

/**
 * Records a platform-admin action on a tenant. Never includes secrets: pass
 * only what changed (e.g. { role }, { configured: true }), not values such as
 * passwords, API keys or NetSuite tokens. Failures are logged, not thrown, so
 * auditing never blocks the action itself.
 */
export async function logAdminAction(req: NextRequest, admin: { sub: string; email: string }, entry: {
  action: string;
  targetOrgId?: string | null;
  targetUserId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  const ip = clientIp(req.headers);
  await db.insert(adminAuditLog).values({
    adminId:      admin.sub,
    adminEmail:   admin.email,
    action:       entry.action,
    targetOrgId:  entry.targetOrgId ?? null,
    targetUserId: entry.targetUserId ?? null,
    beforeJson:   entry.before ?? null,
    afterJson:    entry.after ?? null,
    ipAddress:    ip === "unknown" ? null : ip,
    userAgent:    req.headers.get("user-agent"),
  }).catch((err) => console.error("[admin-audit]", err instanceof Error ? err.message : err));
}
