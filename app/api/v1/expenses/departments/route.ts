import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { catalogDepartments } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const departments = await db.query.catalogDepartments.findMany({
    where: and(
      eq(catalogDepartments.organizationId, session.orgId),
      eq(catalogDepartments.isInactive, false),
    ),
    columns: { id: true, name: true, netsuiteId: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  return NextResponse.json({ departments });
}
