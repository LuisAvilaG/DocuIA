import { db } from "@/lib/db";
import { orgProducts } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";

export * from "./registry";

// Product keys the org currently has (anything not explicitly disabled).
export async function getActiveProductKeys(orgId: string): Promise<Set<string>> {
  const rows = await db.query.orgProducts.findMany({
    where: and(eq(orgProducts.organizationId, orgId), ne(orgProducts.status, "disabled")),
    columns: { productKey: true },
  });
  return new Set(rows.map((r) => r.productKey));
}

export async function isProductActive(orgId: string, productKey: string): Promise<boolean> {
  const row = await db.query.orgProducts.findFirst({
    where: and(eq(orgProducts.organizationId, orgId), eq(orgProducts.productKey, productKey)),
    columns: { status: true },
  });
  return !!row && row.status !== "disabled";
}
