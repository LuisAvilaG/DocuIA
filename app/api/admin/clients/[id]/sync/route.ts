import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { nsConnections, subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { fetchCatalogPage } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import type { NSCatalogItem, NSVendor, NSLocation } from "@/lib/netsuite/client";
import { decryptField } from "@/lib/crypto/encrypt";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();
    const { subsidiaryId, types } = body as {
      subsidiaryId: string;
      types?: Array<"items" | "vendors" | "locations">;
    };

    if (!subsidiaryId) {
      return NextResponse.json({ error: "subsidiaryId is required" }, { status: 400 });
    }

    // Load NS connection for this org (sandbox or active env)
    const conn = await db.query.nsConnections.findFirst({
      where: and(
        eq(nsConnections.organizationId, organizationId),
        eq(nsConnections.isActive, true),
      ),
    });

    if (!conn) {
      return NextResponse.json({ error: "No active NS connection found" }, { status: 422 });
    }
    if (!conn.catalogScriptId || !conn.catalogDeployId) {
      return NextResponse.json({ error: "Catalog script not configured on this connection" }, { status: 422 });
    }

    // Verify the subsidiary belongs to this org
    const sub = await db.query.subsidiaries.findFirst({
      where: and(
        eq(subsidiaries.id, subsidiaryId),
        eq(subsidiaries.organizationId, organizationId),
      ),
    });

    if (!sub) {
      return NextResponse.json({ error: "Subsidiary not found" }, { status: 404 });
    }

    const creds: NSCredentials = {
      accountId:      conn.accountId,
      consumerKey:    decryptField(conn.consumerKey),
      consumerSecret: decryptField(conn.consumerSecret),
      tokenId:        decryptField(conn.tokenId),
      tokenSecret:    decryptField(conn.tokenSecret),
    };

    const syncTypes = types ?? ["items", "vendors", "locations"];
    const summary: Record<string, number> = {};

    for (const type of syncTypes) {
      let page = 0;
      let total = 0;

      while (true) {
        const result = await fetchCatalogPage(
          creds,
          conn.catalogScriptId,
          conn.catalogDeployId,
          type,
          sub.nsSubsidiaryId,
          page,
          500,
        );

        if (!result.ok || !result.data) {
          return NextResponse.json({
            error: `Sync failed at type=${type} page=${page}: ${result.error}`,
            partial: summary,
          }, { status: 502 });
        }

        const rows = result.data.results;
        if (!rows.length) break;

        const now = new Date();

        if (type === "items") {
          for (const row of rows as NSCatalogItem[]) {
            await db.insert(catalogItems).values({
              subsidiaryId,
              internalId:  row.internal_id,
              itemid:      row.itemid || null,
              name:        row.name || null,
              type:        row.type || null,
              unit:        row.unit || null,
              drtUnitId:   row.drt_unit_uom_id || null,
              drtUnitName: row.drt_unit_uom_name || null,
              updatedAt:   now,
            }).onConflictDoUpdate({
              target: [catalogItems.subsidiaryId, catalogItems.internalId],
              set: {
                itemid:      row.itemid || null,
                name:        row.name || null,
                type:        row.type || null,
                unit:        row.unit || null,
                drtUnitId:   row.drt_unit_uom_id || null,
                drtUnitName: row.drt_unit_uom_name || null,
                updatedAt:   now,
              },
            });
          }
        }

        if (type === "vendors") {
          for (const row of rows as NSVendor[]) {
            await db.insert(catalogVendors).values({
              subsidiaryId,
              internalId: row.internal_id,
              entityid:   row.entityid || null,
              name:       row.name || null,
              email:      row.email || null,
              phone:      row.phone || null,
              rfc:        row.rfc || null,
              isInactive: row.inactive ?? false,
              updatedAt:  now,
            }).onConflictDoUpdate({
              target: [catalogVendors.subsidiaryId, catalogVendors.internalId],
              set: {
                entityid:   row.entityid || null,
                name:       row.name || null,
                email:      row.email || null,
                phone:      row.phone || null,
                rfc:        row.rfc || null,
                isInactive: row.inactive ?? false,
                updatedAt:  now,
              },
            });
          }
        }

        if (type === "locations") {
          for (const row of rows as NSLocation[]) {
            await db.insert(catalogLocations).values({
              subsidiaryId,
              internalId: row.internal_id,
              name:       row.name || null,
              fullName:   row.full_name || null,
              isInactive: row.inactive ?? false,
              updatedAt:  now,
            }).onConflictDoUpdate({
              target: [catalogLocations.subsidiaryId, catalogLocations.internalId],
              set: {
                name:       row.name || null,
                fullName:   row.full_name || null,
                isInactive: row.inactive ?? false,
                updatedAt:  now,
              },
            });
          }
        }

        total += rows.length;

        // No more pages
        if (page + 1 >= result.data.page_count) break;
        page++;
      }

      summary[type] = total;
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[clients/sync POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
