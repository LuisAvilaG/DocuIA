import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { CatalogsClient } from "./client";

export type CatalogItem = {
  id: number;
  internalId: string;
  itemid: string | null;
  name: string | null;
  type: string | null;
  unit: string | null;
};

export type CatalogVendor = {
  id: number;
  internalId: string;
  entityid: string | null;
  name: string | null;
  email: string | null;
  rfc: string | null;
  isInactive: boolean;
};

export type CatalogLocation = {
  id: number;
  internalId: string;
  name: string | null;
  fullName: string | null;
  isInactive: boolean;
};

export default async function CatalogsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  let subs: { id: string; name: string }[] = [];
  const items: Record<string, CatalogItem[]>     = {};
  const vendors: Record<string, CatalogVendor[]> = {};
  const locations: Record<string, CatalogLocation[]> = {};

  try {
    subs = await db
      .select({ id: subsidiaries.id, name: subsidiaries.name })
      .from(subsidiaries)
      .where(eq(subsidiaries.organizationId, session.orgId));

    if (subs.length > 0) {
      const subIds = subs.map(s => s.id);

      const [itemRows, vendorRows, locationRows] = await Promise.all([
        db
          .select({
            id: catalogItems.id, subsidiaryId: catalogItems.subsidiaryId,
            internalId: catalogItems.internalId, itemid: catalogItems.itemid,
            name: catalogItems.name, type: catalogItems.type, unit: catalogItems.unit,
          })
          .from(catalogItems)
          .where(inArray(catalogItems.subsidiaryId, subIds))
          .limit(2000),

        db
          .select({
            id: catalogVendors.id, subsidiaryId: catalogVendors.subsidiaryId,
            internalId: catalogVendors.internalId, entityid: catalogVendors.entityid,
            name: catalogVendors.name, email: catalogVendors.email,
            rfc: catalogVendors.rfc, isInactive: catalogVendors.isInactive,
          })
          .from(catalogVendors)
          .where(inArray(catalogVendors.subsidiaryId, subIds))
          .limit(2000),

        db
          .select({
            id: catalogLocations.id, subsidiaryId: catalogLocations.subsidiaryId,
            internalId: catalogLocations.internalId, name: catalogLocations.name,
            fullName: catalogLocations.fullName, isInactive: catalogLocations.isInactive,
          })
          .from(catalogLocations)
          .where(inArray(catalogLocations.subsidiaryId, subIds))
          .limit(500),
      ]);

      for (const s of subs) {
        items[s.id]     = itemRows.filter(r => r.subsidiaryId === s.id).map(({ subsidiaryId: _s, ...r }) => r);
        vendors[s.id]   = vendorRows.filter(r => r.subsidiaryId === s.id).map(({ subsidiaryId: _s, ...r }) => r);
        locations[s.id] = locationRows.filter(r => r.subsidiaryId === s.id).map(({ subsidiaryId: _s, ...r }) => r);
      }
    }
  } catch (err) {
    console.error("[catalogs]", err);
  }

  return <CatalogsClient subsidiaries={subs} items={items} vendors={vendors} locations={locations} />;
}
