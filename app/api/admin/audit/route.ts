import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth/admin";
import { auditKind, describeAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { adminAuditLog, platformAdmins } from "@/db/schema";

const PERIODS: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

async function handleGET(req: NextRequest) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const q = req.nextUrl.searchParams;
  const period = q.get("period") ?? "7d";
  const days = PERIODS[period] ?? 7;
  const since = new Date();
  if (period === "today") since.setHours(0, 0, 0, 0); else since.setTime(Date.now() - days * 86_400_000);
  const adminId = q.get("adminId");
  const orgId = q.get("orgId");
  const kind = q.get("kind");
  const search = q.get("q")?.trim();
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50)));
  const before = q.get("before");

  const where = and(
    gte(adminAuditLog.createdAt, since),
    adminId ? eq(adminAuditLog.adminId, adminId) : undefined,
    orgId ? eq(adminAuditLog.targetOrgId, orgId) : undefined,
    before ? lt(adminAuditLog.id, Number(before)) : undefined,
    search ? or(
      ilike(adminAuditLog.action, `%${search}%`),
      ilike(adminAuditLog.adminEmail, `%${search}%`),
      ilike(adminAuditLog.targetOrgName, `%${search}%`),
      ilike(adminAuditLog.targetFeature, `%${search}%`),
    ) : undefined,
  );

  const [rows, admins, countRow] = await Promise.all([
    db.select().from(adminAuditLog).where(where).orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id)).limit(limit * 3),
    db.select({ id: platformAdmins.id, name: platformAdmins.fullName, email: platformAdmins.email }).from(platformAdmins),
    db.select({ n: sql<number>`count(*)::int` }).from(adminAuditLog).where(where),
  ]);
  const adminName = new Map(admins.map((a) => [a.id, a.name || a.email]));

  // Kind is derived from the action, so filter after the query (rows are few).
  const events = rows
    .map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      adminId: r.adminId,
      admin: adminName.get(r.adminId) ?? r.adminEmail,
      action: r.action,
      kind: auditKind(r.action),
      text: describeAdminAction(r),
      orgId: r.targetOrgId,
      orgName: r.targetOrgName,
      feature: r.targetFeature,
      ip: r.ipAddress,
    }))
    .filter((e) => !kind || e.kind === kind)
    .slice(0, limit);

  return NextResponse.json({
    events,
    total: Number(countRow[0]?.n ?? 0),
    nextBefore: events.length === limit ? events[events.length - 1].id : null,
    admins: admins.map((a) => ({ id: a.id, name: a.name || a.email })),
  });
}

export const GET = withApiSecurity(handleGET);
