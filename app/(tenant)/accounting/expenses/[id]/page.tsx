import { redirect, notFound } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { AccountingExpenseDetail } from "./accounting-detail";

export default async function AccountingExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");

  const row = await db.query.expenseReports.findFirst({
    where: and(
      eq(expenseReports.id, id),
      eq(expenseReports.organizationId, session.orgId),
    ),
    with: {
      submitter: {
        columns: { fullName: true, email: true, netsuiteEmployeeId: true },
      },
      items: {
        with: {
          category:   { columns: { id: true, name: true, netsuiteCategoryId: true } },
          department: { columns: { id: true, name: true } },
          class:      { columns: { id: true, name: true } },
          documents:  { columns: { id: true, fileKey: true, mimeType: true, originalName: true } },
        },
        orderBy: (t, { asc }) => [asc(t.lineNumber)],
      },
    },
  });

  if (!row) notFound();

  // Serialize — convert Dates to ISO strings so the client receives plain JSON
  const report = {
    id:                      row.id,
    purpose:                 row.purpose,
    status:                  row.status,
    periodStart:             row.periodStart?.toISOString() ?? null,
    periodEnd:               row.periodEnd?.toISOString() ?? null,
    submittedAt:             row.submittedAt?.toISOString() ?? null,
    approvedAt:              row.approvedAt?.toISOString() ?? null,
    rejectedReason:          row.rejectedReason,
    syncError:               row.syncError,
    netsuiteExpenseReportId: row.netsuiteExpenseReportId,
    submitter:               row.submitter,
    items: row.items.map((item) => ({
      id:                       item.id,
      lineNumber:               item.lineNumber,
      vendorName:               item.vendorName,
      vendorNit:                item.vendorNit,
      invoiceNumber:            item.invoiceNumber,
      invoiceDate:              item.invoiceDate?.toISOString() ?? null,
      expenseDate:              item.expenseDate?.toISOString() ?? null,
      subtotal:                 item.subtotal,
      taxAmount:                item.taxAmount,
      total:                    item.total,
      currency:                 item.currency,
      paymentMethod:            item.paymentMethod,
      documentTypeDetected:     item.documentTypeDetected,
      needsDocumentoEquivalente: item.needsDocumentoEquivalente,
      nsRecordType:             item.nsRecordType,
      nsRecordId:               item.nsRecordId,
      syncError:                item.syncError,
      category:                 item.category,
      department:               item.department,
      class:                    item.class,
      documents:                item.documents.map((d) => ({
        id:           d.id,
        fileKey:      d.fileKey,
        mimeType:     d.mimeType,
        originalName: d.originalName,
      })),
    })),
  };

  return <AccountingExpenseDetail report={report} />;
}
