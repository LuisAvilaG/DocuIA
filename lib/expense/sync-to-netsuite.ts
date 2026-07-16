import { db } from "@/lib/db";
import { expenseReports, expenseItems, nsConnections, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { decryptField } from "@/lib/crypto/encrypt";
import { buildOAuthHeader, buildRestApiUrl, NSCredentials } from "@/lib/netsuite/oauth";

const NS_TIMEOUT_MS = Number(process.env.NETSUITE_TIMEOUT_MS) || 30_000;

// ── NS REST helpers ───────────────────────────────────────────────────

function buildSuiteQLUrl(accountId: string): string {
  const normalizedId = accountId.replace(/_/g, "-").toLowerCase();
  return `https://${normalizedId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

async function nsRest(
  method: "GET" | "POST" | "PATCH",
  url: string,
  creds: NSCredentials,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const authHeader = buildOAuthHeader(url, method, creds);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  authHeader,
      "Content-Type": "application/json",
      Accept:         "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(NS_TIMEOUT_MS),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function suiteQL(
  creds: NSCredentials,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const url = `${buildSuiteQLUrl(creds.accountId)}?limit=100`;
  const authHeader = buildOAuthHeader(url, "POST", creds);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json", Accept: "application/json", Prefer: "transient" },
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(NS_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const json = await res.json() as { items?: Array<Record<string, unknown>> };
  return json.items ?? [];
}

// ── Vendor resolution ─────────────────────────────────────────────────

async function lookupVendor(creds: NSCredentials, vendorNit: string): Promise<string | null> {
  const safe = vendorNit.replace(/[^0-9A-Za-z\-]/g, "");
  const rows = await suiteQL(
    creds,
    `SELECT id FROM vendor WHERE REGEXP_LIKE(entityid, '${safe}') AND isinactive = 'F'`,
  );
  return rows.length > 0 && rows[0].id ? String(rows[0].id) : null;
}

async function createVendor(
  creds: NSCredentials,
  vendorNit: string,
  vendorName: string,
  subsidiaryNsId: string,
): Promise<string> {
  const createUrl = `${buildRestApiUrl(creds.accountId)}/vendor`;
  const body: Record<string, unknown> = {
    companyName: vendorName,
    entityid:    vendorNit,
    isPerson:    false,
  };
  // OneWorld: the vendor must belong to the transaction's subsidiary, otherwise
  // the Vendor Bill fails with "transaction subsidiary does not match the entity".
  if (subsidiaryNsId) body.subsidiary = { id: subsidiaryNsId };
  const result = await nsRest("POST", createUrl, creds, body);
  if (!result.ok) {
    throw new Error(`No se pudo crear el proveedor "${vendorName}" (NIT: ${vendorNit}): HTTP ${result.status}`);
  }
  const created = result.data as Record<string, unknown> | null;
  if (created?.id) return String(created.id);
  // NS may not return ID in body — retry lookup
  const retry = await suiteQL(creds, `SELECT id FROM vendor WHERE entityid = '${vendorNit.replace(/'/g, "''")}'`);
  if (retry.length > 0 && retry[0].id) return String(retry[0].id);
  throw new Error(`Proveedor "${vendorName}" creado en NS pero no se pudo recuperar su ID`);
}

// ── NS Expense Report ─────────────────────────────────────────────────

interface ExpenseLineForNS {
  expensedate: string;
  category:    { id: string };
  amount:      number;
  memo:        string | null;
  department?: { id: string };
  class?:      { id: string };
}

async function createNSExpenseReport(
  creds: NSCredentials,
  opts: {
    employeeNsId:   string;
    subsidiaryNsId: string;
    trandate:       string;
    memo:           string;
    externalId:     string;
    lines:          ExpenseLineForNS[];
  },
): Promise<string> {
  const url = `${buildRestApiUrl(creds.accountId)}/expensereport`;
  const result = await nsRest("POST", url, creds, {
    externalId:  opts.externalId,
    employee:    { id: opts.employeeNsId },
    subsidiary:  { id: opts.subsidiaryNsId },
    trandate:    opts.trandate,
    memo:        opts.memo,
    expense:     { items: opts.lines },
  });
  if (!result.ok) {
    const d = result.data as Record<string, unknown> | null;
    const msg = d?.["o__message"] ?? d?.message ?? `HTTP ${result.status}`;
    throw new Error(`Error al crear Expense Report en NS: ${msg}`);
  }
  const created = result.data as Record<string, unknown> | null;
  if (created?.id) return String(created.id);
  if (created?.internalid) return String(created.internalid);
  throw new Error("NS creó el Expense Report pero no devolvió el ID");
}

// ── Vendor Bill via process script ────────────────────────────────────

async function createNSVendorBill(
  creds: NSCredentials,
  opts: {
    processScriptId:  string;
    processDeployId:  string;
    vendorNsId:       string;
    subsidiaryNsId:   string;
    invoiceNumber:    string;
    invoiceDate:      string;
    memo:             string;
    externalId:       string;
    currency:         string | null;
    accountNsId:      string;
    amount:           number;
    department?:      string | null;
    class?:           string | null;
  },
): Promise<string> {
  const { processDocument } = await import("@/lib/netsuite/client");
  // Employee expenses paid to a vendor have no catalog item — they post to the
  // Vendor Bill's expense sublist against the category's GL account.
  const expenseLine: Record<string, unknown> = {
    account_internal_id: opts.accountNsId,
    amount:              opts.amount,
    memo:                opts.memo,
  };
  if (opts.department) expenseLine.department = opts.department;
  if (opts.class)      expenseLine.class      = opts.class;

  const result = await processDocument(creds, opts.processScriptId, opts.processDeployId, {
    document_type:          "invoice",
    dry_run:                false,
    vendor_internal_id:     opts.vendorNsId,
    subsidiary_internal_id: opts.subsidiaryNsId,
    invoice_number:         opts.invoiceNumber,
    invoice_date:           opts.invoiceDate,
    external_id:            opts.externalId,
    currency_internal_id:   opts.currency,
    memo:                   opts.memo,
    expense_lines:          [expenseLine],
  });
  if (!result.ok) throw new Error(result.error ?? "Error en NS al crear Vendor Bill");
  const d = result.data as Record<string, unknown>;
  return String(d?.vendor_bill_internal_id ?? d?.internal_id ?? d?.id ?? "");
}

// ── Result types ──────────────────────────────────────────────────────

export interface SyncToNSResult {
  ok: boolean;
  nsExpenseReportId: string | null;
  itemResults: Array<{ itemId: string; nsRecordId: string | null; error: string | null }>;
  errors: string[];
}

// ── Main sync function ────────────────────────────────────────────────

export async function syncReportToNetsuite(reportId: string, orgId: string): Promise<SyncToNSResult> {

  // ── 1. Load report ─────────────────────────────────────────────────
  const report = await db.query.expenseReports.findFirst({
    where: and(eq(expenseReports.id, reportId), eq(expenseReports.organizationId, orgId)),
    with: {
      submitter: { columns: { netsuiteEmployeeId: true, fullName: true, email: true } },
      items: {
        with: {
          category:   { columns: { netsuiteCategoryId: true, netsuiteAccountId: true } },
          department: { columns: { netsuiteId: true } },
          class:      { columns: { netsuiteId: true } },
        },
        orderBy: (t, { asc }) => [asc(t.lineNumber)],
      },
    },
  });

  if (!report) throw new Error("Informe no encontrado");
  // Allow re-syncing a report that landed in "exception" after a partial failure,
  // not just freshly-approved ones. "syncing"/"synced" are intentionally excluded.
  if (report.status !== "approved" && report.status !== "exception") {
    throw new Error(`El informe debe estar aprobado para sincronizar (estado actual: ${report.status})`);
  }

  // ── 2. Load NS connection ──────────────────────────────────────────
  const conn = await db.query.nsConnections.findFirst({
    where: and(eq(nsConnections.organizationId, orgId), eq(nsConnections.isActive, true)),
  });
  if (!conn) throw new Error("No hay conexión NetSuite activa para esta organización");
  if (!conn.processScriptId || !conn.processDeployId) {
    throw new Error("El Process Script de NetSuite no está configurado");
  }

  const creds: NSCredentials = {
    accountId:      conn.accountId,
    consumerKey:    decryptField(conn.consumerKey),
    consumerSecret: decryptField(conn.consumerSecret),
    tokenId:        decryptField(conn.tokenId),
    tokenSecret:    decryptField(conn.tokenSecret),
  };

  // ── 3. Resolve subsidiary NS ID (deterministic) ───────────────────
  // The expense report doesn't carry a subsidiary yet (schema gap — tracked
  // as a follow-up). Instead of silently picking an arbitrary one, we require
  // an unambiguous choice: exactly one active subsidiary.
  const activeSubs = await db.query.subsidiaries.findMany({
    where: and(eq(subsidiaries.organizationId, orgId), eq(subsidiaries.isActive, true)),
    columns: { nsSubsidiaryId: true, name: true },
  });
  const subsidiaryNsId = activeSubs.length === 1 ? (activeSubs[0].nsSubsidiaryId ?? "") : "";

  // ── 4. Separate items by record type ──────────────────────────────
  const personalItems   = report.items.filter(i => i.nsRecordType === "expense_report");
  const vendorBillItems = report.items.filter(i => i.nsRecordType === "vendor_bill");

  // ═══════════════════════════════════════════════════════════════════
  // FASE A — PRE-VALIDACIÓN (sin escrituras en NS)
  // ═══════════════════════════════════════════════════════════════════
  const preErrors: string[] = [];

  // A0. Subsidiary must be unambiguous
  if (activeSubs.length === 0) {
    preErrors.push("No hay subsidiaria activa para esta organización.");
  } else if (activeSubs.length > 1) {
    preErrors.push(
      "La organización tiene múltiples subsidiarias activas y el informe no especifica cuál usar. " +
      "Asigna la subsidiaria del informe antes de sincronizar."
    );
  }

  // A1. Employee NS ID (required for personal items)
  if (personalItems.length > 0 && !report.submitter.netsuiteEmployeeId) {
    preErrors.push(
      `El empleado ${report.submitter.email} no tiene ID de NetSuite asignado. ` +
      `Ejecuta el sync de empleados desde el panel de administración.`
    );
  }

  // A2. Personal (Expense Report) items need the NS expense category
  for (const item of personalItems) {
    if (!item.category?.netsuiteCategoryId) {
      preErrors.push(`Línea ${item.lineNumber}: sin categoría de NetSuite (re-sincroniza catálogos)`);
    }
  }

  // A3. Vendor Bill items need NIT, invoice number, and the category's GL account
  //     (the expense line on the bill is account-based, not item-based).
  for (const item of vendorBillItems) {
    if (!item.vendorNit) {
      preErrors.push(`Línea ${item.lineNumber}: Vendor Bill requiere NIT/RFC del proveedor`);
    }
    if (!item.invoiceNumber) {
      preErrors.push(`Línea ${item.lineNumber}: Vendor Bill requiere número de factura`);
    }
    if (!item.category?.netsuiteAccountId) {
      preErrors.push(`Línea ${item.lineNumber}: la categoría no tiene cuenta contable de NetSuite (re-sincroniza catálogos)`);
    }
  }

  if (preErrors.length > 0) {
    await db.update(expenseReports)
      .set({ status: "approved", syncError: preErrors.join("\n"), updatedAt: new Date() })
      .where(eq(expenseReports.id, reportId));
    return { ok: false, nsExpenseReportId: null, itemResults: [], errors: preErrors };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE B — RESOLUCIÓN DE VENDORS (lookup + create si no existen)
  //          Todos los vendors deben resolverse ANTES de crear docs
  // ═══════════════════════════════════════════════════════════════════
  const vendorMap = new Map<string, string>(); // NIT → NS internal ID
  const vendorErrors: string[] = [];

  for (const item of vendorBillItems) {
    const nit = item.vendorNit!;
    if (vendorMap.has(nit)) continue; // already resolved in this run
    if (item.vendorNsInternalId) {
      vendorMap.set(nit, item.vendorNsInternalId);
      continue;
    }
    try {
      const found = await lookupVendor(creds, nit);
      if (found) {
        vendorMap.set(nit, found);
      } else {
        // Auto-create vendor
        const nsId = await createVendor(creds, nit, item.vendorName ?? nit, subsidiaryNsId);
        vendorMap.set(nit, nsId);
        // Persist vendor NS ID so future syncs skip the lookup
        await db.update(expenseItems)
          .set({ vendorNsInternalId: nsId, updatedAt: new Date() })
          .where(and(eq(expenseItems.reportId, reportId), eq(expenseItems.vendorNit, nit)));
      }
    } catch (e) {
      vendorErrors.push(
        `Línea ${item.lineNumber}: no se pudo resolver el proveedor ${nit} — ` +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }

  if (vendorErrors.length > 0) {
    // Revert to approved so contabilidad can retry after fixing the vendor
    await db.update(expenseReports)
      .set({ status: "approved", syncError: vendorErrors.join("\n"), updatedAt: new Date() })
      .where(eq(expenseReports.id, reportId));
    return { ok: false, nsExpenseReportId: null, itemResults: [], errors: vendorErrors };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE C — CREACIÓN DE REGISTROS EN NS
  // ═══════════════════════════════════════════════════════════════════
  await db.update(expenseReports)
    .set({ status: "syncing", updatedAt: new Date() })
    .where(eq(expenseReports.id, reportId));

  const itemResults: SyncToNSResult["itemResults"] = [];
  const syncErrors: string[] = [];

  // C1. Vendor Bills
  for (const item of vendorBillItems) {
    // Skip items already synced in a previous (partial) run — idempotency.
    if (item.nsRecordId) {
      itemResults.push({ itemId: item.id, nsRecordId: item.nsRecordId, error: null });
      continue;
    }
    try {
      const vendorNsId   = vendorMap.get(item.vendorNit!)!;
      const invoiceDate  = item.invoiceDate
        ? (item.invoiceDate as Date).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const nsId = await createNSVendorBill(creds, {
        processScriptId: conn.processScriptId!,
        processDeployId: conn.processDeployId!,
        vendorNsId,
        subsidiaryNsId,
        invoiceNumber:   item.invoiceNumber ?? "",
        invoiceDate,
        memo:            item.description ?? report.purpose,
        externalId:      `docuia-exp:${reportId}:${item.id}`,
        currency:        item.currency ?? null,
        accountNsId:     item.category!.netsuiteAccountId!,
        amount:          Number(item.total),
        department:      item.department?.netsuiteId ?? null,
        class:           item.class?.netsuiteId ?? null,
      });

      await db.update(expenseItems)
        .set({ nsRecordId: nsId || null, nsRecordType: "vendor_bill", syncError: null, updatedAt: new Date() })
        .where(eq(expenseItems.id, item.id));

      itemResults.push({ itemId: item.id, nsRecordId: nsId || null, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      syncErrors.push(`Línea ${item.lineNumber}: ${msg}`);
      await db.update(expenseItems)
        .set({ syncError: msg, updatedAt: new Date() })
        .where(eq(expenseItems.id, item.id));
      itemResults.push({ itemId: item.id, nsRecordId: null, error: msg });
    }
  }

  // C2. Expense Report (personal items — skip if VBs already failed)
  let nsExpenseReportId: string | null = report.netsuiteExpenseReportId ?? null;

  // Skip if the Expense Report was already created in a previous run.
  if (personalItems.length > 0 && syncErrors.length === 0 && !nsExpenseReportId) {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const lines: ExpenseLineForNS[] = personalItems.map(item => {
        const dateStr = item.expenseDate
          ? (item.expenseDate as Date).toISOString().slice(0, 10)
          : item.invoiceDate
          ? (item.invoiceDate as Date).toISOString().slice(0, 10)
          : today;

        const line: ExpenseLineForNS = {
          expensedate: dateStr,
          category:    { id: item.category!.netsuiteCategoryId },
          amount:      Number(item.total),
          memo:        item.description ?? item.vendorName ?? null,
        };
        if (item.department?.netsuiteId) line.department = { id: item.department.netsuiteId };
        if (item.class?.netsuiteId)      line.class       = { id: item.class.netsuiteId };
        return line;
      });

      nsExpenseReportId = await createNSExpenseReport(creds, {
        employeeNsId:   report.submitter.netsuiteEmployeeId!,
        subsidiaryNsId,
        trandate:       today,
        memo:           report.purpose,
        externalId:     `docuia-exp:${reportId}`,
        lines,
      });

      for (const item of personalItems) {
        const deNote = item.needsDocumentoEquivalente
          ? "Requiere creación manual de Documento Equivalente en NetSuite"
          : null;
        await db.update(expenseItems)
          .set({ nsRecordId: nsExpenseReportId, syncError: deNote, updatedAt: new Date() })
          .where(eq(expenseItems.id, item.id));
        itemResults.push({ itemId: item.id, nsRecordId: nsExpenseReportId, error: deNote });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      syncErrors.push(`Expense Report NS: ${msg}`);
      for (const item of personalItems) {
        await db.update(expenseItems)
          .set({ syncError: msg, updatedAt: new Date() })
          .where(eq(expenseItems.id, item.id));
        itemResults.push({ itemId: item.id, nsRecordId: null, error: msg });
      }
    }
  }

  // ── 5. Finalizar estado del informe ───────────────────────────────
  if (syncErrors.length === 0) {
    await db.update(expenseReports)
      .set({
        status:                  "synced",
        netsuiteExpenseReportId: nsExpenseReportId,
        syncError:               null,
        updatedAt:               new Date(),
      })
      .where(eq(expenseReports.id, reportId));
  } else {
    await db.update(expenseReports)
      .set({
        status:    "exception",
        syncError: syncErrors.join("\n"),
        updatedAt: new Date(),
      })
      .where(eq(expenseReports.id, reportId));
  }

  return {
    ok:                syncErrors.length === 0,
    nsExpenseReportId,
    itemResults,
    errors:            syncErrors,
  };
}
