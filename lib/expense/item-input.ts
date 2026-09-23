import { z } from "zod";
import { parseLocaleNumber } from "@/lib/numbers";

// Single validation for creating and editing expense lines. Column limits
// match db/schema/expenses.ts so bad input is a 400, never a database 500.

export const EXPENSE_DOCUMENT_TYPES = ["invoice", "receipt", "cuenta_cobro", "documento_equivalente", "unknown"] as const;
export type ExpenseDocumentType = typeof EXPENSE_DOCUMENT_TYPES[number];

const money = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = parseLocaleNumber(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "no es un número válido" });
    return z.NEVER;
  }
  return Math.round(parsed * 100) / 100;
});

// Accepts "YYYY-MM-DD" or a full ISO timestamp; stores a Date.
const date = z.string().trim().refine((value) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)), "fecha inválida")
  .transform((value) => new Date(value));

// "Sin categoría" and friends are null, never 0.
const catalogId = z.number().int().positive().nullable();

const text = (max: number) => z.string().trim().max(max).transform((value) => value || null);

const fields = {
  categoryId:                catalogId.optional(),
  departmentId:              catalogId.optional(),
  classId:                   catalogId.optional(),
  expenseDate:               date.nullable().optional(),
  invoiceDate:               date.nullable().optional(),
  description:               text(2000).nullable().optional(),
  vendorName:                text(500).nullable().optional(),
  vendorNit:                 text(50).nullable().optional(),
  invoiceNumber:             text(100).nullable().optional(),
  subtotal:                  money.nullable().optional(),
  taxAmount:                 money.nullable().optional(),
  retentionAmount:           money.nullable().optional(),
  currency:                  z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "moneda inválida").optional(),
  paymentMethod:             z.enum(["personal", "company_pays_vendor"]).optional(),
  documentTypeDetected:      z.string().optional().transform((value) =>
    (EXPENSE_DOCUMENT_TYPES as readonly string[]).includes(value ?? "") ? value as ExpenseDocumentType : undefined),
  needsDocumentoEquivalente: z.boolean().optional(),
};

export const createExpenseItemSchema = z.object({
  ...fields,
  reportId:      z.string().uuid(),
  total:         money,
  paymentMethod: z.enum(["personal", "company_pays_vendor"]),
  fileKey:       z.string().max(500).optional(),
  uploadReceipt: z.string().max(4096).optional(),
});

export const updateExpenseItemSchema = z.object({ ...fields, total: money.optional() }).strict();

export type CreateExpenseItemInput = z.infer<typeof createExpenseItemSchema>;
export type UpdateExpenseItemInput = z.infer<typeof updateExpenseItemSchema>;

export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path.join(".") || "solicitud";
  return `El campo "${field}" ${issue?.message ?? "es inválido"}`;
}

/** Subtotal is optional in the form: derive it from total, tax and retention. */
export function resolveAmounts(input: { subtotal?: number | null; taxAmount?: number | null; retentionAmount?: number | null; total: number }) {
  const taxAmount = input.taxAmount ?? 0;
  const retentionAmount = input.retentionAmount ?? 0;
  const subtotal = input.subtotal ?? Math.round((input.total - taxAmount + retentionAmount) * 100) / 100;
  return { subtotal, taxAmount, retentionAmount, total: input.total };
}

/** Company-paid invoices (and receipts needing a Documento Equivalente) are Vendor Bills. */
export function expenseRecordType(paymentMethod: string, documentType: ExpenseDocumentType, needsDocumentoEquivalente: boolean) {
  return paymentMethod === "company_pays_vendor" && (documentType === "invoice" || needsDocumentoEquivalente)
    ? "vendor_bill" as const
    : "expense_report" as const;
}

export function needsDocumentoEquivalente(documentType: ExpenseDocumentType, explicit?: boolean): boolean {
  return explicit ?? (documentType === "receipt" || documentType === "cuenta_cobro");
}
