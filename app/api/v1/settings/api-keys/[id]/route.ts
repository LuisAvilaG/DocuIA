import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTenantSession({ area: "settings", permission: "write" });
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const result = await db.update(apiKeys)
    .set({ revokedAt: new Date(), revokedBy: session.sub })
    .where(and(
      eq(apiKeys.id, id),
      eq(apiKeys.organizationId, session.orgId),
      isNull(apiKeys.revokedAt),
    ))
    .returning({ id: apiKeys.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "Not found or already revoked" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiSecurity(handleDELETE);
