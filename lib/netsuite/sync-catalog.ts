// Shared catalog sync (items / vendors / locations) for one subsidiary.
// Used by both the platform-admin endpoint and the tenant-admin endpoint so the
// logic — including the subsidiary-scoped location cleanup — lives in one place.
import { db } from "@/lib/db";
import { nsConnections, subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { fetchCatalogPage } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import type { NSCatalogItem, NSVendor, NSLocation } from "@/lib/netsuite/client";
import { decryptField } from "@/lib/crypto/encrypt";

export type CatalogType = "items" | "vendors" | "locations";

export type SyncCatalogResult =
  | { ok: true; summary: Record<string, number> }
  | { ok: false; error: string; status: number; partial?: Record<string, number> };

/**
 * Pulls the requested catalog types for a single subsidiary from NetSuite and
 * upserts them. `organizationId` and `subsidiaryId` are DB ids; the subsidiary
 * is verified to belong to the org before anything is fetched.
 */
export async function syncSubsidiaryCatalog(
  organizationId: string,
  subsidiaryId: string,
  types?: CatalogType[],
): Promise<SyncCatalogResult> {
  const conn = await db.query.nsConnections.findFirst({
    where: and(eq(nsConnections.organizationId, organizationId), eq(nsConnections.isActive, true)),
  });
  if (!conn) return { ok: false, error: "No active NS connection found", status: 422 };
  if (!conn.catalogScriptId || !conn.catalogDeployId) {
    return { ok: false, error: "Catalog script not configured on this connection", status: 422 };
  }

  const sub = await db.query.subsidiaries.findFirst({
    where: and(eq(subsidiaries.id, subsidiaryId), eq(subsidiaries.organizationId, organizationId)),
  });
  if (!sub) return { ok: false, error: "Subsidiary not found", status: 404 };

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
        creds, conn.catalogScriptId, conn.catalogDeployId, type, sub.nsSubsidiaryId, page, 500,
      );
      if (!result.ok || !result.data) {
        return { ok: false, error: `Sync failed at type=${type} page=${page}: ${result.error}`, status: 502, partial: summary };
      }

      const rows = result.data.results;
      if (!rows.length) break;

      const now = new Date();

      if (type === "items") {
        for (const row of rows as NSCatalogItem[]) {
          await db.insert(catalogItems).values({
            subsidiaryId, internalId: row.internal_id,
            itemid: row.itemid || null, name: row.name || null, type: row.type || null,
            unit: row.unit || null, drtUnitId: row.drt_unit_uom_id || null,
            drtUnitName: row.drt_unit_uom_name || null, updatedAt: now,
          }).onConflictDoUpdate({
            target: [catalogItems.subsidiaryId, catalogItems.internalId],
            set: {
              itemid: row.itemid || null, name: row.name || null, type: row.type || null,
              unit: row.unit || null, drtUnitId: row.drt_unit_uom_id || null,
              drtUnitName: row.drt_unit_uom_name || null, updatedAt: now,
            },
          });
        }
      }

      if (type === "vendors") {
        for (const row of rows as NSVendor[]) {
          await db.insert(catalogVendors).values({
            subsidiaryId, internalId: row.internal_id,
            entityid: row.entityid || null, name: row.name || null, email: row.email || null,
            phone: row.phone || null, rfc: row.rfc || null, isInactive: row.inactive ?? false, updatedAt: now,
          }).onConflictDoUpdate({
            target: [catalogVendors.subsidiaryId, catalogVendors.internalId],
            set: {
              entityid: row.entityid || null, name: row.name || null, email: row.email || null,
              phone: row.phone || null, rfc: row.rfc || null, isInactive: row.inactive ?? false, updatedAt: now,
            },
          });
        }
      }

      if (type === "locations") {
        // Clear this subsidiary's locations once before repopulating, so rows
        // wrongly stored for other subsidiaries (before the subsidiary filter
        // existed) get removed rather than lingering.
        if (page === 0) {
          await db.delete(catalogLocations).where(eq(catalogLocations.subsidiaryId, subsidiaryId));
        }
        for (const row of rows as NSLocation[]) {
          await db.insert(catalogLocations).values({
            subsidiaryId, internalId: row.internal_id,
            name: row.name || null, fullName: row.full_name || null,
            isInactive: row.inactive ?? false, updatedAt: now,
          }).onConflictDoUpdate({
            target: [catalogLocations.subsidiaryId, catalogLocations.internalId],
            set: {
              name: row.name || null, fullName: row.full_name || null,
              isInactive: row.inactive ?? false, updatedAt: now,
            },
          });
        }
      }

      total += rows.length;
      if (page + 1 >= result.data.page_count) break;
      page++;
    }

    summary[type] = total;
  }

  return { ok: true, summary };
}
