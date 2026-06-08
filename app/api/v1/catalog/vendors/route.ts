import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { subsidiaries, catalogVendors } from "@/db/schema";
import { and, eq, inArray, or, ilike } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q            = searchParams.get("q")?.trim() ?? "";
  const subsidiaryId = searchParams.get("subsidiaryId")?.trim() ?? "";

  if (!q || q.length < 1) return NextResponse.json({ vendors: [] });

  try {
    const orgSubs = await db
      .select({ id: subsidiaries.id })
      .from(subsidiaries)
      .where(eq(subsidiaries.organizationId, session.orgId));

    const subIds = orgSubs.map(s => s.id);
    if (!subIds.length) return NextResponse.json({ vendors: [] });

    const targetIds = subsidiaryId && subIds.includes(subsidiaryId) ? [subsidiaryId] : subIds;

    const pattern = `%${q}%`;
    const rows = await db
      .select({
        internalId: catalogVendors.internalId,
        name:       catalogVendors.name,
        entityid:   catalogVendors.entityid,
      })
      .from(catalogVendors)
      .where(
        and(
          inArray(catalogVendors.subsidiaryId, targetIds),
          eq(catalogVendors.isInactive, false),
          or(
            ilike(catalogVendors.name, pattern),
            ilike(catalogVendors.entityid, pattern),
          ),
        )
      )
      .limit(40);

    return NextResponse.json({
      vendors: rows.map(r => ({
        internalId: r.internalId,
        name:       r.name ?? "",
        entityid:   r.entityid ?? "",
      })),
    });
  } catch (err) {
    console.error("[catalog/vendors GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
