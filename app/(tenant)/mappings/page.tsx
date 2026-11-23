import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { db } from "@/lib/db";
import { itemMappings, subsidiaries } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { MappingsClient } from "./client";

const MAX_ROWS = 2000;
import { isFeatureEnabled } from "@/lib/features";

export default async function MappingsPage() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);
  if (!await isFeatureEnabled(session.orgId, "auto_mapping")) redirect("/dashboard");

  type MappingRow = {
    id: number;
    subsidiaryId: string;
    subsidiaryName: string;
    vendor: string;
    vendorItemName: string;
    netsuiteInternalId: string;
    netsuiteItemName: string | null;
    netsuiteUnit: string | null;
    timesConfirmed: number;
    autoMap: boolean;
    lastConfirmed: string | null;
  };

  let subs: { id: string; name: string }[] = [];
  let mappings: MappingRow[] = [];
  let truncated = false;

  try {
    subs = await db
      .select({ id: subsidiaries.id, name: subsidiaries.name })
      .from(subsidiaries)
      .where(eq(subsidiaries.organizationId, session.orgId));

    if (subs.length > 0) {
      const subIds = subs.map(s => s.id);
      const nameMap = new Map(subs.map(s => [s.id, s.name]));

      const rows = await db
        .select()
        .from(itemMappings)
        .where(inArray(itemMappings.subsidiaryId, subIds))
        // Most recent first and in a stable order; the screen says when the
        // list does not hold everything, since it searches only what it has.
        .orderBy(desc(itemMappings.updatedAt), desc(itemMappings.id))
        .limit(MAX_ROWS + 1);
      truncated = rows.length > MAX_ROWS;
      rows.length = Math.min(rows.length, MAX_ROWS);

      mappings = rows.map(r => ({
        id:                 r.id,
        subsidiaryId:       r.subsidiaryId,
        subsidiaryName:     nameMap.get(r.subsidiaryId) ?? r.subsidiaryId,
        vendor:             r.vendor,
        vendorItemName:     r.vendorItemName,
        netsuiteInternalId: r.netsuiteInternalId,
        netsuiteItemName:   r.netsuiteItemName,
        netsuiteUnit:       r.netsuiteUnit,
        timesConfirmed:     r.timesConfirmed,
        autoMap:            r.autoMap,
        lastConfirmed:      r.lastConfirmed?.toISOString() ?? null,
      }));
    }
  } catch (err) {
    console.error("[mappings]", err);
  }

  return <MappingsClient subsidiaries={subs} mappings={mappings} canManage={session.role === "admin"} truncated={truncated} />;
}
