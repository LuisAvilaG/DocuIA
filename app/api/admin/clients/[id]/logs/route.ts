import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { workflowRuntimeLogs } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
    const statusFilter = searchParams.get("status") as string | null;

    const where = statusFilter
      ? and(
          eq(workflowRuntimeLogs.organizationId, organizationId),
          eq(workflowRuntimeLogs.status, statusFilter as "STARTED" | "INFO" | "SUCCESS" | "FAILED"),
        )
      : eq(workflowRuntimeLogs.organizationId, organizationId);

    const rows = await db
      .select()
      .from(workflowRuntimeLogs)
      .where(where)
      .orderBy(desc(workflowRuntimeLogs.createdAt))
      .limit(limit);

    return NextResponse.json({ logs: rows });
  } catch (err) {
    console.error("[clients/logs GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
