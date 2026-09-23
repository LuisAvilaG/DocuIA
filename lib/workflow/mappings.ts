import { db } from "@/lib/db";
import { itemMappings } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { computeSimilarity, normalizeForLookup } from "./similarity";

export type MappingEntry = {
  subsidiaryId:       string;
  vendor:             string;
  vendorItemName:     string;
  netsuiteInternalId: string;
  netsuiteItemName:   string | null;
  netsuiteUnit:       string | null;
  autoMap:            boolean;
};

export async function upsertItemMappings(
  entries: MappingEntry[],
  options: { mergeSimilarity?: number } = {},
): Promise<void> {
  const valid = entries.filter((e) => e.vendor && e.vendorItemName && e.netsuiteInternalId);
  if (!valid.length) return;

  const now = new Date();
  const mergeSimilarity = Math.min(1, Math.max(0.6, Number(options.mergeSimilarity) || 0.93));

  for (const entry of valid) {
    const vendorNorm = normalizeForLookup(entry.vendor).slice(0, 191);
    const vendorItemNorm = normalizeForLookup(entry.vendorItemName).slice(0, 512);
    // Only this vendor's rows: an unfiltered, capped scan missed matches for
    // large tenants.
    const existing = await db.select().from(itemMappings)
      .where(and(eq(itemMappings.subsidiaryId, entry.subsidiaryId), eq(itemMappings.vendorNorm, vendorNorm)))
      .limit(500);
    const similar = existing.find(row =>
      computeSimilarity(entry.vendorItemName, row.vendorItemName) >= mergeSimilarity,
    );
    // Auto-processed postings reuse what the memory suggested; counting them
    // as confirmations let a wrong mapping reinforce itself with no human.
    const confirmations = entry.autoMap
      ? sql`${itemMappings.timesConfirmed}`
      : sql`${itemMappings.timesConfirmed} + 1`;

    if (similar) {
      // Keep the row's own key (vendor item name): renaming it to the merged
      // spelling could collide with the unique (sub, vendor, item) index.
      await db.update(itemMappings).set({
        netsuiteInternalId: entry.netsuiteInternalId,
        netsuiteItemName: entry.netsuiteItemName ?? similar.netsuiteItemName,
        netsuiteUnit: entry.netsuiteUnit ?? similar.netsuiteUnit,
        timesConfirmed: confirmations,
        autoMap: entry.autoMap,
        lastConfirmed: now,
        updatedAt: now,
      }).where(eq(itemMappings.id, similar.id));
      continue;
    }

    const row = {
      subsidiaryId: entry.subsidiaryId, vendor: entry.vendor, vendorNorm,
      vendorItemName: entry.vendorItemName, vendorItemNorm,
      netsuiteInternalId: entry.netsuiteInternalId, netsuiteItemName: entry.netsuiteItemName ?? null,
      netsuiteUnit: entry.netsuiteUnit ?? null, autoMap: entry.autoMap, lastConfirmed: now,
    };
    await db.insert(itemMappings).values(row).onConflictDoUpdate({
      target: [itemMappings.subsidiaryId, itemMappings.vendorNorm, itemMappings.vendorItemNorm],
      set: {
        netsuiteInternalId: sql`excluded.netsuite_internal_id`,
        netsuiteItemName: sql`COALESCE(excluded.netsuite_item_name, ${itemMappings.netsuiteItemName})`,
        netsuiteUnit: sql`COALESCE(excluded.netsuite_unit, ${itemMappings.netsuiteUnit})`,
        timesConfirmed: confirmations, autoMap: sql`excluded.auto_map`,
        lastConfirmed: now, updatedAt: now,
      },
    });
  }
}
