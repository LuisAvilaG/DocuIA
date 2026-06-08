import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { subsidiaries, catalogItems } from "@/db/schema";
import { and, eq, inArray, or, ilike } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const subsidiaryId = searchParams.get("subsidiaryId")?.trim() ?? "";

  if (!q || q.length < 2) return NextResponse.json({ items: [] });

  try {
    const orgSubs = await db
      .select({ id: subsidiaries.id })
      .from(subsidiaries)
      .where(eq(subsidiaries.organizationId, session.orgId));

    const subIds = orgSubs.map(s => s.id);
    if (!subIds.length) return NextResponse.json({ items: [] });

    // Filter to the requested subsidiary when provided and valid
    const targetIds = subsidiaryId && subIds.includes(subsidiaryId) ? [subsidiaryId] : subIds;

    const pattern = `%${q}%`;
    const rows = await db
      .select({
        internalId:  catalogItems.internalId,
        name:        catalogItems.name,
        itemid:      catalogItems.itemid,
        unit:        catalogItems.unit,
        drtUnitId:   catalogItems.drtUnitId,
        drtUnitName: catalogItems.drtUnitName,
      })
      .from(catalogItems)
      .where(
        and(
          inArray(catalogItems.subsidiaryId, targetIds),
          or(
            ilike(catalogItems.name, pattern),
            ilike(catalogItems.itemid, pattern),
          ),
        )
      )
      .limit(40);

    return NextResponse.json({
      items: rows.map(r => ({
        internalId:  r.internalId,
        name:        r.name ?? "",
        itemid:      r.itemid ?? "",
        unit:        r.unit ?? "",
        drtUnitId:   r.drtUnitId ?? null,
        drtUnitName: r.drtUnitName ?? null,
      })),
    });
  } catch (err) {
    console.error("[catalog/items GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
