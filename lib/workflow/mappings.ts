import { db } from "@/lib/db";
import { itemMappings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { normalizeForLookup } from "./similarity";

export type MappingEntry = {
  subsidiaryId:       string;
  vendor:             string;
  vendorItemName:     string;
  netsuiteInternalId: string;
  netsuiteItemName:   string | null;
  netsuiteUnit:       string | null;
  autoMap:            boolean;
};

export async function upsertItemMappings(entries: MappingEntry[]): Promise<void> {
  const valid = entries.filter((e) => e.vendor && e.vendorItemName && e.netsuiteInternalId);
  if (!valid.length) return;

  const now = new Date();
  const rows = valid.map((e) => ({
    subsidiaryId:       e.subsidiaryId,
    vendor:             e.vendor,
    vendorNorm:         normalizeForLookup(e.vendor).slice(0, 191),
    vendorItemName:     e.vendorItemName,
    vendorItemNorm:     normalizeForLookup(e.vendorItemName).slice(0, 191),
    netsuiteInternalId: e.netsuiteInternalId,
    netsuiteItemName:   e.netsuiteItemName ?? null,
    netsuiteUnit:       e.netsuiteUnit ?? null,
    autoMap:            e.autoMap,
    lastConfirmed:      now,
  }));

  await db.insert(itemMappings).values(rows).onConflictDoUpdate({
    target: [itemMappings.subsidiaryId, itemMappings.vendorNorm, itemMappings.vendorItemNorm],
    set: {
      netsuiteInternalId: sql`excluded.netsuite_internal_id`,
      netsuiteItemName:   sql`COALESCE(excluded.netsuite_item_name, ${itemMappings.netsuiteItemName})`,
      netsuiteUnit:       sql`COALESCE(excluded.netsuite_unit, ${itemMappings.netsuiteUnit})`,
      timesConfirmed:     sql`${itemMappings.timesConfirmed} + 1`,
      autoMap:            sql`excluded.auto_map`,
      lastConfirmed:      now,
      updatedAt:          now,
    },
  });
}
