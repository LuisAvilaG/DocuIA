import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { catalogClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const classes = await db.query.catalogClasses.findMany({
    where: and(
      eq(catalogClasses.organizationId, session.orgId),
      eq(catalogClasses.isInactive, false),
    ),
    columns: { id: true, name: true, netsuiteId: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  return NextResponse.json({ classes });
}
