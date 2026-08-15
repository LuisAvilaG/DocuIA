import { db } from "@/lib/db";
import { itemMappings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
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
    const existing = await db.select().from(itemMappings)
      .where(eq(itemMappings.subsidiaryId, entry.subsidiaryId)).limit(500);
    const similar = existing.find(row =>
      row.vendorNorm === vendorNorm
      && computeSimilarity(entry.vendorItemName, row.vendorItemName) >= mergeSimilarity,
    );

    if (similar) {
      await db.update(itemMappings).set({
        vendor: entry.vendor,
        vendorNorm,
        vendorItemName: entry.vendorItemName,
        vendorItemNorm,
        netsuiteInternalId: entry.netsuiteInternalId,
        netsuiteItemName: entry.netsuiteItemName ?? similar.netsuiteItemName,
        netsuiteUnit: entry.netsuiteUnit ?? similar.netsuiteUnit,
        timesConfirmed: sql`${itemMappings.timesConfirmed} + 1`,
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
        timesConfirmed: sql`${itemMappings.timesConfirmed} + 1`, autoMap: sql`excluded.auto_map`,
        lastConfirmed: now, updatedAt: now,
      },
    });
  }
}
