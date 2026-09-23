import { db } from "@/lib/db";
import { expenseCategories, catalogDepartments, catalogClasses } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function ownsExpenseCatalogReferences(orgId: string, values: { categoryId?: unknown; departmentId?: unknown; classId?: unknown }): Promise<boolean> {
  for (const [field, table] of [["categoryId", expenseCategories], ["departmentId", catalogDepartments], ["classId", catalogClasses]] as const) {
    const id = values[field];
    if (id === undefined || id === null) continue;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return false;
    const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.organizationId, orgId))).limit(1);
    if (!rows.length) return false;
  }
  return true;
}
