import { getTenantSession } from "@/lib/auth/jwt";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { expenseReports, expenseCategories, catalogDepartments, catalogClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ItemCaptureClient } from "./item-capture-client";

export default async function NewItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const [report, categories, departments, classes] = await Promise.all([
    db.query.expenseReports.findFirst({
      where: and(eq(expenseReports.id, id), eq(expenseReports.organizationId, session.orgId)),
      columns: { id: true, purpose: true, status: true, submitterId: true },
    }),
    db.query.expenseCategories.findMany({
      where: and(eq(expenseCategories.organizationId, session.orgId), eq(expenseCategories.isActive, true)),
      columns: { id: true, name: true, netsuiteCategoryId: true, dailyCap: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.catalogDepartments.findMany({
      where: and(eq(catalogDepartments.organizationId, session.orgId), eq(catalogDepartments.isInactive, false)),
      columns: { id: true, name: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.catalogClasses.findMany({
      where: and(eq(catalogClasses.organizationId, session.orgId), eq(catalogClasses.isInactive, false)),
      columns: { id: true, name: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
  ]);

  if (!report) notFound();
  if (session.role !== "admin" && report.submitterId !== session.sub) notFound();
  if (report.status !== "draft") redirect(`/expenses/${id}`);

  return (
    <ItemCaptureClient
      reportId={id}
      reportPurpose={report.purpose}
      categories={categories as any}
      departments={departments}
      classes={classes}
    />
  );
}
