// Shared catalog sync (items / vendors / locations) for one subsidiary.
import { logWorkflow } from "@/lib/workflow/log";
import { getActiveNsConnection } from "@/lib/netsuite/connection";
// Used by both the platform-admin endpoint and the tenant-admin endpoint so the
// logic — including the subsidiary-scoped location cleanup — lives in one place.
import { db } from "@/lib/db";
import { subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { fetchCatalogPage } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import type { NSCatalogItem, NSVendor, NSLocation } from "@/lib/netsuite/client";
import { decryptField } from "@/lib/crypto/encrypt";

export type CatalogType = "items" | "vendors" | "locations";

/**
 * After the active ERP environment changes, the stored catalog is the other
 * environment's: internal IDs created there after the sandbox was copied do
 * not exist here, or belong to a different record. Each subsidiary is read
 * again from the environment now active and what it did not return is dropped
 * (vendors are marked inactive by the sync itself; items are removed).
 * Learned mappings and vendor rules are left as they are.
 */
export async function resyncCatalogsForEnvironment(organizationId: string): Promise<void> {
  const subs = await db.query.subsidiaries.findMany({
    where: and(eq(subsidiaries.organizationId, organizationId), eq(subsidiaries.isActive, true)),
    columns: { id: true },
  });
  for (const sub of subs) {
    const startedAt = new Date();
    const result = await syncSubsidiaryCatalog(organizationId, sub.id);
    if (!result.ok) {
      console.error("[sync-catalog] resync after environment change failed", { organizationId, subsidiaryId: sub.id, error: result.error });
      continue;
    }
    if ((result.summary.items ?? 0) > 0) {
      await db.delete(catalogItems).where(and(eq(catalogItems.subsidiaryId, sub.id), lt(catalogItems.updatedAt, startedAt)));
    }
  }
}

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
  const conn = await getActiveNsConnection(organizationId);
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
    const startedAt = new Date();

    while (true) {
      const result = await fetchCatalogPage(
        creds, conn.catalogScriptId, conn.catalogDeployId, type, sub.nsSubsidiaryId, page, 500,
      );
      if (!result.ok || !result.data) {
        const error = `Sync failed at type=${type} page=${page}: ${result.error}`;
        await logWorkflow({ organizationId, stage: "sync", step: "catalog", status: "FAILED", errorMessage: error, metaJson: { subsidiaryId, partial: summary } });
        return { ok: false, error, status: 502, partial: summary };
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
            phone: row.phone || null, rfc: row.rfc || null,
            categoryId: row.category_id || null, categoryName: row.category_name || null,
            isInactive: row.inactive ?? false, updatedAt: now,
          }).onConflictDoUpdate({
            target: [catalogVendors.subsidiaryId, catalogVendors.internalId],
            set: {
              entityid: row.entityid || null, name: row.name || null, email: row.email || null,
              phone: row.phone || null, rfc: row.rfc || null,
              categoryId: row.category_id || null, categoryName: row.category_name || null,
              isInactive: row.inactive ?? false, updatedAt: now,
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

    // The ERP returns only what is active and assigned to the subsidiary, so a
    // vendor it stopped returning was deactivated or unassigned there. Left
    // active here, it kept being picked and every post failed in the ERP.
    // Only after a complete read that brought something: a failed page returns
    // above, and an empty answer is not taken as "everything was removed".
    // Items are left alone: the scheduled sync reads them with a different
    // filter (service category), so "not returned here" does not mean removed.
    if (total > 0 && type === "vendors") {
      await db.update(catalogVendors).set({ isInactive: true })
        .where(and(eq(catalogVendors.subsidiaryId, subsidiaryId), eq(catalogVendors.isInactive, false), lt(catalogVendors.updatedAt, startedAt)));
    }

    summary[type] = total;
  }

  await logWorkflow({ organizationId, stage: "sync", step: "catalog", status: "SUCCESS", metaJson: { subsidiaryId, ...summary } });
  return { ok: true, summary };
}
