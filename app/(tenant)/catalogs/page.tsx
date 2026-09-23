import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { db } from "@/lib/db";
import { subsidiaries, catalogItems, catalogVendors, catalogLocations } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
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

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<{ sub?: string }> }) {
  const { sub: requestedSub } = await searchParams;
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);

  let subs: { id: string; name: string }[] = [];
  let selectedSub = "";
  const items: Record<string, CatalogItem[]>     = {};
  const vendors: Record<string, CatalogVendor[]> = {};
  const locations: Record<string, CatalogLocation[]> = {};

  try {
    subs = await db
      .select({ id: subsidiaries.id, name: subsidiaries.name })
      .from(subsidiaries)
      .where(eq(subsidiaries.organizationId, session.orgId))
      .orderBy(asc(subsidiaries.name));

    // Only the selected subsidiary is loaded: accounts can have dozens of them,
    // and a shared row limit would leave most of them looking empty.
    selectedSub = subs.find(s => s.id === requestedSub)?.id ?? subs[0]?.id ?? "";
    if (selectedSub) {

      const [itemRows, vendorRows, locationRows] = await Promise.all([
        db
          .select({
            id: catalogItems.id, subsidiaryId: catalogItems.subsidiaryId,
            internalId: catalogItems.internalId, itemid: catalogItems.itemid,
            name: catalogItems.name, type: catalogItems.type, unit: catalogItems.unit,
          })
          .from(catalogItems)
          .where(eq(catalogItems.subsidiaryId, selectedSub))
          .orderBy(asc(catalogItems.name))
          .limit(5000),

        db
          .select({
            id: catalogVendors.id, subsidiaryId: catalogVendors.subsidiaryId,
            internalId: catalogVendors.internalId, entityid: catalogVendors.entityid,
            name: catalogVendors.name, email: catalogVendors.email,
            rfc: catalogVendors.rfc, isInactive: catalogVendors.isInactive,
          })
          .from(catalogVendors)
          .where(eq(catalogVendors.subsidiaryId, selectedSub))
          .orderBy(asc(catalogVendors.name))
          .limit(5000),

        db
          .select({
            id: catalogLocations.id, subsidiaryId: catalogLocations.subsidiaryId,
            internalId: catalogLocations.internalId, name: catalogLocations.name,
            fullName: catalogLocations.fullName, isInactive: catalogLocations.isInactive,
          })
          .from(catalogLocations)
          .where(eq(catalogLocations.subsidiaryId, selectedSub))
          .orderBy(asc(catalogLocations.name))
          .limit(2000),
      ]);

      items[selectedSub]     = itemRows.map(({ subsidiaryId: _s, ...r }) => r);
      vendors[selectedSub]   = vendorRows.map(({ subsidiaryId: _s, ...r }) => r);
      locations[selectedSub] = locationRows.map(({ subsidiaryId: _s, ...r }) => r);
    }
  } catch (err) {
    console.error("[catalogs]", err);
  }

  return (
    <CatalogsClient
      subsidiaries={subs}
      selectedSub={selectedSub}
      items={items}
      vendors={vendors}
      locations={locations}
      isAdmin={session.role === "admin"}
    />
  );
}
