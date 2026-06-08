import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations, nsConnections, subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { and, eq, max } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { fetchCatalogPage } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import type { NSCatalogItem, NSVendor, NSLocation } from "@/lib/netsuite/client";
import { decryptField } from "@/lib/crypto/encrypt";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({ columns: { id: true } });
    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "auto_sync");
      } catch {
        continue;
      }
      if (!feat.isEnabled) continue;

      const config = feat.config as { interval_hours?: number };
      const intervalMs = (config.interval_hours ?? 24) * 3600_000;

      const subs = await db.query.subsidiaries.findMany({
        where: and(
          eq(subsidiaries.organizationId, org.id),
          eq(subsidiaries.isActive, true),
        ),
      });

      const conn = await db.query.nsConnections.findFirst({
        where: and(
          eq(nsConnections.organizationId, org.id),
          eq(nsConnections.isActive, true),
        ),
      });

      if (!conn?.catalogScriptId || !conn?.catalogDeployId) {
        summary[org.id] = { skipped: "no catalog script configured" };
        continue;
      }

      const creds: NSCredentials = {
        accountId:      conn.accountId,
        consumerKey:    decryptField(conn.consumerKey),
        consumerSecret: decryptField(conn.consumerSecret),
        tokenId:        decryptField(conn.tokenId),
        tokenSecret:    decryptField(conn.tokenSecret),
      };

      const orgSummary: Record<string, unknown> = {};

      for (const sub of subs) {
        // Check last sync via most recent updatedAt in catalog tables
        const [lastSync] = await db
          .select({ lastAt: max(catalogItems.updatedAt) })
          .from(catalogItems)
          .where(eq(catalogItems.subsidiaryId, sub.id));

        const lastAt = lastSync?.lastAt;
        if (lastAt && Date.now() - lastAt.getTime() < intervalMs) {
          orgSummary[sub.id] = { skipped: "not due yet" };
          continue;
        }

        const syncTypes: Array<"items" | "vendors" | "locations"> = ["items", "vendors", "locations"];
        const subSummary: Record<string, number> = {};

        for (const type of syncTypes) {
          let page = 0;
          let total = 0;
          const now = new Date();

          while (true) {
            const result = await fetchCatalogPage(
              creds, conn.catalogScriptId, conn.catalogDeployId,
              type, sub.nsSubsidiaryId, page, 500,
            );
            if (!result.ok || !result.data) break;
            const rows = result.data.results;
            if (!rows.length) break;

            if (type === "items") {
              for (const row of rows as NSCatalogItem[]) {
                await db.insert(catalogItems).values({
                  subsidiaryId: sub.id,
                  internalId:   row.internal_id,
                  itemid:       row.itemid || null,
                  name:         row.name   || null,
                  type:         row.type   || null,
                  unit:         row.unit   || null,
                  drtUnitId:    row.drt_unit_uom_id   || null,
                  drtUnitName:  row.drt_unit_uom_name || null,
                  updatedAt:    now,
                }).onConflictDoUpdate({
                  target: [catalogItems.subsidiaryId, catalogItems.internalId],
                  set: { itemid: row.itemid || null, name: row.name || null, type: row.type || null,
                         unit: row.unit || null, drtUnitId: row.drt_unit_uom_id || null,
                         drtUnitName: row.drt_unit_uom_name || null, updatedAt: now },
                });
              }
            }
            if (type === "vendors") {
              for (const row of rows as NSVendor[]) {
                await db.insert(catalogVendors).values({
                  subsidiaryId: sub.id, internalId: row.internal_id,
                  entityid: row.entityid || null, name: row.name || null,
                  email: row.email || null, phone: row.phone || null,
                  rfc: row.rfc || null, isInactive: row.inactive ?? false, updatedAt: now,
                }).onConflictDoUpdate({
                  target: [catalogVendors.subsidiaryId, catalogVendors.internalId],
                  set: { entityid: row.entityid || null, name: row.name || null,
                         email: row.email || null, phone: row.phone || null,
                         rfc: row.rfc || null, isInactive: row.inactive ?? false, updatedAt: now },
                });
              }
            }
            if (type === "locations") {
              for (const row of rows as NSLocation[]) {
                await db.insert(catalogLocations).values({
                  subsidiaryId: sub.id, internalId: row.internal_id,
                  name: row.name || null, fullName: row.full_name || null,
                  isInactive: row.inactive ?? false, updatedAt: now,
                }).onConflictDoUpdate({
                  target: [catalogLocations.subsidiaryId, catalogLocations.internalId],
                  set: { name: row.name || null, fullName: row.full_name || null,
                         isInactive: row.inactive ?? false, updatedAt: now },
                });
              }
            }

            total += rows.length;
            if (page + 1 >= result.data.page_count) break;
            page++;
          }
          subSummary[type] = total;
        }
        orgSummary[sub.id] = subSummary;
      }
      summary[org.id] = orgSummary;
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/auto-sync]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
