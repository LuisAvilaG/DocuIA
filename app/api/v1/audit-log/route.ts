import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenantAuditLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const enabled = await isFeatureEnabled(session.orgId, "tenant_audit_log");
  if (!enabled) return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });

  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10));

  const entries = await db
    .select()
    .from(tenantAuditLog)
    .where(eq(tenantAuditLog.organizationId, session.orgId))
    .orderBy(desc(tenantAuditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  return NextResponse.json({ entries, hasMore: entries.length === PAGE_SIZE, offset });
}
